import { describe, expect, it } from "vitest";
import { selectUpcomingMetsGames, type MlbScheduleGame } from "./schedule";

function game(
  gamePk: number,
  gameDate: string,
  abstractState: string,
  away: MlbScheduleGame["away"],
  home: MlbScheduleGame["home"],
  gameNumber: 1 | 2 = 1,
): MlbScheduleGame {
  return {
    gamePk,
    gameDate,
    gameNumber,
    abstractState,
    detailedState: abstractState,
    away,
    home,
    venue: home.id === 121 ? "Citi Field" : `${home.name} Park`,
  };
}

const mets = { id: 121, name: "New York Mets", abbreviation: "NYM" };
const marlins = { id: 146, name: "Miami Marlins", abbreviation: "MIA" };
const braves = { id: 144, name: "Atlanta Braves", abbreviation: "ATL" };

describe("selectUpcomingMetsGames", () => {
  it("returns the next three scheduled games in order and excludes live or final games", () => {
    const games = [
      game(1, "2026-08-26T17:00:00Z", "Final", braves, mets),
      game(4, "2026-08-30T17:00:00Z", "Preview", mets, braves),
      game(2, "2026-08-27T23:10:00Z", "Preview", marlins, mets),
      game(3, "2026-08-28T23:10:00Z", "Preview", mets, marlins, 2),
      game(5, "2026-08-31T17:00:00Z", "Preview", braves, mets),
      game(6, "2026-08-27T20:00:00Z", "Live", mets, braves),
    ];

    expect(selectUpcomingMetsGames(games, new Date("2026-08-26T22:00:00Z"))).toEqual([
      expect.objectContaining({ gamePk: 2, location: "HOME", opponentAbbreviation: "MIA", opponentId: 146 }),
      expect.objectContaining({
        gamePk: 3,
        gameNumber: 2,
        location: "AWAY",
        opponentAbbreviation: "MIA",
        opponentId: 146,
      }),
      expect.objectContaining({ gamePk: 4, location: "AWAY", opponentAbbreviation: "ATL", opponentId: 144 }),
    ]);
  });

  it("returns no rows when there are no future games", () => {
    expect(selectUpcomingMetsGames([], new Date("2026-12-10T12:00:00Z"))).toEqual([]);
  });
});
