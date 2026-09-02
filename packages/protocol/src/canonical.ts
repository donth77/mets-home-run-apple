import type { NormalizedPlayEvidence, NormalizedUpdateMode } from "./core";
import type { AtBatState, GameHalf, GameLinescore, GamePhase, ReviewState, TeamScore } from "./game";

/** Values extracted once from a feed update before they split by purpose. */
export interface CanonicalGameFrame {
  gamePk: number;
  gameNumber: 1 | 2;
  cursor: string;
  updateMode: NormalizedUpdateMode;
  phase: GamePhase;
  label: string;
  away: TeamScore & { id: number };
  home: TeamScore & { id: number };
  inning: number;
  half: GameHalf;
  displayOuts: 0 | 1 | 2 | 3;
  evidenceOuts: 0 | 1 | 2 | 3;
  review: ReviewState;
  lastEvent: string;
  scheduledStart?: string;
  venue?: string;
  atBat?: AtBatState;
  linescore: GameLinescore;
  changedPlays: readonly NormalizedPlayEvidence[];
}
