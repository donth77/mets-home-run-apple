// The TypeScript status classifier is the default for tests; production apps
// run the shared C++ one through WebAssembly. These cases come from MLB's
// /api/v1/gameStatus table and the Mets' two 2026 in-game delays, and every
// case must classify identically in both.
import { GameStateProjector } from "@apple/game-state-wasm";
import type { GameStatusClassification, GameStatusFacts } from "@apple/protocol";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// The same field-limited captures the firmware's native tests and the Nano's
// replay use: Mets at Phillies, 2026-07-18, as the rain delay began and as
// play resumed.
import delayedCapture from "../../../firmware/fixtures/mlb/823441_rain_delay.json";
import resumedCapture from "../../../firmware/fixtures/mlb/823441_resumed.json";
import { MlbRecordingClient } from "./client";
import { classifyGameStatus } from "./feedNormalization";

function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function facts(
  abstractState: string,
  detailedState: string,
  statusCode: string,
  reason = "",
  latestAdvisory = "",
  reviewPending = false,
): GameStatusFacts {
  return { abstractState, detailedState, statusCode, reason, latestAdvisory, reviewPending };
}

function expected(
  phase: GameStatusClassification["phase"],
  label: string,
  weatherDelay = false,
): GameStatusClassification {
  return { phase, label, weatherDelay };
}

const RAIN = expected("DELAYED", "RAIN DELAY", true);

const cases: readonly [string, GameStatusFacts, GameStatusClassification][] = [
  ["in progress", facts("Live", "In Progress", "I"), expected("LIVE", "LIVE")],
  ["warmup", facts("Live", "Warmup", "PW"), expected("LIVE", "LIVE")],
  ["pre-game", facts("Preview", "Pre-Game", "P"), expected("PREGAME", "Pre-Game")],
  ["scheduled", facts("Preview", "Scheduled", "S"), expected("PREGAME", "Scheduled")],
  [
    "real mid-game delay: the advisory names rain",
    facts("Live", "Delayed", "IO", "", "Status Change - Delayed: Rain"),
    RAIN,
  ],
  ["generic delay with no advisory", facts("Live", "Delayed", "IO"), expected("DELAYED", "Delayed")],
  [
    "resumed: the latest advisory is the resume",
    facts("Live", "In Progress", "I", "", "Status Change - In Progress"),
    expected("LIVE", "LIVE"),
  ],
  [
    "advisory: inclement weather",
    facts("Live", "Delayed", "IO", "", "Status Change - Delayed: Inclement Weather"),
    RAIN,
  ],
  ["advisory: lightning", facts("Live", "Delayed", "IO", "", "Status Change - Delayed: Lightning"), RAIN],
  ["advisory: wet grounds", facts("Live", "Delayed", "IO", "", "Status Change - Delayed: Wet Grounds"), RAIN],
  [
    "advisory: power is not weather",
    facts("Live", "Delayed", "IO", "", "Status Change - Delayed: Power"),
    expected("DELAYED", "Delayed"),
  ],
  [
    "advisory: drainage is not rain",
    facts("Live", "Delayed", "IO", "", "Status Change - Delayed: Drainage"),
    expected("DELAYED", "Delayed"),
  ],
  [
    "advisory mentioning rain but not a delay",
    facts("Live", "Delayed", "IO", "", "Rain in the forecast"),
    expected("DELAYED", "Delayed"),
  ],
  ["IR delayed: rain", facts("Live", "Delayed: Rain", "IR", "Rain"), RAIN],
  ["II inclement weather", facts("Live", "Delayed: Inclement Weather", "II", "Inclement Weather"), RAIN],
  ["IL lightning", facts("Live", "Delayed: Lightning", "IL", "Lightning"), RAIN],
  ["IG wet grounds", facts("Live", "Delayed: Wet Grounds", "IG", "Wet Grounds"), RAIN],
  ["PR delayed start: rain", facts("Preview", "Delayed Start: Rain", "PR", "Rain"), RAIN],
  ["PG delayed start: wet grounds", facts("Preview", "Delayed Start: Wet Grounds", "PG", "Wet Grounds"), RAIN],
  ["code alone, untrimmed", facts("Live", "Delayed", " ir "), RAIN],
  ["reason alone", facts("Live", "Delayed", "", "rain"), RAIN],
  ["IS snow", facts("Live", "Delayed: Snow", "IS", "Snow"), expected("DELAYED", "Delayed: Snow")],
  ["IF fog", facts("Live", "Delayed: Fog", "IF", "Fog"), expected("DELAYED", "Delayed: Fog")],
  ["IP power", facts("Live", "Delayed: Power", "IP", "Power"), expected("DELAYED", "Delayed: Power")],
  ["IY ceremony", facts("Live", "Delayed: Ceremony", "IY", "Ceremony"), expected("DELAYED", "Delayed: Ceremony")],
  [
    "TR suspended: rain keeps its label",
    facts("Live", "Suspended: Rain", "TR", "Rain"),
    expected("DELAYED", "Suspended: Rain"),
  ],
  [
    "UR suspended: rain",
    facts("Live", "Suspended: Rain", "UR", "Rain", "Status Change - Suspended: Rain"),
    expected("DELAYED", "Suspended: Rain"),
  ],
  [
    "DR postponed: rain is abstractly Final",
    facts("Final", "Postponed", "DR", "Rain"),
    expected("DELAYED", "Postponed"),
  ],
  [
    "DI postponed: inclement weather",
    facts("Final", "Postponed", "DI", "Inclement Weather"),
    expected("DELAYED", "Postponed"),
  ],
  ["CR cancelled: rain", facts("Final", "Cancelled", "CR", "Rain"), expected("DELAYED", "Cancelled")],
  ["FR completed early: rain", facts("Final", "Completed Early: Rain", "FR", "Rain"), expected("FINAL", "FINAL")],
  ["final", facts("Final", "Final", "F"), expected("FINAL", "FINAL")],
  ["game over", facts("Live", "Game Over", "O"), expected("FINAL", "FINAL")],
  ["manager challenge", facts("Live", "Manager Challenge", "I"), expected("REVIEW", "PLAY UNDER REVIEW")],
  [
    "review pending wins",
    facts("Live", "Delayed", "IO", "", "Status Change - Delayed: Rain", true),
    expected("REVIEW", "PLAY UNDER REVIEW"),
  ],
  ["empty status", facts("", "", ""), expected("SLEEP", "SLEEP")],
];

let projector: GameStateProjector;

beforeAll(async () => {
  projector = await GameStateProjector.create();
});

afterAll(() => {
  projector.dispose();
});

describe("game status classification", () => {
  it.each(cases)("%s", (_name, input, result) => {
    expect(classifyGameStatus(input)).toEqual(result);
    expect(projector.classifyStatus(input)).toEqual(result);
  });

  it("reads the real 2026-07-18 rain delay identically in TypeScript and C++", async () => {
    const fetcher = () =>
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(response(delayedCapture))
        .mockResolvedValueOnce(response(resumedCapture));
    const now = () => new Date("2026-07-18T21:30:00Z");
    const established = new MlbRecordingClient(fetcher(), now);
    const cpp = new MlbRecordingClient(
      fetcher(),
      now,
      (frame) => projector.project(frame),
      (input) => projector.classifyStatus(input),
    );
    const game = { gamePk: 823441, gameNumber: 1 as const };

    const during = await established.poll(game);
    expect(during.capture?.gameSnapshot).toMatchObject({
      phase: "DELAYED",
      label: "RAIN DELAY",
      inning: 7,
      half: "BOTTOM",
      away: { abbreviation: "NYM", runs: 1 },
      home: { abbreviation: "PHI", runs: 6 },
    });
    expect(await cpp.poll(game)).toStrictEqual(during);

    const after = await established.poll(game);
    expect(after.capture?.gameSnapshot).toMatchObject({ phase: "LIVE", label: "LIVE", inning: 7, half: "BOTTOM" });
    expect(await cpp.poll(game)).toStrictEqual(after);
  });
});
