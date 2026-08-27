import { describe, expect, it } from "vitest";
import { stadiumInningScores, stadiumInningWindow } from "./stadiumInnings";
import type { StadiumScoreboardData } from "./types";

function scoreboard(inning: number): StadiumScoreboardData {
  return {
    away: { abbreviation: "ATL", name: "Braves", runs: 4 },
    home: { abbreviation: "NYM", name: "Mets", runs: 5 },
    phase: "LIVE",
    inning,
    half: "BOTTOM",
    outs: 0,
    label: "LIVE",
    lastEvent: "Extra innings",
    linescore: {
      innings: Array.from({ length: inning }, (_, index) => ({
        inning: index + 1,
        away: index === 0 || index === 9 ? 2 : 0,
        home: index === 1 ? 3 : index === 9 ? 2 : 0,
      })),
    },
  };
}

describe("stadium inning columns", () => {
  it("shows all regulation innings through the ninth", () => {
    expect(stadiumInningWindow(1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(stadiumInningWindow(9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("drops the earliest inning as extra innings advance", () => {
    expect(stadiumInningWindow(10)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stadiumInningWindow(12)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("does not fold hidden early runs into an extra-inning cell", () => {
    const data = scoreboard(10);
    const innings = stadiumInningWindow(data.inning);

    expect(stadiumInningScores(data, "away", innings)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 2]);
    expect(stadiumInningScores(data, "home", innings)).toEqual([3, 0, 0, 0, 0, 0, 0, 0, 2]);
  });
});
