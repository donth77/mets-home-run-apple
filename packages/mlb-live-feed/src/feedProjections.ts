import type {
  AtBatState,
  GameHalf,
  GameLinescore,
  GamePhase,
  GameSnapshot,
  NormalizedGameInput,
  NormalizedPlayEvidence,
  NormalizedUpdateMode,
  ReviewState,
  TeamScore,
} from "@apple/protocol";
import { MlbFeedError } from "./errors";

/** Values parsed once from an MLB feed update before they split by purpose. */
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
  atBat?: AtBatState;
  linescore: GameLinescore;
  changedPlays: readonly NormalizedPlayEvidence[];
}

/** Full game state for scoreboards and other read-only views. */
export function projectGameSnapshot(frame: CanonicalGameFrame): GameSnapshot {
  return {
    schemaVersion: 1,
    gamePk: frame.gamePk,
    gameNumber: frame.gameNumber,
    phase: frame.phase,
    label: frame.label,
    away: frame.away,
    home: frame.home,
    inning: frame.inning,
    half: frame.half,
    outs: frame.displayOuts,
    review: frame.review,
    lastEvent: frame.lastEvent,
    atBat: frame.atBat,
    linescore: frame.linescore,
  };
}

/** Minimal evidence for the C++ rules and motion engine. */
export function projectCoreInput(frame: CanonicalGameFrame): NormalizedGameInput {
  return {
    schemaVersion: 1,
    updateMode: frame.updateMode,
    gamePk: frame.gamePk,
    gameNumber: frame.gameNumber,
    cursor: frame.cursor,
    phase: frame.phase,
    half: frame.half,
    inning: frame.inning,
    outs: frame.evidenceOuts,
    awayTeamId: frame.away.id,
    homeTeamId: frame.home.id,
    awayRuns: frame.away.runs,
    homeRuns: frame.home.runs,
    plays: frame.changedPlays,
  };
}

/** Catch accidental disagreement in fields shared by both projections. */
export function assertFeedProjectionAgreement(gameSnapshot: GameSnapshot, coreInput: NormalizedGameInput): void {
  const agrees =
    gameSnapshot.gamePk === coreInput.gamePk &&
    gameSnapshot.gameNumber === coreInput.gameNumber &&
    gameSnapshot.phase === coreInput.phase &&
    gameSnapshot.half === coreInput.half &&
    gameSnapshot.inning === coreInput.inning &&
    gameSnapshot.away.id === coreInput.awayTeamId &&
    gameSnapshot.home.id === coreInput.homeTeamId &&
    gameSnapshot.away.runs === coreInput.awayRuns &&
    gameSnapshot.home.runs === coreInput.homeRuns;
  if (!agrees) {
    throw new MlbFeedError("The game and core projections disagree on shared feed data.", "INVALID_FEED_SHAPE");
  }
}
