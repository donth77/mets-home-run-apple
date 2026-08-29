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

  it("leaves future halves blank even if MLB supplies placeholder zeroes", () => {
    const data: StadiumScoreboardData = {
      ...scoreboard(3),
      away: { abbreviation: "ATL", name: "Braves", runs: 0 },
      home: { abbreviation: "NYM", name: "Mets", runs: 1 },
      half: "TOP",
      linescore: {
        innings: [
          { inning: 1, away: 0, home: 1 },
          { inning: 2, away: 0, home: 0 },
          { inning: 3, away: 0, home: 0 },
        ],
      },
    };

    expect(stadiumInningScores(data, "away")).toEqual([0, 0, 0, null, null, null, null, null, null]);
    expect(stadiumInningScores(data, "home")).toEqual([1, 0, null, null, null, null, null, null, null]);
  });

  it("shows zero once the bottom half has started", () => {
    const data: StadiumScoreboardData = {
      ...scoreboard(3),
      away: { abbreviation: "ATL", name: "Braves", runs: 0 },
      home: { abbreviation: "NYM", name: "Mets", runs: 1 },
      linescore: {
        innings: [
          { inning: 1, away: 0, home: 1 },
          { inning: 2, away: 0, home: 0 },
          { inning: 3, away: 0, home: 0 },
        ],
      },
    };

    expect(stadiumInningScores(data, "home")[2]).toBe(0);
  });

  it("keeps a completed scoreless bottom half visible during the next changeover", () => {
    const data: StadiumScoreboardData = {
      ...scoreboard(3),
      away: { abbreviation: "ATL", name: "Braves", runs: 0 },
      half: "MIDDLE",
      home: { abbreviation: "NYM", name: "Mets", runs: 1 },
      linescore: {
        innings: [
          { inning: 1, away: 0, home: 1 },
          { inning: 2, away: 0, home: 0 },
          { inning: 3, away: 0, home: 0 },
        ],
      },
    };

    expect(stadiumInningScores(data, "home")[2]).toBe(0);
  });
});
