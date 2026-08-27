import { describe, expect, it } from "vitest";
import { clampPositionMm, type GameSnapshot, mlbTeamNickname, toDeviceDisplayState } from "./index";

describe("clampPositionMm", () => {
  it("keeps recording motion inside the 50 mm envelope", () => {
    expect(clampPositionMm(-12)).toBe(0);
    expect(clampPositionMm(25.4)).toBe(25);
    expect(clampPositionMm(78)).toBe(50);
    expect(clampPositionMm(Number.NaN)).toBe(0);
  });
});

describe("mlbTeamNickname", () => {
  it("uses nickname-only labels for MLB scoreboards", () => {
    expect(mlbTeamNickname({ abbreviation: "MIL", name: "Milwaukee Brewers" })).toBe("Brewers");
    expect(mlbTeamNickname({ abbreviation: "BOS", name: "Boston Red Sox" })).toBe("Red Sox");
    expect(mlbTeamNickname({ abbreviation: "ATL", name: "Atlanta" })).toBe("Braves");
  });

  it("preserves the supplied name for an unknown team", () => {
    expect(mlbTeamNickname({ abbreviation: "TBD", name: "Next opponent" })).toBe("Next opponent");
  });
});

describe("toDeviceDisplayState", () => {
  it("keeps the small-screen contract structured and compact", () => {
    const snapshot = {
      schemaVersion: 1,
      gamePk: 777686,
      gameNumber: 1,
      phase: "LIVE",
      label: "LIVE",
      away: { id: 144, abbreviation: "ATL", name: "Atlanta Braves", runs: 2 },
      home: { id: 121, abbreviation: "NYM", name: "New York Mets", runs: 3 },
      inning: 7,
      half: "BOTTOM",
      outs: 1,
      review: "NONE",
      lastEvent: "Pitch accepted",
      atBat: {
        balls: 2,
        strikes: 1,
        bases: { first: true, second: false, third: true },
        batter: "Juan Soto",
        batterLine: "2–3 · HR",
        pitcher: "Spencer Strider",
        pitchCount: 74,
      },
      linescore: { innings: [{ inning: 7, away: 0, home: 1 }] },
    } satisfies GameSnapshot;

    expect(toDeviceDisplayState(snapshot)).toEqual({
      schemaVersion: 1,
      gamePk: 777686,
      gameNumber: 1,
      phase: "LIVE",
      status: "LIVE",
      away: { abbreviation: "ATL", runs: 2 },
      home: { abbreviation: "NYM", runs: 3 },
      inning: 7,
      half: "BOTTOM",
      outs: 1,
      bases: { first: true, second: false, third: true },
      balls: 2,
      strikes: 1,
      batter: "Juan Soto",
      pitcher: "Spencer Strider",
      pitchCount: 74,
    });
  });

  it("uses empty bases when there is no active plate appearance", () => {
    const snapshot = {
      schemaVersion: 1,
      gamePk: 777686,
      gameNumber: 1,
      phase: "FINAL",
      label: "FINAL",
      away: { abbreviation: "ATL", name: "Atlanta Braves", runs: 2 },
      home: { id: 121, abbreviation: "NYM", name: "New York Mets", runs: 3 },
      inning: 9,
      half: "END",
      outs: 0,
      review: "NONE",
      lastEvent: "Final",
    } satisfies GameSnapshot;

    expect(toDeviceDisplayState(snapshot)).toMatchObject({
      phase: "FINAL",
      bases: { first: false, second: false, third: false },
    });
  });
});
