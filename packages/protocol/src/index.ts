export type GamePhase =
  | "PREGAME"
  | "LIVE"
  | "REVIEW"
  | "DELAYED"
  | "CELEBRATION"
  | "FINAL"
  | "SLEEP";

export type ReviewState = "NONE" | "PENDING" | "CONFIRMED" | "OVERTURNED";

export type AppleCommandType =
  | "DISPLAY_RENDER"
  | "MOTION_EXTEND"
  | "MOTION_RETRACT"
  | "MOTION_DISABLE"
  | "LED_CELEBRATE";

export interface TeamScore {
  abbreviation: string;
  name: string;
  runs: number;
}

export interface GameSnapshot {
  schemaVersion: 1;
  gamePk: number;
  gameNumber: 1 | 2;
  phase: GamePhase;
  label: string;
  away: TeamScore;
  home: TeamScore;
  inning: number;
  half: "TOP" | "BOTTOM" | "MIDDLE" | "END";
  outs: 0 | 1 | 2 | 3;
  review: ReviewState;
  lastEvent: string;
}

export interface AppleCommand {
  type: AppleCommandType;
  eventKey: string;
  positionMm?: number;
  deadlineMs?: number;
}

export interface FixtureFrame {
  atMs: number;
  snapshot: GameSnapshot;
  positionMm: number;
  commands: readonly AppleCommand[];
  trace: string;
}

export interface FixtureScenario {
  id: string;
  title: string;
  shortLabel: string;
  description: string;
  frames: readonly FixtureFrame[];
}

export const MAX_STROKE_MM = 50;

export function clampPositionMm(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_STROKE_MM, Math.max(0, Math.round(value)));
}

export function inningLabel(snapshot: GameSnapshot): string {
  if (snapshot.phase === "FINAL") return "FINAL";
  if (snapshot.phase === "DELAYED") return "DELAY";
  if (snapshot.phase === "SLEEP") return "OFF";
  const half = snapshot.half === "TOP" ? "TOP" : snapshot.half === "BOTTOM" ? "BOT" : snapshot.half;
  return `${half} ${snapshot.inning}`;
}
