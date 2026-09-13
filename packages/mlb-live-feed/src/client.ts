import { MLB_STATS_API_ORIGIN } from "./constants";
import { MlbFeedError } from "./errors";
import { isFullFeed, patchOperationsFromPayload } from "./feedPayload";
import {
  classifyGameStatus,
  feedCursor,
  normalizeFeed,
  normalizedStateFingerprint,
  waitMilliseconds,
} from "./feedNormalization";
import { type CanonicalGameProjector, projectCanonicalGameFrame } from "./feedProjections";
import { applyJsonPatch } from "./jsonPatch";
import type { GameStatusClassifier } from "@apple/protocol";
import type { MlbScheduleGame } from "./schedule";
import { assertMlbTimecode, formatMlbTimecode } from "./timecode";
import { fetchJson } from "./transport";
import type { FeedPayloadKind, MlbPollResult, NormalizedFeedCapture } from "./types";

export interface MlbRecordingClientOptions {
  /** MLB `fields=` list for full-feed requests; see LIVE_FEED_FIELDS. Unset fetches the whole feed. */
  fields?: string;
}

export class MlbRecordingClient {
  readonly #fetcher: typeof fetch;
  readonly #fields: string | undefined;
  readonly #now: () => Date;
  readonly #projectFrame: CanonicalGameProjector;
  readonly #classifyStatus: GameStatusClassifier;
  #baseline: unknown;
  #upstreamCursor = "";
  #deliveryCursor = "";
  #sameCursorRevision = 0;
  #stateFingerprint = "";
  #fingerprints = new Map<string, string>();

  constructor(
    fetcher: typeof fetch = fetch,
    now: () => Date = () => new Date(),
    projectFrame: CanonicalGameProjector = projectCanonicalGameFrame,
    classifyStatus: GameStatusClassifier = classifyGameStatus,
    options: MlbRecordingClientOptions = {},
  ) {
    this.#fetcher = fetcher;
    this.#fields = options.fields;
    this.#now = now;
    this.#projectFrame = projectFrame;
    this.#classifyStatus = classifyStatus;
  }

  #fullFeedUrl(gamePk: number) {
    const url = new URL(`/api/v1.1/game/${gamePk}/feed/live`, MLB_STATS_API_ORIGIN);
    if (this.#fields) url.searchParams.set("fields", this.#fields);
    return url.toString();
  }

  reset() {
    this.#baseline = undefined;
    this.#upstreamCursor = "";
    this.#deliveryCursor = "";
    this.#sameCursorRevision = 0;
    this.#stateFingerprint = "";
    this.#fingerprints.clear();
  }

  async #bootstrap(
    game: Pick<MlbScheduleGame, "gamePk" | "gameNumber">,
    url: string,
    signal?: AbortSignal,
  ): Promise<MlbPollResult> {
    const full = await fetchJson(this.#fetcher, url, signal);
    const upstreamCursor = feedCursor(full);
    const normalized = normalizeFeed(
      full,
      game.gameNumber,
      "BOOTSTRAP",
      this.#fingerprints,
      "FULL_BOOTSTRAP",
      this.#now().toISOString(),
      upstreamCursor,
      this.#projectFrame,
      this.#classifyStatus,
    );
    this.#baseline = full;
    this.#upstreamCursor = upstreamCursor;
    this.#deliveryCursor = upstreamCursor;
    this.#sameCursorRevision = 0;
    this.#fingerprints = normalized.fingerprints;
    this.#stateFingerprint = normalizedStateFingerprint(normalized.capture.gameSnapshot, normalized.fingerprints);
    return {
      capture: normalized.capture,
      cursor: this.#deliveryCursor,
      waitMs: normalized.capture.waitMs,
      payloadKind: "FULL_BOOTSTRAP",
    };
  }

  #noChange(waitFeed: unknown = this.#baseline): MlbPollResult {
    return {
      cursor: this.#deliveryCursor,
      waitMs: waitMilliseconds(waitFeed),
      payloadKind: "NO_CHANGE",
    };
  }

  async #advance(
    game: Pick<MlbScheduleGame, "gamePk" | "gameNumber">,
    diffUrl: string,
    fallbackUrl: string,
    signal?: AbortSignal,
  ): Promise<MlbPollResult> {
    const diff = await fetchJson(this.#fetcher, diffUrl, signal);
    if (Array.isArray(diff) && diff.length === 0) return this.#noChange();

    let nextFeed: unknown;
    let payloadKind: Exclude<FeedPayloadKind, "NO_CHANGE">;
    if (isFullFeed(diff)) {
      nextFeed = diff;
      payloadKind = "FULL_DIFF_RESPONSE";
    } else {
      const operations = patchOperationsFromPayload(diff);
      if (operations) {
        try {
          nextFeed = applyJsonPatch(this.#baseline, operations);
          payloadKind = "DIFF_PATCH";
        } catch {
          nextFeed = undefined;
          payloadKind = "FULL_FALLBACK";
        }
      } else if (Array.isArray(diff) && isFullFeed(diff.at(-1))) {
        nextFeed = diff.at(-1);
        payloadKind = "FULL_DIFF_RESPONSE";
      } else {
        nextFeed = undefined;
        payloadKind = "FULL_FALLBACK";
      }
    }

    if (!nextFeed) nextFeed = await fetchJson(this.#fetcher, fallbackUrl, signal);

    const upstreamCursor = feedCursor(nextFeed);
    if (upstreamCursor < this.#upstreamCursor) return this.#noChange();

    const normalized = normalizeFeed(
      nextFeed,
      game.gameNumber,
      "INCREMENTAL",
      this.#fingerprints,
      payloadKind,
      this.#now().toISOString(),
      upstreamCursor,
      this.#projectFrame,
      this.#classifyStatus,
    );
    const stateFingerprint = normalizedStateFingerprint(normalized.capture.gameSnapshot, normalized.fingerprints);
    if (upstreamCursor === this.#upstreamCursor && stateFingerprint === this.#stateFingerprint) {
      this.#baseline = nextFeed;
      this.#fingerprints = normalized.fingerprints;
      return this.#noChange(nextFeed);
    }

    let deliveryCursor = upstreamCursor;
    if (upstreamCursor === this.#upstreamCursor) {
      this.#sameCursorRevision += 1;
      deliveryCursor = `${upstreamCursor}~${String(this.#sameCursorRevision).padStart(6, "0")}`;
    } else {
      this.#sameCursorRevision = 0;
    }
    const capture: NormalizedFeedCapture =
      deliveryCursor === upstreamCursor
        ? normalized.capture
        : {
            ...normalized.capture,
            cursor: deliveryCursor,
            coreInput: { ...normalized.capture.coreInput, cursor: deliveryCursor },
          };

    this.#baseline = nextFeed;
    this.#upstreamCursor = upstreamCursor;
    this.#deliveryCursor = deliveryCursor;
    this.#fingerprints = normalized.fingerprints;
    this.#stateFingerprint = stateFingerprint;
    return {
      capture,
      cursor: deliveryCursor,
      waitMs: capture.waitMs,
      payloadKind,
    };
  }

  async poll(game: Pick<MlbScheduleGame, "gamePk" | "gameNumber">, signal?: AbortSignal): Promise<MlbPollResult> {
    if (!this.#baseline) {
      return this.#bootstrap(game, this.#fullFeedUrl(game.gamePk), signal);
    }

    const diffUrl = new URL(`/api/v1.1/game/${game.gamePk}/feed/live/diffPatch`, MLB_STATS_API_ORIGIN);
    diffUrl.searchParams.set("startTimecode", this.#upstreamCursor);
    const endTimecode = formatMlbTimecode(this.#now());
    if (endTimecode > this.#upstreamCursor) diffUrl.searchParams.set("endTimecode", endTimecode);
    return this.#advance(game, diffUrl.toString(), this.#fullFeedUrl(game.gamePk), signal);
  }

  async loadTimecode(
    game: Pick<MlbScheduleGame, "gamePk" | "gameNumber">,
    timecode: string,
    signal?: AbortSignal,
  ): Promise<MlbPollResult> {
    assertMlbTimecode(timecode);
    const fullUrl = new URL(this.#fullFeedUrl(game.gamePk));
    fullUrl.searchParams.set("timecode", timecode);
    if (!this.#baseline) return this.#bootstrap(game, fullUrl.toString(), signal);
    if (timecode < this.#upstreamCursor) {
      throw new MlbFeedError("Historical replay must reset before moving backward.", "REPLAY_CURSOR_REGRESSION");
    }
    if (timecode === this.#upstreamCursor) return this.#noChange();

    const diffUrl = new URL(`/api/v1.1/game/${game.gamePk}/feed/live/diffPatch`, MLB_STATS_API_ORIGIN);
    diffUrl.searchParams.set("startTimecode", this.#upstreamCursor);
    diffUrl.searchParams.set("endTimecode", timecode);
    return this.#advance(game, diffUrl.toString(), fullUrl.toString(), signal);
  }
}
