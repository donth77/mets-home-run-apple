import { fixtureScenarios } from "@apple/test-fixtures";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type CoreInputEnvelope, GameCore } from "./index";

const activeCores: GameCore[] = [];

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, "window");
});

afterEach(() => {
  for (const core of activeCores.splice(0)) core.dispose();
});

function game(cursor: string, updateMode: "BOOTSTRAP" | "INCREMENTAL"): CoreInputEnvelope {
  return {
    schemaVersion: 1,
    updateMode,
    gamePk: 777001,
    gameNumber: 1,
    cursor,
    phase: "LIVE",
    half: "BOTTOM",
    inning: 6,
    outs: 1,
    awayTeamId: 144,
    homeTeamId: 121,
    awayRuns: 2,
    homeRuns: 2,
    plays: [],
  };
}

async function core() {
  const instance = await GameCore.create();
  activeCores.push(instance);
  instance.ingest(game("20260827_190000", "BOOTSTRAP"), 0);
  return instance;
}

describe("canonical core WASM boundary", () => {
  it("matches the native confirmed-home-run golden trace and timing", async () => {
    const instance = await core();
    const update = game("20260827_190010", "INCREMENTAL");
    update.homeRuns = 3;
    update.plays = [
      {
        eventKey: "777001:play-42",
        atBatIndex: 42,
        battingTeamId: 121,
        batterName: "Juan Soto",
        kind: "HOME_RUN",
        complete: true,
        review: "NONE",
      },
    ];

    const decision = instance.ingest(update, 100);
    expect(decision.events).toEqual([
      {
        type: "CELEBRATION_STARTED",
        eventKey: "777001:play-42",
        celebration: "HOME_RUN",
        subject: "Juan Soto",
      },
    ]);
    expect(decision.commands).toHaveLength(0);
    expect(decision.traces.map(({ code }) => code)).toEqual([
      "EVENT_PERSISTED",
      "SEQUENCE_QUEUED",
      "SEQUENCE_STARTED",
      "INPUT_ACCEPTED",
    ]);
    expect(instance.ledgerContains("777001:play-42")).toBe(true);
    expect(instance.tick(2_099).commands).toHaveLength(0);
    expect(instance.tick(2_100).commands[0]).toMatchObject({
      type: "MOTION_EXTEND",
      positionMm: 50,
      deadlineMs: 7_100,
    });
    instance.reportPosition(50, 4_000);
    expect(instance.tick(33_999).commands).toHaveLength(0);
    expect(instance.tick(34_000).commands[0]).toMatchObject({
      type: "MOTION_RETRACT",
      positionMm: 0,
      deadlineMs: 39_000,
    });
    expect(instance.reportPosition(0, 35_000).sequenceState).toBe("IDLE");
  });

  it("maps a grand slam to the home-run motion sequence with a distinct presentation kind", async () => {
    const instance = await core();
    const update = game("20260827_190010", "INCREMENTAL");
    update.homeRuns = 6;
    update.plays = [
      {
        eventKey: "777001:play-43",
        atBatIndex: 43,
        battingTeamId: 121,
        batterName: "Pete Alonso",
        kind: "GRAND_SLAM",
        complete: true,
        review: "NONE",
      },
    ];

    const decision = instance.ingest(update, 100);
    expect(decision.events).toMatchObject([
      { type: "CELEBRATION_STARTED", celebration: "GRAND_SLAM", subject: "Pete Alonso" },
    ]);
    expect(instance.tick(2_100).commands[0]).toMatchObject({ type: "MOTION_EXTEND", positionMm: 50 });
  });

  it("fails closed when the browser ledger adapter reports a write failure", async () => {
    const instance = await core();
    instance.setLedgerFailures(false, true);
    const update = game("20260827_190010", "INCREMENTAL");
    update.plays = [
      {
        eventKey: "777001:play-42",
        atBatIndex: 42,
        battingTeamId: 121,
        batterName: "Juan Soto",
        kind: "HOME_RUN",
        complete: true,
        review: "NONE",
      },
    ];
    const decision = instance.ingest(update, 100);
    expect(decision.commands.map(({ type }) => type)).toEqual(["MOTION_DISABLE"]);
    expect(decision.faultLatched).toBe(true);
  });

  it("executes every Simulator device fixture through C++ with the expected motion count", async () => {
    for (const scenario of fixtureScenarios) {
      const instance = await GameCore.create();
      activeCores.push(instance);
      const commandTypes: string[] = [];
      let nowMs = 0;
      for (const fixtureFrame of scenario.deviceFixture.frames) {
        nowMs = fixtureFrame.atMs;
        commandTypes.push(...instance.ingest(fixtureFrame.input, nowMs).commands.map(({ type }) => type));
      }

      for (let step = 0; step < 20 && scenario.deviceFixture.expectedMotionSequences > 0; step += 1) {
        nowMs += 2_000;
        const tick = instance.tick(nowMs);
        commandTypes.push(...tick.commands.map(({ type }) => type));
        if (tick.commands.some(({ type }) => type === "MOTION_EXTEND")) {
          nowMs += 3_300;
          instance.reportPosition(50, nowMs);
        }
        if (tick.commands.some(({ type }) => type === "MOTION_RETRACT")) {
          nowMs += 3_300;
          instance.reportPosition(0, nowMs);
          break;
        }
      }

      expect(
        commandTypes.filter((type) => type === "MOTION_EXTEND"),
        scenario.id,
      ).toHaveLength(scenario.deviceFixture.expectedMotionSequences);
      expect(
        commandTypes.filter((type) => type === "MOTION_RETRACT"),
        scenario.id,
      ).toHaveLength(scenario.deviceFixture.expectedMotionSequences);
    }
  });
});
