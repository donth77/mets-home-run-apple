import type { MlbScheduleGame } from "@apple/mlb-live-feed";
import { describe, expect, it } from "vitest";
import { notifiesFor } from "./watcher";

function game(gameType: string | undefined, abstractState = "Live", detailedState = "In Progress"): MlbScheduleGame {
  return {
    gamePk: 1,
    gameNumber: 1,
    gameDate: "2026-09-27T17:05:00Z",
    abstractState,
    detailedState,
    gameType,
    away: { id: 121, abbreviation: "NYM", name: "New York Mets" },
    home: { id: 120, abbreviation: "WSH", name: "Washington Nationals" },
  };
}

describe("which games send notifications", () => {
  it("covers the regular season and every postseason round", () => {
    for (const gameType of [undefined, "R", "F", "D", "L", "W"]) {
      expect(notifiesFor(game(gameType)), gameType).toBe(true);
    }
    expect(notifiesFor(game("R", "Final", "Final"))).toBe(true);
  });

  it("leaves spring training and exhibitions to the Apples themselves", () => {
    expect(notifiesFor(game("S"))).toBe(false);
    expect(notifiesFor(game("E"))).toBe(false);
  });

  it("still skips games that have not started", () => {
    expect(notifiesFor(game("R", "Preview", "Scheduled"))).toBe(false);
  });
});
