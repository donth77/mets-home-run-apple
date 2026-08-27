import type { FixtureScenario } from "@apple/protocol";
import { baseSnapshot, command, deviceFixture, frame, inputFrame, normalizedInput } from "../builders";

export const passiveScenarios: readonly FixtureScenario[] = [
  {
    id: "rain-delay",
    title: "Rain delay",
    shortLabel: "Delay",
    description: "The display reports the delay while all motion remains disabled.",
    frames: [
      frame(
        0,
        { phase: "DELAYED", label: "RAIN DELAY", lastEvent: "Game delayed · weather" },
        0,
        "Schedule status changed to delayed.",
      ),
      frame(
        3500,
        { phase: "DELAYED", label: "RAIN DELAY", lastEvent: "Waiting for official update" },
        0,
        "Bounded backoff active; no live-feed motion.",
      ),
    ],
    deviceFixture: deviceFixture(
      [
        inputFrame(
          0,
          normalizedInput("20260826_211500", {
            updateMode: "BOOTSTRAP",
            phase: "DELAYED",
          }),
        ),
        inputFrame(3500, normalizedInput("20260826_211510", { phase: "DELAYED" })),
      ],
      0,
    ),
  },
  {
    id: "mets-win",
    title: "Mets win",
    shortLabel: "Win",
    description: "A newly observed Mets final records the configured victory raise.",
    frames: [
      frame(
        0,
        { inning: 9, half: "TOP", outs: 2, home: { ...baseSnapshot.home, runs: 4 }, lastEvent: "Two outs, top ninth" },
        0,
        "Final-out candidate received.",
      ),
      frame(
        1200,
        {
          phase: "CELEBRATION",
          label: "METS WIN!",
          inning: 9,
          half: "END",
          outs: 3,
          home: { ...baseSnapshot.home, runs: 4 },
          lastEvent: "Mets win! Put it in the books!",
        },
        0,
        "Final transition persisted; display celebration begins.",
        [command("DISPLAY_RENDER", "777686:final"), command("LED_CELEBRATE", "777686:final")],
      ),
      frame(
        3200,
        {
          phase: "CELEBRATION",
          label: "METS WIN!",
          inning: 9,
          half: "END",
          outs: 3,
          home: { ...baseSnapshot.home, runs: 4 },
          lastEvent: "Mets win · actuator extending at 15.24 mm/s",
        },
        50,
        "Victory extend recorded after the display lead-in.",
        [command("MOTION_EXTEND", "777686:final", 50)],
      ),
      frame(
        6500,
        {
          phase: "CELEBRATION",
          label: "METS WIN!",
          inning: 9,
          half: "END",
          outs: 3,
          home: { ...baseSnapshot.home, runs: 4 },
          lastEvent: "Mets win · victory dwell",
        },
        50,
        "Extended limit reached; thirty-second win dwell begins.",
      ),
      frame(
        36500,
        {
          phase: "FINAL",
          label: "FINAL",
          inning: 9,
          half: "END",
          outs: 3,
          home: { ...baseSnapshot.home, runs: 4 },
          lastEvent: "Mets win · Apple returning home",
        },
        0,
        "Thirty-second victory dwell complete; retract recorded.",
        [command("MOTION_RETRACT", "777686:final", 0)],
      ),
      frame(
        39800,
        {
          phase: "FINAL",
          label: "FINAL",
          inning: 9,
          half: "END",
          outs: 3,
          home: { ...baseSnapshot.home, runs: 4 },
          lastEvent: "Mets win! Final.",
        },
        0,
        "Retracted limit reached; victory sequence complete.",
      ),
    ],
    deviceFixture: deviceFixture(
      [
        inputFrame(
          0,
          normalizedInput("20260826_221500", {
            updateMode: "BOOTSTRAP",
            inning: 9,
            half: "TOP",
            outs: 2,
            homeRuns: 4,
            awayRuns: 4,
          }),
        ),
        inputFrame(
          1200,
          normalizedInput("20260826_221510", {
            phase: "FINAL",
            inning: 9,
            half: "END",
            outs: 3,
            homeRuns: 5,
            awayRuns: 4,
          }),
        ),
      ],
      1,
    ),
  },
  {
    id: "doubleheader",
    title: "Doubleheader handoff",
    shortLabel: "G1 → G2",
    description: "Game one completes while game two remains independently armed.",
    frames: [
      frame(
        0,
        { phase: "FINAL", label: "G1 FINAL", inning: 9, half: "END", outs: 3, lastEvent: "Game one complete" },
        0,
        "Game 1 context finalized.",
      ),
      frame(
        2200,
        {
          gamePk: 777687,
          gameNumber: 2,
          phase: "PREGAME",
          label: "GAME 2 · 7:10 PM",
          inning: 1,
          half: "TOP",
          outs: 0,
          away: { id: 144, abbreviation: "ATL", name: "Atlanta", runs: 0 },
          home: { id: 121, abbreviation: "NYM", name: "Mets", runs: 0 },
          lastEvent: "Game two scheduled",
        },
        0,
        "Game 2 context selected without replaying Game 1.",
      ),
    ],
    deviceFixture: deviceFixture(
      [
        inputFrame(
          0,
          normalizedInput("20260826_180000", {
            updateMode: "BOOTSTRAP",
            gamePk: 777686,
            gameNumber: 1,
            phase: "FINAL",
            inning: 9,
            half: "END",
            outs: 3,
            awayRuns: 4,
            homeRuns: 3,
          }),
        ),
        inputFrame(
          2200,
          normalizedInput("20260826_220000", {
            updateMode: "BOOTSTRAP",
            gamePk: 777687,
            gameNumber: 2,
            phase: "PREGAME",
            inning: 1,
            half: "TOP",
            outs: 0,
            awayRuns: 0,
            homeRuns: 0,
          }),
        ),
      ],
      0,
    ),
  },
  {
    id: "sleep",
    title: "Between games",
    shortLabel: "Sleep",
    description: "The Apple rests at home with only the next-game card visible.",
    frames: [
      frame(
        0,
        {
          phase: "SLEEP",
          label: "NEXT GAME FRI 7:10 PM",
          inning: 1,
          half: "TOP",
          outs: 0,
          away: { id: 146, abbreviation: "MIA", name: "Miami", runs: 0 },
          home: { id: 121, abbreviation: "NYM", name: "Mets", runs: 0 },
          lastEvent: "Low-duty schedule sleep",
        },
        0,
        "Wake plan set; recording motion disabled.",
      ),
    ],
    deviceFixture: deviceFixture(
      [
        inputFrame(
          0,
          normalizedInput("20260827_020000", {
            updateMode: "BOOTSTRAP",
            phase: "SLEEP",
            awayTeamId: 146,
            awayRuns: 0,
            homeRuns: 0,
          }),
        ),
      ],
      0,
    ),
  },
  {
    id: "offseason",
    title: "Offseason",
    shortLabel: "Offseason",
    description: "The public display rests without showing an in-game scorebug or matchup.",
    frames: [
      frame(
        0,
        {
          phase: "SLEEP",
          label: "OFFSEASON",
          inning: 1,
          half: "TOP",
          outs: 0,
          atBat: undefined,
          linescore: undefined,
          lastEvent: "The Apple is resting until baseball returns to Citi Field",
        },
        0,
        "Offseason presentation active; recording motion disabled.",
      ),
    ],
    deviceFixture: deviceFixture(
      [
        inputFrame(
          0,
          normalizedInput("20261115_120000", {
            updateMode: "BOOTSTRAP",
            phase: "SLEEP",
            awayRuns: 0,
            homeRuns: 0,
          }),
        ),
      ],
      0,
    ),
  },
] as const;
