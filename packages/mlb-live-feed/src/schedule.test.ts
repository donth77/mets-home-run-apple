import { describe, expect, it } from "vitest";
import postseason2024 from "../../../firmware/fixtures/mlb/postseason_2024.json";
import splitSquadWeek from "../../../firmware/fixtures/mlb/schedule_20260312_20260314.json";
import springOpener2027 from "../../../firmware/fixtures/mlb/schedule_20270218_20270222.json";
import standing2024 from "../../../firmware/fixtures/mlb/team_standing_2024.json";
import standing2026 from "../../../firmware/fixtures/mlb/team_standing_2026.json";
import {
  fetchMetsPostseasonGames,
  fetchMetsScheduleRange,
  fetchMetsStanding,
  metsIdleCard,
  mlbGameLabel,
  parseMetsStanding,
  postseasonRunOver,
  selectUpcomingMetsGames,
  yieldsToHomeSplitSquad,
  type MlbScheduleGame,
} from "./schedule";

function answering(payload: unknown, requested: string[] = []): typeof fetch {
  return async (input) => {
    requested.push(input.toString());
    return Response.json(payload);
  };
}

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

// 2026-03-13 was a split-squad day: the Mets at Washington at 6:05 PM and
// Miami at Clover Park at 6:10 PM.
describe("spring training", () => {
  it("reads game types, MLB's dates, and labels spring games", async () => {
    const games = await fetchMetsScheduleRange("2026-03-12", "2026-03-14", answering(splitSquadWeek));
    expect(games.map((game) => [game.gamePk, game.gameType, game.officialDate, game.startTimeTbd])).toEqual([
      [831472, "S", "2026-03-12", false],
      [831464, "S", "2026-03-13", false],
      [831462, "S", "2026-03-13", false],
      [831508, "S", "2026-03-14", false],
    ]);
    expect(games.map((game) => mlbGameLabel(game))).toEqual(Array(4).fill("Spring Training"));
  });

  it("follows the home game on a split-squad day, the same as the physical Apple", async () => {
    const games = (await fetchMetsScheduleRange("2026-03-12", "2026-03-14", answering(splitSquadWeek))).map((game) => ({
      ...game,
      abstractState: "Preview",
      detailedState: "Scheduled",
    }));
    expect(yieldsToHomeSplitSquad(games[1], games)).toBe(true);
    expect(yieldsToHomeSplitSquad(games[2], games)).toBe(false);
    expect(yieldsToHomeSplitSquad(games[0], games)).toBe(false);
    expect(selectUpcomingMetsGames(games, new Date("2026-03-12T12:00:00Z"))).toEqual([
      expect.objectContaining({ gamePk: 831472, label: "Spring Training", gameType: "S" }),
      expect.objectContaining({ gamePk: 831462, location: "HOME", opponentAbbreviation: "MIA" }),
      expect.objectContaining({ gamePk: 831508 }),
    ]);

    // A rained-out home game leaves the day to the road game.
    const rainedOut = games.map((game) => (game.gamePk === 831462 ? { ...game, detailedState: "Postponed" } : game));
    expect(yieldsToHomeSplitSquad(rainedOut[1], rainedOut)).toBe(false);
    // The same club twice in a day is a doubleheader, not a split squad.
    const doubleheader = games.map((game) => (game.gamePk === 831464 ? { ...game, home: game.away } : game));
    expect(yieldsToHomeSplitSquad({ ...games[1], home: games[2].away }, doubleheader)).toBe(false);
  });

  it("keeps a start time MLB has not set as TBD", async () => {
    const [opener] = await fetchMetsScheduleRange("2027-02-18", "2027-02-22", answering(springOpener2027));
    expect(opener).toMatchObject({
      gamePk: 868574,
      gameDate: "2027-02-19T08:33:00Z",
      officialDate: "2027-02-19",
      startTimeTbd: true,
      gameType: "S",
    });
  });
});

// The Mets' 2024 postseason: they won the Wild Card Series at Milwaukee and
// the NLDS against the Phillies, then lost the NLCS to the Dodgers in six.
describe("the postseason", () => {
  it("labels each round with its game number", async () => {
    const requested: string[] = [];
    const games = await fetchMetsPostseasonGames(2024, answering(postseason2024, requested));
    expect(new URL(requested[0]).searchParams.get("gameType")).toBe("F,D,L,W");
    expect(new URL(requested[0]).searchParams.get("hydrate")).toBe("team,seriesStatus");
    expect(games).toHaveLength(13);
    expect(mlbGameLabel(games[0])).toBe("Wild Card Game 1");
    expect(mlbGameLabel(games[3])).toBe("NLDS Game 1");
    expect(mlbGameLabel(games[7])).toBe("NLCS Game 1");
    expect(mlbGameLabel(games[12])).toBe("NLCS Game 6");
    expect(mlbGameLabel({ gameType: "W", seriesGameNumber: 7 })).toBe("World Series Game 7");
    expect(mlbGameLabel({ gameType: "D", seriesDescription: "AL Division Series", seriesGameNumber: 2 })).toBe(
      "ALDS Game 2",
    );
    expect(mlbGameLabel({ gameType: "E" })).toBe("Exhibition");
    expect(mlbGameLabel({ gameType: "R" })).toBeUndefined();
    expect(mlbGameLabel({})).toBeUndefined();
  });

  it("knows when the run is over", async () => {
    const games = await fetchMetsPostseasonGames(2024, answering(postseason2024));
    expect(games[12].seriesStatus).toEqual({ isOver: true, winningTeamId: 119, losingTeamId: 121 });
    expect(postseasonRunOver(games)).toBe(true);
    expect(postseasonRunOver([])).toBe(false);
    expect(postseasonRunOver(games.slice(0, 2))).toBe(false);
    expect(postseasonRunOver(games.slice(0, 7))).toBe(false);
    const champions = {
      ...games[12],
      gameType: "W",
      seriesStatus: { isOver: true, winningTeamId: 121, losingTeamId: 147 },
    };
    expect(postseasonRunOver([champions])).toBe(true);
  });
});

describe("the end of the season", () => {
  it("reads the Mets' standing", async () => {
    const requested: string[] = [];
    // 2026: 74-88, out of both races. 2024: a wild card.
    expect(await fetchMetsStanding(2026, answering(standing2026, requested))).toEqual({
      clinched: false,
      eliminated: true,
    });
    expect(requested[0]).toContain("/api/v1/teams/121?season=2026&hydrate=standings&fields=");
    expect(parseMetsStanding(standing2024)).toEqual({ clinched: true, eliminated: false });
    expect(parseMetsStanding({ teams: [{ id: 121 }] })).toBeUndefined();
  });

  it("decides the idle card the same way as the physical Apple", () => {
    const eliminated = { clinched: false, eliminated: true };
    const racing = { clinched: false, eliminated: false };
    const clinched = { clinched: true, eliminated: false };
    expect(metsIdleCard(9, eliminated, undefined)).toBe("OFFSEASON");
    expect(metsIdleCard(10, eliminated, undefined)).toBe("OFFSEASON");
    expect(metsIdleCard(9, racing, undefined)).toBe("NO_GAME_THIS_WEEK");
    expect(metsIdleCard(9, undefined, undefined)).toBe("NO_GAME_THIS_WEEK");
    expect(metsIdleCard(10, clinched, undefined)).toBe("NEXT_GAME_TBD");
    expect(metsIdleCard(10, clinched, false)).toBe("NEXT_GAME_TBD");
    expect(metsIdleCard(10, clinched, true)).toBe("OFFSEASON");
    for (const month of [11, 12, 1, 2]) expect(metsIdleCard(month, undefined, undefined)).toBe("OFFSEASON");
    for (const month of [3, 5, 8]) expect(metsIdleCard(month, eliminated, true)).toBe("NO_GAME_THIS_WEEK");
  });
});
