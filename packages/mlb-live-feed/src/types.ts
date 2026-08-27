import type { GameSnapshot, NormalizedGameInput } from "@apple/protocol";

type CoreInputEnvelope = NormalizedGameInput;

export type MlbHistoricalBookmarkKind = "HOME_RUN" | "FINAL";

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

export type FeedPayloadKind = "FULL_BOOTSTRAP" | "DIFF_PATCH" | "FULL_DIFF_RESPONSE" | "FULL_FALLBACK" | "NO_CHANGE";

export interface NormalizedFeedCapture {
  input: CoreInputEnvelope;
  snapshot: GameSnapshot;
  cursor: string;
  waitMs: number;
  payloadKind: Exclude<FeedPayloadKind, "NO_CHANGE">;
  receivedAt: string;
  rawPlayCount: number;
  changedPlayCount: number;
}

export interface MlbPollResult {
  capture?: NormalizedFeedCapture;
  cursor: string;
  waitMs: number;
  payloadKind: FeedPayloadKind;
}
