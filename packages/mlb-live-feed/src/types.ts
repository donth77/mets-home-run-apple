import type { GameSnapshot, NormalizedGameInput } from "@apple/protocol";

type CoreInputEnvelope = NormalizedGameInput;

export type MlbHistoricalBookmarkKind = "HOME_RUN" | "GRAND_SLAM" | "METS_WIN" | "FINAL";

export interface MlbHistoricalBookmark {
  id: string;
  kind: MlbHistoricalBookmarkKind;
  label: string;
  detail: string;
  targetIndex: number;
  beforeIndex: number;
  targetTimecode: string;
  beforeTimecode: string;
  battingTeamId?: number;
}

export interface MlbHistoricalGameIndex {
  timestamps: readonly string[];
  bookmarks: readonly MlbHistoricalBookmark[];
}

export interface MlbCelebrationReplayCandidate {
  eventKey: string;
  kind: MlbHistoricalBookmarkKind;
  occurredAt: string;
}

/**
 * How a poll got its feed. FULL_FALLBACK means a full feed was fetched in place
 * of a usable diff: the patch failed, the diff answered past a replay target,
 * or the client trims feeds with `fields=` and so skips diffPatch.
 */
export type FeedPayloadKind = "FULL_BOOTSTRAP" | "DIFF_PATCH" | "FULL_DIFF_RESPONSE" | "FULL_FALLBACK" | "NO_CHANGE";

export interface NormalizedFeedCapture {
  /** Small evidence envelope consumed by the C++ rules engine. */
  coreInput: CoreInputEnvelope;
  /** Full read-only game state consumed by scoreboards and displays. */
  gameSnapshot: GameSnapshot;
  cursor: string;
  waitMs: number;
  payloadKind: Exclude<FeedPayloadKind, "NO_CHANGE">;
  receivedAt: string;
  rawPlayCount: number;
  changedPlayCount: number;
  /** Timestamped bootstrap evidence available to recording-only presentation clients. */
  replayCandidates: readonly MlbCelebrationReplayCandidate[];
}

export interface MlbPollResult {
  capture?: NormalizedFeedCapture;
  cursor: string;
  waitMs: number;
  payloadKind: FeedPayloadKind;
}
