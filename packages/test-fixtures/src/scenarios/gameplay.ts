import type { AtBatState, FixtureScenario } from "@apple/protocol";
import {
  baseSnapshot,
  celebrationEvent,
  command,
  deviceFixture,
  frame,
  inputFrame,
  normalizedGrandSlam,
  normalizedHomeRun,
  normalizedInput,
} from "../builders";

const grandSlamAtBat: AtBatState = {
  balls: 1,
  strikes: 1,
  bases: { first: true, second: true, third: true },
  batter: "Francisco Lindor",
  batterLine: "1–3",
  pitcher: "Strider",
  pitchCount: 20,
};

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
        [],
        [celebrationEvent("HOME_RUN", "777686:play-47", "Juan Soto")],
      ),
      frame(
        2900,
        {
          phase: "CELEBRATION",
          label: "JUAN SOTO · HOME RUN",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto HR · actuator extending at 9.80 mm/s",
        },
        50,
        "Two-second display lead-in complete; extend command recorded.",
        [command("MOTION_EXTEND", "777686:play-47", 50)],
      ),
      frame(
        8000,
        {
          phase: "CELEBRATION",
          label: "JUAN SOTO · HOME RUN",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto HR · celebration dwell",
        },
        50,
        "Extended limit reached after the measured 5.10-second stroke.",
      ),
      frame(
        38000,
        {
          phase: "LIVE",
          label: "LIVE",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto HR · Apple returning home",
        },
        0,
        "Thirty-second raised dwell complete; retract command recorded.",
        [command("MOTION_RETRACT", "777686:play-47", 0)],
      ),
      frame(
        43100,
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
    id: "grand-slam",
    title: "Mets grand slam",
    shortLabel: "Grand slam",
    description: "A completed four-RBI Mets home run uses the standard raise/lower sequence with special labeling.",
    frames: [
      frame(
        0,
        {
          atBat: grandSlamAtBat,
        },
        0,
        "Bases loaded; patch cursor 20260826_211510 accepted.",
      ),
      frame(
        900,
        {
          phase: "CELEBRATION",
          label: "GRAND SLAM!!",
          atBat: grandSlamAtBat,
          home: { ...baseSnapshot.home, runs: 6 },
          lastEvent: "Francisco Lindor hits a grand slam to left field",
        },
        0,
        "Grand slam event persisted; special display animation begins before motion.",
        [],
        [celebrationEvent("GRAND_SLAM", "777686:play-48", "Francisco Lindor")],
      ),
      frame(
        2900,
        {
          phase: "CELEBRATION",
          label: "GRAND SLAM!!",
          atBat: grandSlamAtBat,
          home: { ...baseSnapshot.home, runs: 6 },
          lastEvent: "Francisco Lindor grand slam · actuator extending at 9.80 mm/s",
        },
        50,
        "Two-second display lead-in complete; extend command recorded.",
        [command("MOTION_EXTEND", "777686:play-48", 50)],
      ),
      frame(
        8000,
        {
          phase: "CELEBRATION",
          label: "GRAND SLAM!!",
          atBat: grandSlamAtBat,
          home: { ...baseSnapshot.home, runs: 6 },
          lastEvent: "Francisco Lindor grand slam · celebration dwell",
        },
        50,
        "Extended limit reached after the measured 5.10-second stroke.",
      ),
      frame(
        38000,
        {
          phase: "LIVE",
          label: "LIVE",
          atBat: grandSlamAtBat,
          home: { ...baseSnapshot.home, runs: 6 },
          lastEvent: "Francisco Lindor grand slam · Apple returning home",
        },
        0,
        "Thirty-second raised dwell complete; retract command recorded.",
        [command("MOTION_RETRACT", "777686:play-48", 0)],
      ),
      frame(
        43100,
        { phase: "LIVE", label: "LIVE", home: { ...baseSnapshot.home, runs: 6 }, lastEvent: "Play resumed" },
        0,
        "Retracted limit reached; grand slam remains deduplicated.",
      ),
    ],
    deviceFixture: deviceFixture(
      [
        inputFrame(0, normalizedInput("20260826_211500", { updateMode: "BOOTSTRAP" })),
        inputFrame(
          900,
          normalizedInput("20260826_211510", {
            homeRuns: 6,
            plays: [normalizedGrandSlam("777686:play-48")],
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
        [],
        [celebrationEvent("HOME_RUN", "777686:play-52", "Juan Soto")],
      ),
      frame(
        5200,
        {
          phase: "CELEBRATION",
          label: "JUAN SOTO · HR CONFIRMED",
          review: "CONFIRMED",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto HR · actuator extending at 9.80 mm/s",
        },
        50,
        "Display lead-in complete; extend recorded.",
        [command("MOTION_EXTEND", "777686:play-52", 50)],
      ),
      frame(
        10300,
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
        40300,
        {
          phase: "LIVE",
          label: "LIVE",
          review: "CONFIRMED",
          home: { ...baseSnapshot.home, runs: 3 },
          lastEvent: "Juan Soto HR · Apple returning home",
        },
        0,
        "Thirty-second raised dwell complete; retract recorded.",
        [command("MOTION_RETRACT", "777686:play-52", 0)],
      ),
      frame(
        45400,
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
