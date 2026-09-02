import type { CanonicalGameFrame, GameSnapshot, NormalizedGameInput } from "@apple/protocol";
import { MlbFeedError } from "./errors";

export interface CanonicalGameProjection {
  gameSnapshot: GameSnapshot;
  coreInput: NormalizedGameInput;
}

export type CanonicalGameProjector = (frame: CanonicalGameFrame) => CanonicalGameProjection;

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
    scheduledStart: frame.scheduledStart,
    venue: frame.venue,
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

/** Established TypeScript projector retained as the production default and migration oracle. */
export function projectCanonicalGameFrame(frame: CanonicalGameFrame): CanonicalGameProjection {
  const gameSnapshot = projectGameSnapshot(frame);
  const coreInput = projectCoreInput(frame);
  assertFeedProjectionAgreement(gameSnapshot, coreInput);
  return { gameSnapshot, coreInput };
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
