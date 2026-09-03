export type GamePhase = "PREGAME" | "LIVE" | "REVIEW" | "DELAYED" | "FINAL" | "SLEEP";

/** CELEBRATION is a screen state, not a state reported by MLB. */
export type PresentationPhase = GamePhase | "CELEBRATION";

export type GameHalf = "TOP" | "BOTTOM" | "MIDDLE" | "END";

export type ReviewState = "NONE" | "PENDING" | "CONFIRMED" | "OVERTURNED";

export interface TeamScore {
  id?: number;
  abbreviation: string;
  name: string;
  runs: number;
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

interface SnapshotBase {
  schemaVersion: 1;
  gamePk: number;
  gameNumber: 1 | 2;
  label: string;
  away: TeamScore;
  home: TeamScore;
  inning: number;
  half: GameHalf;
  outs: 0 | 1 | 2 | 3;
  review: ReviewState;
  lastEvent: string;
  /** UTC MLB start time when the feed supplies it. Renderers choose a local zone. */
  scheduledStart?: string;
  venue?: string;
  atBat?: AtBatState;
  linescore?: GameLinescore;
}

/** The authoritative game state projected from the MLB feed. */
export interface GameSnapshot extends SnapshotBase {
  phase: GamePhase;
}

/** A screen-ready snapshot that may temporarily show a celebration. */
export interface PresentationSnapshot extends SnapshotBase {
  phase: PresentationPhase;
}

/** MLB status facts an adapter reads from one live feed before classification. */
export interface GameStatusFacts {
  abstractState: string;
  detailedState: string;
  statusCode: string;
  reason: string;
  /** Description of the newest "Game Advisory" event on the current play, or "". */
  latestAdvisory: string;
  reviewPending: boolean;
}

export interface GameStatusClassification {
  phase: GamePhase;
  /** "LIVE", "FINAL", "PLAY UNDER REVIEW", "RAIN DELAY", else MLB's detailed state. */
  label: string;
  /** A delay MLB attributes to rain, inclement weather, lightning, or wet grounds. */
  weatherDelay: boolean;
}

export type GameStatusClassifier = (facts: GameStatusFacts) => GameStatusClassification;
