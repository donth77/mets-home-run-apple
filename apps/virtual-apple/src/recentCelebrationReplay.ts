import type { NormalizedFeedCapture } from "@apple/mlb-live-feed";
import type { NormalizedGameInput } from "@apple/protocol";

export const RECENT_CELEBRATION_REPLAY_WINDOW_MS = 5 * 60_000;

const VIRTUAL_REPLAY_BOOTSTRAP_CURSOR = "00000000_000000";

export interface RecentCelebrationReplayPlan {
  bootstrapInput: NormalizedGameInput;
  replayInput: NormalizedGameInput;
  eventKeys: readonly string[];
}

function isFreshEvent(occurredAt: string, nowMs: number) {
  const occurredAtMs = Date.parse(occurredAt);
  if (!Number.isFinite(occurredAtMs)) return false;
  const ageMs = nowMs - occurredAtMs;
  return ageMs >= 0 && ageMs <= RECENT_CELEBRATION_REPLAY_WINDOW_MS;
}

/**
 * Reframes only fresh bootstrap evidence as an incremental update for the
 * Virtual Apple. The unchanged C++ core still decides whether each event is a
 * valid Mets celebration and runs the canonical sequence; physical clients
 * continue ingesting the original bootstrap and never replay history.
 */
export function buildRecentCelebrationReplay(
  capture: NormalizedFeedCapture,
  nowMs: number,
  consumedEventKeys: ReadonlySet<string> = new Set(),
): RecentCelebrationReplayPlan | undefined {
  const input = capture.coreInput;
  if (input.updateMode !== "BOOTSTRAP") return undefined;

  const freshCandidates = (capture.replayCandidates ?? []).filter(
    ({ eventKey, occurredAt }) => !consumedEventKeys.has(eventKey) && isFreshEvent(occurredAt, nowMs),
  );
  const freshPlayKeys = new Set(
    freshCandidates.filter(({ kind }) => kind === "HOME_RUN" || kind === "GRAND_SLAM").map(({ eventKey }) => eventKey),
  );
  const replayPlays = input.plays.filter(({ eventKey }) => freshPlayKeys.has(eventKey));
  const replayFinal =
    input.phase === "FINAL" &&
    freshCandidates.some(({ eventKey, kind }) => kind === "FINAL" && eventKey === `${input.gamePk}:final`);
  if (replayPlays.length === 0 && !replayFinal) return undefined;

  const replayedPlayKeys = new Set(replayPlays.map(({ eventKey }) => eventKey));
  const eventKeys = freshCandidates
    .filter(({ eventKey, kind }) => replayedPlayKeys.has(eventKey) || (replayFinal && kind === "FINAL"))
    .map(({ eventKey }) => eventKey);

  return {
    bootstrapInput: {
      ...input,
      updateMode: "BOOTSTRAP",
      cursor: VIRTUAL_REPLAY_BOOTSTRAP_CURSOR,
      phase: replayFinal ? "LIVE" : input.phase,
      plays: input.plays.filter(({ eventKey }) => !replayedPlayKeys.has(eventKey)),
    },
    replayInput: {
      ...input,
      updateMode: "INCREMENTAL",
      plays: replayPlays,
    },
    eventKeys,
  };
}
