import type {
  AppleCommand,
  AppleCoreEvent,
  CelebrationKind,
  DeviceFixtureDefinition,
  DeviceFixtureInputFrame,
  FixtureFrame,
  GameSnapshot,
  NormalizedGameInput,
  NormalizedPlayEvidence,
  PresentationSnapshot,
} from "@apple/protocol";

export const baseSnapshot: GameSnapshot = {
  schemaVersion: 1,
  gamePk: 777686,
  gameNumber: 1,
  phase: "LIVE",
  label: "LIVE",
  away: { id: 144, abbreviation: "ATL", name: "Atlanta", runs: 2 },
  home: { id: 121, abbreviation: "NYM", name: "Mets", runs: 2 },
  inning: 7,
  half: "BOTTOM",
  outs: 1,
  review: "NONE",
  lastEvent: "Pitch 4 · 92.8 mph sinker",
  atBat: {
    balls: 0,
    strikes: 1,
    bases: { first: true, second: true, third: false },
    batter: "Juan Soto",
    batterLine: "1–2",
    pitcher: "Strider",
    pitchCount: 20,
  },
  linescore: {
    innings: [
      { inning: 1, away: 0, home: 0 },
      { inning: 2, away: 1, home: 0 },
      { inning: 3, away: 0, home: 0 },
      { inning: 4, away: 1, home: 0 },
      { inning: 5, away: 0, home: 1 },
      { inning: 6, away: 0, home: 1 },
      { inning: 7, away: 0, home: null },
    ],
    awayHits: 6,
    homeHits: 5,
    awayErrors: 0,
    homeErrors: 0,
  },
};

function snapshot(overrides: Partial<PresentationSnapshot>): PresentationSnapshot {
  return {
    ...baseSnapshot,
    ...overrides,
    away: { ...baseSnapshot.away, ...(overrides.away ?? {}) },
    home: { ...baseSnapshot.home, ...(overrides.home ?? {}) },
  };
}

export function command(type: AppleCommand["type"], eventKey: string, positionMm?: number): AppleCommand {
  return {
    type,
    eventKey,
    ...(positionMm === undefined ? {} : { positionMm, deadlineMs: 5000 }),
  };
}

export function celebrationEvent(celebration: CelebrationKind, eventKey: string, subject: string): AppleCoreEvent {
  return { type: "CELEBRATION_STARTED", eventKey, celebration, subject };
}

export function frame(
  atMs: number,
  state: Partial<PresentationSnapshot>,
  positionMm: number,
  trace: string,
  commands: readonly AppleCommand[] = [],
  events: readonly AppleCoreEvent[] = [],
): FixtureFrame {
  return { atMs, snapshot: snapshot(state), positionMm, events, commands, trace };
}

export function normalizedInput(cursor: string, overrides: Partial<NormalizedGameInput> = {}): NormalizedGameInput {
  return {
    schemaVersion: 1,
    updateMode: "INCREMENTAL",
    gamePk: 777686,
    gameNumber: 1,
    cursor,
    phase: "LIVE",
    half: "BOTTOM",
    inning: 7,
    outs: 1,
    awayTeamId: 144,
    homeTeamId: 121,
    awayRuns: 2,
    homeRuns: 2,
    plays: [],
    ...overrides,
  };
}

export function normalizedHomeRun(
  eventKey: string,
  review: NormalizedPlayEvidence["review"] = "NONE",
): NormalizedPlayEvidence {
  return {
    eventKey,
    atBatIndex: 47,
    battingTeamId: 121,
    batterName: "Juan Soto",
    kind: "HOME_RUN",
    complete: true,
    review,
  };
}

export function normalizedGrandSlam(eventKey: string): NormalizedPlayEvidence {
  return {
    eventKey,
    atBatIndex: 48,
    battingTeamId: 121,
    batterName: "Pete Alonso",
    kind: "GRAND_SLAM",
    complete: true,
    review: "NONE",
  };
}

export function inputFrame(atMs: number, input: NormalizedGameInput): DeviceFixtureInputFrame {
  return { atMs, input };
}

export function deviceFixture(
  frames: readonly DeviceFixtureInputFrame[],
  expectedMotionSequences: number,
): DeviceFixtureDefinition {
  return { schemaVersion: 1, fixtureVersion: 1, frames, expectedMotionSequences };
}
