import { GameStateProjector } from "@apple/game-state-wasm";
import type { CanonicalGameFrame } from "@apple/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectCoreInput, projectGameSnapshot } from "./feedProjections";

let projector: GameStateProjector;

beforeAll(async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  projector = await GameStateProjector.create();
});

afterAll(() => {
  projector.dispose();
  Reflect.deleteProperty(globalThis, "window");
});

function frame(overrides: Partial<CanonicalGameFrame> = {}): CanonicalGameFrame {
  return {
    gamePk: 777001,
    gameNumber: 1,
    cursor: "20260827_190010",
    updateMode: "INCREMENTAL",
    phase: "LIVE",
    label: "LIVE",
    away: { id: 144, abbreviation: "ATL", name: "Atlanta Braves", runs: 2 },
    home: { id: 121, abbreviation: "NYM", name: "New York Mets", runs: 3 },
    inning: 7,
    half: "BOTTOM",
    displayOuts: 1,
    evidenceOuts: 1,
    review: "NONE",
    lastEvent: "Called Strike",
    scheduledStart: "2026-08-27T23:10:00Z",
    venue: "Citi Field",
    atBat: {
      balls: 2,
      strikes: 1,
      bases: { first: true, second: false, third: true },
      batter: "Francisco Lindor",
      batterLine: "2–3",
      pitcher: "Spencer Strider",
      pitchCount: 74,
    },
    linescore: {
      innings: [
        { inning: 1, away: 0, home: 1 },
        { inning: 2, away: 2, home: 0 },
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
        review: "NONE",
      },
    ],
    ...overrides,
  };
}

describe("C++ game-state projection parity", () => {
  it.each([
    {
      name: "live situation",
      value: frame(),
    },
    {
      name: "inning changeover with separate display and evidence outs",
      value: frame({
        cursor: "20260827_190020",
        half: "MIDDLE",
        displayOuts: 0,
        evidenceOuts: 3,
        lastEvent: "Top seventh begins",
        atBat: undefined,
        changedPlays: [],
      }),
    },
    {
      name: "pregame frame without optional context",
      value: frame({
        cursor: "20260827_160000",
        updateMode: "BOOTSTRAP",
        phase: "PREGAME",
        label: "UPCOMING",
        inning: 0,
        half: "TOP",
        displayOuts: 0,
        evidenceOuts: 0,
        lastEvent: "Tonight's game — \"Let's Go Mets\"",
        scheduledStart: undefined,
        venue: undefined,
        atBat: undefined,
        linescore: { innings: [] },
        changedPlays: [],
      }),
    },
    {
      name: "final game",
      value: frame({
        cursor: "20260827_220000",
        phase: "FINAL",
        label: "FINAL",
        inning: 9,
        half: "END",
        displayOuts: 0,
        evidenceOuts: 3,
        lastEvent: "Final",
        atBat: undefined,
        changedPlays: [],
      }),
    },
  ])("matches the established TypeScript output for $name", ({ value }) => {
    const projected = projector.project(value);
    expect(projected.gameSnapshot).toStrictEqual(projectGameSnapshot(value));
    expect(projected.coreInput).toStrictEqual(projectCoreInput(value));
  });
});
