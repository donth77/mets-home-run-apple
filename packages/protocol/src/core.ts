import type { GameHalf, GamePhase, ReviewState } from "./game";

export type AppleCommandType = "MOTION_EXTEND" | "MOTION_RETRACT" | "MOTION_DISABLE";

export type CelebrationKind = "HOME_RUN" | "METS_WIN" | "GRAND_SLAM";

export interface AppleCommand {
  type: AppleCommandType;
  eventKey: string;
  positionMm?: number;
  deadlineMs?: number;
}

/** A decision made by the core. Each target decides how to present it. */
export interface AppleCoreEvent {
  type: "CELEBRATION_STARTED";
  eventKey: string;
  celebration: CelebrationKind;
  subject: string;
}

export type NormalizedUpdateMode = "BOOTSTRAP" | "INCREMENTAL";
export type NormalizedPlayKind = "OTHER" | "HOME_RUN" | "GRAND_SLAM";

export interface NormalizedPlayEvidence {
  eventKey: string;
  atBatIndex: number;
  battingTeamId: number;
  batterName: string;
  kind: NormalizedPlayKind;
  complete: boolean;
  review: ReviewState;
}

/** The small, display-free input used by the C++ decision engine. */
export interface NormalizedGameInput {
  schemaVersion: 1;
  updateMode: NormalizedUpdateMode;
  gamePk: number;
  gameNumber: 1 | 2;
  cursor: string;
  phase: GamePhase;
  half: GameHalf;
  inning: number;
  outs: number;
  awayTeamId: number;
  homeTeamId: number;
  awayRuns: number;
  homeRuns: number;
  plays: readonly NormalizedPlayEvidence[];
}

export const MAX_STROKE_MM = 50;

export function clampPositionMm(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_STROKE_MM, Math.max(0, Math.round(value)));
}
