import type { FixtureScenario } from "@apple/protocol";
import {
  baseSnapshot,
  command,
  deviceFixture,
  frame,
  inputFrame,
  normalizedHomeRun,
  normalizedInput,
} from "../builders";

export const gameplayScenarios: readonly FixtureScenario[] = [
  {
    id: "live",
    title: "Ordinary live inning",
    shortLabel: "Live",
    description: "Scoreboard updates while recording motion remains home.",
    frames: [
      frame(0, {}, 0, "Bootstrap accepted; historical event ledger seeded."),
      frame(1800, { outs: 2, lastEvent: "Called strike three" }, 0, "Pitch patch accepted; outs advanced to two."),
      frame(
        3600,
        {
          inning: 8,
          half: "TOP",
          outs: 0,
          lastEvent: "Top eighth begins",
          atBat: {
            balls: 0,
            strikes: 0,
            bases: { first: false, second: false, third: false },
            batter: "Ronald Acuña Jr.",
            batterLine: "0–3",
            pitcher: "Kodai Senga",
            pitchCount: 87,
          },
        },
        0,
        "Half-inning transition rendered.",
      ),
    ],
    deviceFixture: deviceFixture(
      [
        inputFrame(0, normalizedInput("20260826_211500", { updateMode: "BOOTSTRAP" })),
        inputFrame(1800, normalizedInput("20260826_211510", { outs: 2 })),
        inputFrame(3600, normalizedInput("20260826_211520", { inning: 8, half: "TOP", outs: 0 })),
      ],
      0,
    ),
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
        {
          phase: "CELEBRATION",
          label: "JUAN SOTO · HOME RUN",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto homers to right field",
        },
        0,
        "Event 777686:play-47 persisted; display animation begins before motion.",
        [command("DISPLAY_RENDER", "777686:play-47"), command("LED_CELEBRATE", "777686:play-47")],
      ),
      frame(
        2900,
        {
          phase: "CELEBRATION",
          label: "JUAN SOTO · HOME RUN",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto HR · actuator extending at 15.24 mm/s",
        },
        50,
        "Two-second display lead-in complete; extend command recorded.",
        [command("MOTION_EXTEND", "777686:play-47", 50)],
      ),
      frame(
        6200,
        {
          phase: "CELEBRATION",
          label: "JUAN SOTO · HOME RUN",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto HR · celebration dwell",
        },
        50,
        "Extended limit reached after the rated 3.28-second stroke.",
      ),
      frame(
        36200,
        {
          phase: "CELEBRATION",
          label: "JUAN SOTO · HOME RUN",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto HR · Apple returning home",
        },
        0,
        "Thirty-second raised dwell complete; retract command recorded.",
        [command("MOTION_RETRACT", "777686:play-47", 0)],
      ),
      frame(
        39500,
        { phase: "LIVE", label: "LIVE", home: { ...baseSnapshot.home, runs: 3 }, lastEvent: "Play resumed" },
        0,
        "Retracted limit reached; event remains deduplicated.",
      ),
    ],
    deviceFixture: deviceFixture(
      [
        inputFrame(0, normalizedInput("20260826_211500", { updateMode: "BOOTSTRAP" })),
        inputFrame(
          900,
          normalizedInput("20260826_211510", {
            homeRuns: 3,
            plays: [normalizedHomeRun("777686:play-47")],
          }),
        ),
      ],
      1,
    ),
  },
  {
    id: "review-confirmed",
    title: "Review, then confirmed",
    shortLabel: "Review + confirm",
    description: "Motion stays disabled while the play is under review, then runs once after confirmation.",
    frames: [
      frame(0, {}, 0, "Live pitch accepted."),
      frame(
        900,
        { phase: "REVIEW", label: "UNDER REVIEW", review: "PENDING", lastEvent: "Potential home run under review" },
        0,
        "Review pending; fail-still gate active.",
        [command("MOTION_DISABLE", "777686:play-52")],
      ),
      frame(
        3200,
        {
          phase: "CELEBRATION",
          label: "JUAN SOTO · HR CONFIRMED",
          review: "CONFIRMED",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto home run confirmed after review",
        },
        0,
        "Confirmed event persisted; display lead-in begins.",
        [command("DISPLAY_RENDER", "777686:play-52"), command("LED_CELEBRATE", "777686:play-52")],
      ),
      frame(
        5200,
        {
          phase: "CELEBRATION",
          label: "JUAN SOTO · HR CONFIRMED",
          review: "CONFIRMED",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto HR · actuator extending at 15.24 mm/s",
        },
        50,
        "Display lead-in complete; extend recorded.",
        [command("MOTION_EXTEND", "777686:play-52", 50)],
      ),
      frame(
        8500,
        {
          phase: "CELEBRATION",
          label: "JUAN SOTO · HR CONFIRMED",
          review: "CONFIRMED",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto HR · celebration dwell",
        },
        50,
        "Extended limit reached.",
      ),
      frame(
        38500,
        {
          phase: "CELEBRATION",
          label: "JUAN SOTO · HR CONFIRMED",
          review: "CONFIRMED",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto HR · Apple returning home",
        },
        0,
        "Thirty-second raised dwell complete; retract recorded.",
        [command("MOTION_RETRACT", "777686:play-52", 0)],
      ),
      frame(
        41800,
        {
          phase: "LIVE",
          label: "LIVE",
          review: "CONFIRMED",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Play resumed",
        },
        0,
        "Retracted limit reached after confirmed celebration.",
      ),
    ],
    deviceFixture: deviceFixture(
      [
        inputFrame(0, normalizedInput("20260826_211500", { updateMode: "BOOTSTRAP" })),
        inputFrame(
          900,
          normalizedInput("20260826_211510", {
            phase: "REVIEW",
            homeRuns: 3,
            plays: [normalizedHomeRun("777686:play-52", "PENDING")],
          }),
        ),
        inputFrame(
          3200,
          normalizedInput("20260826_211520", {
            homeRuns: 3,
            plays: [normalizedHomeRun("777686:play-52", "CONFIRMED")],
          }),
        ),
      ],
      1,
    ),
  },
  {
    id: "review-overturned",
    title: "Review overturned",
    shortLabel: "Overturned",
    description: "The pending play is overturned and produces no motion command.",
    frames: [
      frame(
        0,
        { phase: "REVIEW", label: "UNDER REVIEW", review: "PENDING", lastEvent: "Potential home run under review" },
        0,
        "Review pending; motion disabled.",
      ),
      frame(
        2800,
        { phase: "LIVE", label: "OVERTURNED", review: "OVERTURNED", lastEvent: "Foul ball after review" },
        0,
        "Call overturned; candidate event discarded.",
      ),
      frame(
        4600,
        { phase: "LIVE", label: "LIVE", review: "OVERTURNED", lastEvent: "At-bat continues" },
        0,
        "No ledger write and no motion command.",
      ),
    ],
    deviceFixture: deviceFixture(
      [
        inputFrame(0, normalizedInput("20260826_211500", { updateMode: "BOOTSTRAP" })),
        inputFrame(
          900,
          normalizedInput("20260826_211510", {
            phase: "REVIEW",
            plays: [normalizedHomeRun("777686:play-52", "PENDING")],
          }),
        ),
        inputFrame(
          2800,
          normalizedInput("20260826_211520", {
            plays: [normalizedHomeRun("777686:play-52", "OVERTURNED")],
          }),
        ),
      ],
      0,
    ),
  },
] as const;
