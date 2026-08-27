export type GamePhase = "PREGAME" | "LIVE" | "REVIEW" | "DELAYED" | "CELEBRATION" | "FINAL" | "SLEEP";

export type ReviewState = "NONE" | "PENDING" | "CONFIRMED" | "OVERTURNED";

export type AppleCommandType =
  | "DISPLAY_RENDER"
  | "MOTION_EXTEND"
  | "MOTION_RETRACT"
  | "MOTION_DISABLE"
  | "LED_CELEBRATE";

export interface TeamScore {
  id?: number;
  abbreviation: string;
  name: string;
  runs: number;
}

const MLB_TEAM_NICKNAMES: Readonly<Record<string, string>> = {
  ARI: "Diamondbacks",
  ATL: "Braves",
  ATH: "Athletics",
  BAL: "Orioles",
  BOS: "Red Sox",
  CHC: "Cubs",
  CHW: "White Sox",
  CIN: "Reds",
  CLE: "Guardians",
  COL: "Rockies",
  CWS: "White Sox",
  DET: "Tigers",
  HOU: "Astros",
  KC: "Royals",
  KCR: "Royals",
  LAA: "Angels",
  LAD: "Dodgers",
  MIA: "Marlins",
  MIL: "Brewers",
  MIN: "Twins",
  NYM: "Mets",
  NYY: "Yankees",
  OAK: "Athletics",
  PHI: "Phillies",
  PIT: "Pirates",
  SD: "Padres",
  SDP: "Padres",
  SEA: "Mariners",
  SF: "Giants",
  SFG: "Giants",
  STL: "Cardinals",
  TB: "Rays",
  TBR: "Rays",
  TEX: "Rangers",
  TOR: "Blue Jays",
  WAS: "Nationals",
  WSH: "Nationals",
};

export function mlbTeamNickname(team: Pick<TeamScore, "abbreviation" | "name">) {
  const suppliedName = team.name.trim();
  return MLB_TEAM_NICKNAMES[team.abbreviation.trim().toUpperCase()] ?? (suppliedName || team.abbreviation.trim());
}

export interface AtBatState {
  balls: 0 | 1 | 2 | 3;
  strikes: 0 | 1 | 2;
  bases: {
    first: boolean;
    second: boolean;
    third: boolean;
  };
  batter?: string;
  batterLine?: string;
  pitcher?: string;
  pitchCount?: number;
}

export interface InningScore {
  inning: number;
  away: number | null;
  home: number | null;
}

export interface GameLinescore {
  innings: readonly InningScore[];
  awayHits?: number;
  homeHits?: number;
  awayErrors?: number;
  homeErrors?: number;
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
  atBat?: AtBatState;
  linescore?: GameLinescore;
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
  deviceFixture: DeviceFixtureDefinition;
}

export type NormalizedUpdateMode = "BOOTSTRAP" | "INCREMENTAL";
export type NormalizedPlayKind = "OTHER" | "HOME_RUN";

export interface NormalizedPlayEvidence {
  eventKey: string;
  atBatIndex: number;
  battingTeamId: number;
  batterName: string;
  kind: NormalizedPlayKind;
  complete: boolean;
  review: ReviewState;
}

export interface NormalizedGameInput {
  schemaVersion: 1;
  updateMode: NormalizedUpdateMode;
  gamePk: number;
  gameNumber: 1 | 2;
  cursor: string;
  phase: GamePhase;
  half: GameSnapshot["half"];
  inning: number;
  outs: number;
  awayTeamId: number;
  homeTeamId: number;
  awayRuns: number;
  homeRuns: number;
  plays: readonly NormalizedPlayEvidence[];
}

export interface DeviceFixtureInputFrame {
  atMs: number;
  input: NormalizedGameInput;
}

export interface DeviceFixtureDefinition {
  schemaVersion: 1;
  fixtureVersion: 1;
  frames: readonly DeviceFixtureInputFrame[];
  expectedMotionSequences: number;
}

export type DeviceFixtureRunMode = "LOGIC_RECORDING" | "PHYSICAL";

export interface DeviceFixtureRunRequest {
  schemaVersion: 1;
  requestId: string;
  scenarioId: string;
  mode: DeviceFixtureRunMode;
  fixture: DeviceFixtureDefinition;
}

export type DeviceFixtureRunStatus = "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "CANCELLED";

export interface DeviceFixtureRunReceipt {
  schemaVersion: 1;
  requestId: string;
  scenarioId: string;
  mode: DeviceFixtureRunMode;
  status: DeviceFixtureRunStatus;
  currentFrame: number;
  totalFrames: number;
  recordedCommands: readonly AppleCommand[];
  trace: readonly string[];
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
