import type { CanonicalGameFrame } from "@apple/protocol";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GameStateProjector } from "./index";

const activeProjectors: GameStateProjector[] = [];

beforeAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, "window");
});

afterEach(() => {
  for (const projector of activeProjectors.splice(0)) projector.dispose();
});

function frame(): CanonicalGameFrame {
  return {
    gamePk: 777001,
    gameNumber: 2,
    cursor: "20260827_190010",
    updateMode: "INCREMENTAL",
    phase: "REVIEW",
    label: "PLAY UNDER REVIEW",
    away: { id: 144, abbreviation: "ATL", name: "Braves", runs: 2 },
    home: { id: 121, abbreviation: "NYM", name: "Mets", runs: 3 },
    inning: 7,
    half: "BOTTOM",
    displayOuts: 0,
    evidenceOuts: 3,
    review: "PENDING",
    lastEvent: 'Lindor says "let it fly".\nReview pending.',
    scheduledStart: "2026-08-27T23:10:00Z",
    venue: "Citi Field",
    atBat: {
      balls: 3,
      strikes: 2,
      bases: { first: true, second: false, third: true },
      batter: "Francisco Lindor",
      batterLine: "2–3",
      pitcher: "Kodai Senga",
      pitchCount: 87,
    },
    linescore: {
      innings: [
        { inning: 1, away: 0, home: 1 },
        { inning: 7, away: 0, home: null },
      ],
      awayHits: 5,
      homeHits: 7,
      awayErrors: 0,
      homeErrors: 1,
    },
    changedPlays: [
      {
        eventKey: "777001:play-42",
        atBatIndex: 42,
        battingTeamId: 121,
        batterName: "Francisco Lindor",
        kind: "HOME_RUN",
        complete: true,
        review: "PENDING",
      },
    ],
  };
}

async function projector() {
  const instance = await GameStateProjector.create();
  activeProjectors.push(instance);
  return instance;
}

describe("canonical game-state WASM boundary", () => {
  it("preserves presentation details and keeps decision outs separate", async () => {
    const projection = (await projector()).project(frame());

    expect(projection.gameSnapshot).toMatchObject({
      schemaVersion: 1,
      gamePk: 777001,
      gameNumber: 2,
      phase: "REVIEW",
      label: "PLAY UNDER REVIEW",
      outs: 0,
      lastEvent: 'Lindor says "let it fly".\nReview pending.',
      atBat: { batter: "Francisco Lindor", batterLine: "2–3", pitchCount: 87 },
    });
    expect(projection.gameSnapshot.linescore?.innings[1]).toEqual({ inning: 7, away: 0, home: null });
    expect(projection.coreInput).toMatchObject({
      schemaVersion: 1,
      updateMode: "INCREMENTAL",
      cursor: "20260827_190010",
      outs: 3,
      plays: [{ eventKey: "777001:play-42", kind: "HOME_RUN" }],
    });
  });

  it("does not leak optional fields from the previous frame", async () => {
    const instance = await projector();
    instance.project(frame());
    const next = frame();
    delete next.scheduledStart;
    delete next.venue;
    delete next.atBat;
    next.linescore = { innings: [] };
    next.changedPlays = [];

    const projection = instance.project(next);
    expect(projection.gameSnapshot.scheduledStart).toBeUndefined();
    expect(projection.gameSnapshot.venue).toBeUndefined();
    expect(projection.gameSnapshot.atBat).toBeUndefined();
    expect(projection.gameSnapshot.linescore).toEqual({ innings: [] });
    expect(projection.coreInput.plays).toEqual([]);
  });
  it("classifies MLB's game status with the shared C++", async () => {
    const projector = await GameStateProjector.create();
    activeProjectors.push(projector);
    expect(
      projector.classifyStatus({
        abstractState: "Live",
        detailedState: "Delayed",
        statusCode: "IO",
        reason: "",
        latestAdvisory: "Status Change - Delayed: Rain",
        reviewPending: false,
      }),
    ).toEqual({ phase: "DELAYED", label: "RAIN DELAY", weatherDelay: true });
    expect(
      projector.classifyStatus({
        abstractState: "Final",
        detailedState: "Postponed",
        statusCode: "DR",
        reason: "Rain",
        latestAdvisory: "",
        reviewPending: false,
      }),
    ).toEqual({ phase: "DELAYED", label: "Postponed", weatherDelay: false });
  });
});
