import type { AppleCommand, FixtureFrame, FixtureScenario, GameSnapshot } from "@apple/protocol";

const baseSnapshot: GameSnapshot = {
  schemaVersion: 1,
  gamePk: 777686,
  gameNumber: 1,
  phase: "LIVE",
  label: "LIVE",
  away: { abbreviation: "ATL", name: "Atlanta", runs: 2 },
  home: { abbreviation: "NYM", name: "Mets", runs: 2 },
  inning: 7,
  half: "BOTTOM",
  outs: 1,
  review: "NONE",
  lastEvent: "Pitch 4 · 92.8 mph sinker",
};

function snapshot(overrides: Partial<GameSnapshot>): GameSnapshot {
  return {
    ...baseSnapshot,
    ...overrides,
    away: { ...baseSnapshot.away, ...(overrides.away ?? {}) },
    home: { ...baseSnapshot.home, ...(overrides.home ?? {}) },
  };
}

function command(type: AppleCommand["type"], eventKey: string, positionMm?: number): AppleCommand {
  return {
    type,
    eventKey,
    ...(positionMm === undefined ? {} : { positionMm, deadlineMs: 2800 }),
  };
}

function frame(
  atMs: number,
  state: Partial<GameSnapshot>,
  positionMm: number,
  trace: string,
  commands: readonly AppleCommand[] = [],
): FixtureFrame {
  return { atMs, snapshot: snapshot(state), positionMm, commands, trace };
}

export const fixtureScenarios: readonly FixtureScenario[] = [
  {
    id: "live",
    title: "Ordinary live inning",
    shortLabel: "Live",
    description: "Scoreboard updates while recording motion remains home.",
    frames: [
      frame(0, {}, 0, "Bootstrap accepted; historical event ledger seeded."),
      frame(1800, { outs: 2, lastEvent: "Called strike three" }, 0, "Pitch patch accepted; outs advanced to two."),
      frame(3600, { inning: 8, half: "TOP", outs: 0, lastEvent: "Side retired" }, 0, "Half-inning transition rendered."),
    ],
  },
  {
    id: "home-run",
    title: "Confirmed Mets home run",
    shortLabel: "Home run",
    description: "One completed Mets home run records exactly one raise/lower sequence.",
    frames: [
      frame(0, {}, 0, "Patch cursor 20260826_211510 accepted."),
      frame(
        900,
        { phase: "CELEBRATION", label: "HOME RUN", home: { ...baseSnapshot.home, runs: 3 }, lastEvent: "Mets home run · play-47" },
        50,
        "Event 777686:play-47 persisted before motion command.",
        [command("DISPLAY_RENDER", "777686:play-47"), command("LED_CELEBRATE", "777686:play-47"), command("MOTION_EXTEND", "777686:play-47", 50)],
      ),
      frame(3300, { phase: "CELEBRATION", label: "APPLE UP", home: { ...baseSnapshot.home, runs: 3 }, lastEvent: "Celebration dwell" }, 50, "Extend deadline cleared; recording adapter reports 50 mm."),
      frame(4700, { phase: "LIVE", label: "RETURNING", home: { ...baseSnapshot.home, runs: 3 }, lastEvent: "Apple returning home" }, 0, "Retract command recorded.", [command("MOTION_RETRACT", "777686:play-47", 0)]),
      frame(6500, { phase: "LIVE", label: "LIVE", home: { ...baseSnapshot.home, runs: 3 }, lastEvent: "Play resumed" }, 0, "Sequence complete; event remains deduplicated."),
    ],
  },
  {
    id: "review-confirmed",
    title: "Review, then confirmed",
    shortLabel: "Review + confirm",
    description: "Motion stays disabled while the play is under review, then runs once after confirmation.",
    frames: [
      frame(0, {}, 0, "Live pitch accepted."),
      frame(900, { phase: "REVIEW", label: "UNDER REVIEW", review: "PENDING", lastEvent: "Potential home run under review" }, 0, "Review pending; fail-still gate active.", [command("MOTION_DISABLE", "777686:play-52")]),
      frame(3200, { phase: "CELEBRATION", label: "CALL CONFIRMED", review: "CONFIRMED", home: { ...baseSnapshot.home, runs: 3 }, lastEvent: "Review confirmed home run" }, 50, "Confirmed event persisted; extend recorded.", [command("MOTION_EXTEND", "777686:play-52", 50)]),
      frame(5600, { phase: "LIVE", label: "RETURNING", review: "CONFIRMED", home: { ...baseSnapshot.home, runs: 3 } }, 0, "Retract recorded after confirmed celebration.", [command("MOTION_RETRACT", "777686:play-52", 0)]),
    ],
  },
  {
    id: "review-overturned",
    title: "Review overturned",
    shortLabel: "Overturned",
    description: "The pending play is overturned and produces no motion command.",
    frames: [
      frame(0, { phase: "REVIEW", label: "UNDER REVIEW", review: "PENDING", lastEvent: "Potential home run under review" }, 0, "Review pending; motion disabled."),
      frame(2800, { phase: "LIVE", label: "OVERTURNED", review: "OVERTURNED", lastEvent: "Foul ball after review" }, 0, "Call overturned; candidate event discarded."),
      frame(4600, { phase: "LIVE", label: "LIVE", review: "OVERTURNED", lastEvent: "At-bat continues" }, 0, "No ledger write and no motion command."),
    ],
  },
  {
    id: "rain-delay",
    title: "Rain delay",
    shortLabel: "Delay",
    description: "The display reports the delay while all motion remains disabled.",
    frames: [
      frame(0, { phase: "DELAYED", label: "RAIN DELAY", lastEvent: "Game delayed · weather" }, 0, "Schedule status changed to delayed."),
      frame(3500, { phase: "DELAYED", label: "RAIN DELAY", lastEvent: "Waiting for official update" }, 0, "Bounded backoff active; no live-feed motion."),
    ],
  },
  {
    id: "mets-win",
    title: "Mets win",
    shortLabel: "Win",
    description: "A newly observed Mets final records the configured victory raise.",
    frames: [
      frame(0, { inning: 9, half: "TOP", outs: 2, home: { ...baseSnapshot.home, runs: 4 }, lastEvent: "Two outs, top ninth" }, 0, "Final-out candidate received."),
      frame(1200, { phase: "CELEBRATION", label: "METS WIN", inning: 9, half: "END", outs: 3, home: { ...baseSnapshot.home, runs: 4 }, lastEvent: "Mets win · final" }, 50, "Final transition persisted; victory raise recorded.", [command("MOTION_EXTEND", "777686:final", 50)]),
      frame(5000, { phase: "FINAL", label: "FINAL", inning: 9, half: "END", outs: 3, home: { ...baseSnapshot.home, runs: 4 }, lastEvent: "Final" }, 0, "Victory sequence returned home.", [command("MOTION_RETRACT", "777686:final", 0)]),
    ],
  },
  {
    id: "doubleheader",
    title: "Doubleheader handoff",
    shortLabel: "G1 → G2",
    description: "Game one completes while game two remains independently armed.",
    frames: [
      frame(0, { phase: "FINAL", label: "G1 FINAL", inning: 9, half: "END", outs: 3, lastEvent: "Game one complete" }, 0, "Game 1 context finalized."),
      frame(2200, { gamePk: 777687, gameNumber: 2, phase: "PREGAME", label: "GAME 2 · 7:10 PM", inning: 1, half: "TOP", outs: 0, away: { abbreviation: "ATL", name: "Atlanta", runs: 0 }, home: { abbreviation: "NYM", name: "Mets", runs: 0 }, lastEvent: "Game two scheduled" }, 0, "Game 2 context selected without replaying Game 1."),
    ],
  },
  {
    id: "sleep",
    title: "Between games",
    shortLabel: "Sleep",
    description: "The Apple rests at home with only the next-game card visible.",
    frames: [
      frame(0, { phase: "SLEEP", label: "NEXT GAME · FRI 7:10 PM", inning: 1, half: "TOP", outs: 0, away: { abbreviation: "MIA", name: "Miami", runs: 0 }, home: { abbreviation: "NYM", name: "Mets", runs: 0 }, lastEvent: "Low-duty schedule sleep" }, 0, "Wake plan set; recording motion disabled."),
    ],
  },
] as const;

export function getScenario(id: string): FixtureScenario {
  return fixtureScenarios.find((scenario) => scenario.id === id) ?? fixtureScenarios[0];
}

export function scenarioDuration(scenario: FixtureScenario): number {
  return scenario.frames.at(-1)?.atMs ?? 0;
}

export function frameAt(scenario: FixtureScenario, atMs: number): FixtureFrame {
  let active = scenario.frames[0];
  for (const candidate of scenario.frames) {
    if (candidate.atMs > atMs) break;
    active = candidate;
  }
  return active;
}

export function nextFrameAt(scenario: FixtureScenario, atMs: number): number {
  return scenario.frames.find((candidate) => candidate.atMs > atMs)?.atMs ?? scenarioDuration(scenario);
}
