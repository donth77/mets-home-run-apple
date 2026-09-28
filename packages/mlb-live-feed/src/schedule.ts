import { METS_TEAM_ID, MLB_STATS_API_ORIGIN } from "./constants";
import { MlbFeedError } from "./errors";
import { arrayAt, booleanAt, isObject, numberAt, objectAt, optionalNumberAt, stringAt } from "./jsonValue";
import { fetchJson } from "./transport";

/** Where a postseason series stands after a game (`hydrate=seriesStatus`). */
export interface MlbSeriesStatus {
  isOver: boolean;
  winningTeamId?: number;
  losingTeamId?: number;
}

export interface MlbScheduleGame {
  gamePk: number;
  gameNumber: 1 | 2;
  gameDate: string;
  /** MLB's own date for the game, e.g. 2026-09-27. */
  officialDate?: string;
  abstractState: string;
  detailedState: string;
  venue?: string;
  /**
   * MLB's gameType: R regular season, S spring training, E exhibition,
   * F Wild Card, D Division Series, L League Championship, W World Series.
   * Absent reads as the regular season.
   */
  gameType?: string;
  /** e.g. "NL Division Series" */
  seriesDescription?: string;
  seriesGameNumber?: number;
  /** MLB lists a game at 3:33 AM Eastern until its start time is set. */
  startTimeTbd?: boolean;
  seriesStatus?: MlbSeriesStatus;
  away: { id: number; abbreviation: string; name: string };
  home: { id: number; abbreviation: string; name: string };
}

export interface MlbSeasonDates {
  seasonId: number;
  springStartDate: string;
  offseasonStartDate: string;
}

export interface MlbOffseasonWindow {
  startDate: string;
  endDate: string;
  previousSeasonId: number;
  nextSeasonId: number;
}

export interface UpcomingMetsGame {
  gamePk: number;
  gameDate: string;
  officialDate?: string;
  gameNumber: 1 | 2;
  location: "HOME" | "AWAY";
  opponentId: number;
  opponent: string;
  opponentAbbreviation: string;
  venue?: string;
  gameType?: string;
  /** Spring Training, NLDS Game 1 and the like; absent in the regular season. */
  label?: string;
  startTimeTbd?: boolean;
}

function scheduleTeam(value: unknown) {
  const team = objectAt(value, "team");
  return {
    id: numberAt(team, "id"),
    abbreviation: stringAt(team, "abbreviation", "—"),
    name: stringAt(team, "name", "Unknown team"),
  };
}

function seriesStatus(value: unknown): MlbSeriesStatus | undefined {
  const series = objectAt(value, "seriesStatus");
  if (!series) return undefined;
  return {
    isOver: booleanAt(series, "isOver"),
    winningTeamId: optionalNumberAt(objectAt(series, "winningTeam"), "id"),
    losingTeamId: optionalNumberAt(objectAt(series, "losingTeam"), "id"),
  };
}

function parseSchedule(payload: unknown): readonly MlbScheduleGame[] {
  return arrayAt(payload, "dates").flatMap((date) => {
    const officialDate = stringAt(date, "date") || undefined;
    return arrayAt(date, "games").flatMap((candidate): MlbScheduleGame[] => {
      if (!isObject(candidate)) return [];
      const gamePk = numberAt(candidate, "gamePk");
      const gameNumber = numberAt(candidate, "gameNumber", 1);
      const teams = objectAt(candidate, "teams");
      if (gamePk <= 0 || (gameNumber !== 1 && gameNumber !== 2) || !teams) return [];
      const status = objectAt(candidate, "status");
      return [
        {
          gamePk,
          gameNumber,
          gameDate: stringAt(candidate, "gameDate"),
          officialDate,
          abstractState: stringAt(status, "abstractGameState", "Preview"),
          detailedState: stringAt(status, "detailedState", "Scheduled"),
          venue: stringAt(objectAt(candidate, "venue"), "name") || undefined,
          gameType: stringAt(candidate, "gameType", "R"),
          seriesDescription: stringAt(candidate, "seriesDescription") || undefined,
          seriesGameNumber: optionalNumberAt(candidate, "seriesGameNumber"),
          startTimeTbd: booleanAt(status, "startTimeTBD"),
          seriesStatus: seriesStatus(candidate),
          away: scheduleTeam(teams.away),
          home: scheduleTeam(teams.home),
        },
      ];
    });
  });
}

/** Spring training and exhibition games. */
export function isSpringGame(game: Pick<MlbScheduleGame, "gameType">) {
  return game.gameType === "S" || game.gameType === "E";
}

export function isPostseasonGame(game: Pick<MlbScheduleGame, "gameType">) {
  return game.gameType === "F" || game.gameType === "D" || game.gameType === "L" || game.gameType === "W";
}

/**
 * What kind of game this is when it is not the regular season: Spring
 * Training, Exhibition, Wild Card Game 2, NLDS Game 3, NLCS Game 5, World
 * Series Game 7. Undefined for a regular season game. The physical Apple
 * prints the same words in capitals.
 */
export function mlbGameLabel(
  game: Pick<MlbScheduleGame, "gameType" | "seriesDescription" | "seriesGameNumber">,
): string | undefined {
  if (game.gameType === "S") return "Spring Training";
  if (game.gameType === "E") return "Exhibition";
  // The Mets are a National League club; the series description names the
  // league in case that ever differs.
  const league = game.seriesDescription?.startsWith("AL ") ? "AL" : "NL";
  const round =
    game.gameType === "F"
      ? "Wild Card"
      : game.gameType === "D"
        ? `${league}DS`
        : game.gameType === "L"
          ? `${league}CS`
          : game.gameType === "W"
            ? "World Series"
            : undefined;
  if (!round) return undefined;
  return game.seriesGameNumber && game.seriesGameNumber > 0 ? `${round} Game ${game.seriesGameNumber}` : round;
}

function followableScheduleGame(game: MlbScheduleGame) {
  return !/postponed|cancell?ed|suspended/i.test(game.detailedState);
}

/**
 * True for the away half of a split-squad day: two spring games on the same
 * date against different clubs, where both Apples follow the one at home.
 */
export function yieldsToHomeSplitSquad(game: MlbScheduleGame, games: readonly MlbScheduleGame[]) {
  if (!isSpringGame(game) || game.home.id === METS_TEAM_ID || !game.officialDate) return false;
  return games.some(
    (other) =>
      other.gamePk !== game.gamePk &&
      isSpringGame(other) &&
      other.home.id === METS_TEAM_ID &&
      other.officialDate === game.officialDate &&
      followableScheduleGame(other) &&
      // The same club twice in a day is a doubleheader, not a split squad.
      other.away.id !== game.home.id,
  );
}

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function easternDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function fetchMetsSchedule(
  date: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<readonly MlbScheduleGame[]> {
  if (!isCalendarDate(date)) {
    throw new MlbFeedError("Schedule date must use YYYY-MM-DD.", "INVALID_DATE");
  }
  const url = new URL("/api/v1/schedule", MLB_STATS_API_ORIGIN);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("teamId", String(METS_TEAM_ID));
  url.searchParams.set("date", date);
  url.searchParams.set("hydrate", "team");
  return parseSchedule(await fetchJson(fetcher, url.toString(), signal));
}

export async function fetchMetsScheduleRange(
  startDate: string,
  endDate: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<readonly MlbScheduleGame[]> {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || endDate < startDate) {
    throw new MlbFeedError("Schedule range must use ordered YYYY-MM-DD dates.", "INVALID_DATE_RANGE");
  }
  const url = new URL("/api/v1/schedule", MLB_STATS_API_ORIGIN);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("teamId", String(METS_TEAM_ID));
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("hydrate", "team");
  return parseSchedule(await fetchJson(fetcher, url.toString(), signal));
}

export function selectUpcomingMetsGames(
  games: readonly MlbScheduleGame[],
  now: Date,
  limit = 3,
): readonly UpcomingMetsGame[] {
  const nowMs = now.getTime();
  return games
    .filter((game) => {
      const state = game.abstractState.toUpperCase();
      return (
        state !== "FINAL" &&
        state !== "LIVE" &&
        Date.parse(game.gameDate) > nowMs &&
        !yieldsToHomeSplitSquad(game, games)
      );
    })
    .map((game) => {
      const metsAtHome = game.home.id === METS_TEAM_ID;
      const opponent = metsAtHome ? game.away : game.home;
      return {
        gamePk: game.gamePk,
        gameDate: game.gameDate,
        officialDate: game.officialDate,
        gameNumber: game.gameNumber,
        location: metsAtHome ? ("HOME" as const) : ("AWAY" as const),
        opponentId: opponent.id,
        opponent: opponent.name,
        opponentAbbreviation: opponent.abbreviation || opponent.name.slice(0, 3).toUpperCase(),
        venue: game.venue,
        gameType: game.gameType,
        label: mlbGameLabel(game),
        startTimeTbd: game.startTimeTbd,
      };
    })
    .sort((left, right) => Date.parse(left.gameDate) - Date.parse(right.gameDate))
    .slice(0, Math.max(0, Math.trunc(limit)));
}

export async function fetchMlbSeasonDates(
  seasonId: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<MlbSeasonDates> {
  if (!Number.isInteger(seasonId) || seasonId < 1900 || seasonId > 2200) {
    throw new MlbFeedError("Season must be a four-digit year.", "INVALID_SEASON");
  }
  const url = new URL(`/api/v1/seasons/${seasonId}`, MLB_STATS_API_ORIGIN);
  url.searchParams.set("sportId", "1");
  const payload = await fetchJson(fetcher, url.toString(), signal);
  const season = arrayAt(payload, "seasons").find((candidate) => Number(stringAt(candidate, "seasonId")) === seasonId);
  const springStartDate = stringAt(season, "springStartDate");
  const offseasonStartDate = stringAt(season, "offseasonStartDate");
  if (!isCalendarDate(springStartDate) || !isCalendarDate(offseasonStartDate)) {
    throw new MlbFeedError("MLB season metadata omitted a required boundary date.", "INVALID_SEASON_SHAPE");
  }
  return { seasonId, springStartDate, offseasonStartDate };
}

export function offseasonWindowForDate(
  date: string,
  seasons: readonly MlbSeasonDates[],
): MlbOffseasonWindow | undefined {
  if (!isCalendarDate(date)) {
    throw new MlbFeedError("Season lookup date must use YYYY-MM-DD.", "INVALID_DATE");
  }
  const bySeason = new Map(seasons.map((season) => [season.seasonId, season]));
  for (const previous of seasons) {
    const next = bySeason.get(previous.seasonId + 1);
    if (!next) continue;
    if (date >= previous.offseasonStartDate && date < next.springStartDate) {
      return {
        startDate: previous.offseasonStartDate,
        endDate: next.springStartDate,
        previousSeasonId: previous.seasonId,
        nextSeasonId: next.seasonId,
      };
    }
  }
  return undefined;
}

/** The Mets' place in the postseason race. */
export interface MetsStanding {
  /** A postseason berth is theirs. */
  clinched: boolean;
  /** Out of both the division and wild-card races. */
  eliminated: boolean;
}

export const METS_STANDING_FIELDS = "teams,id,record,clinched,eliminationNumber,wildCardEliminationNumber";

export function parseMetsStanding(payload: unknown): MetsStanding | undefined {
  const team = arrayAt(payload, "teams").find((candidate) => numberAt(candidate, "id") === METS_TEAM_ID);
  const record = objectAt(team, "record");
  if (!record || typeof record.clinched !== "boolean") return undefined;
  const clinched = record.clinched;
  return {
    clinched,
    eliminated:
      !clinched &&
      stringAt(record, "eliminationNumber") === "E" &&
      stringAt(record, "wildCardEliminationNumber") === "E",
  };
}

export async function fetchMetsStanding(
  season: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<MetsStanding | undefined> {
  const url = new URL(`/api/v1/teams/${METS_TEAM_ID}`, MLB_STATS_API_ORIGIN);
  url.searchParams.set("season", String(season));
  url.searchParams.set("hydrate", "standings");
  url.searchParams.set("fields", METS_STANDING_FIELDS);
  return parseMetsStanding(await fetchJson(fetcher, url.toString(), signal));
}

/** The Mets' postseason games for a season, each with where its series stood. */
export async function fetchMetsPostseasonGames(
  season: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<readonly MlbScheduleGame[]> {
  const url = new URL("/api/v1/schedule", MLB_STATS_API_ORIGIN);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("teamId", String(METS_TEAM_ID));
  url.searchParams.set("season", String(season));
  url.searchParams.set("gameType", "F,D,L,W");
  url.searchParams.set("hydrate", "team,seriesStatus");
  return parseSchedule(await fetchJson(fetcher, url.toString(), signal));
}

/**
 * True once the Mets' postseason is over: the last series they finished
 * ended in a loss, or it was the World Series.
 */
export function postseasonRunOver(games: readonly MlbScheduleGame[]) {
  const last = games
    .filter((game) => isPostseasonGame(game) && game.abstractState.toLowerCase() === "final")
    .filter((game) => Number.isFinite(Date.parse(game.gameDate)))
    .sort((left, right) => Date.parse(right.gameDate) - Date.parse(left.gameDate))[0];
  if (!last?.seriesStatus?.isOver) return false;
  if (last.seriesStatus.losingTeamId === METS_TEAM_ID) return true;
  return last.gameType === "W" && last.seriesStatus.winningTeamId === METS_TEAM_ID;
}

/** What a week with nothing to follow shows, as on the physical Apple. */
export type MetsIdleCard = "NO_GAME_THIS_WEEK" | "NEXT_GAME_TBD" | "OFFSEASON";

/** Whether the standing decides the idle card this month: September and October. */
export function seasonFactsNeeded(month: number) {
  return month === 9 || month === 10;
}

/**
 * The card for a week with nothing to follow. November through February is
 * the offseason; in September and October the season is over once the Mets
 * are out of the race or out of the postseason. `postseasonOver` is only
 * consulted after a clinch. The physical Apple decides the same way
 * (firmware/lib/mlb_feed/src/season.cpp).
 */
export function metsIdleCard(
  month: number,
  standing: MetsStanding | undefined,
  postseasonOver: boolean | undefined,
): MetsIdleCard {
  if (month === 11 || month === 12 || month === 1 || month === 2) return "OFFSEASON";
  if (seasonFactsNeeded(month) && standing) {
    if (standing.eliminated) return "OFFSEASON";
    if (standing.clinched) return postseasonOver ? "OFFSEASON" : "NEXT_GAME_TBD";
  }
  return "NO_GAME_THIS_WEEK";
}
