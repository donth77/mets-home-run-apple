import { METS_TEAM_ID, MLB_STATS_API_ORIGIN } from "./constants";
import { MlbFeedError } from "./errors";
import { arrayAt, isObject, numberAt, objectAt, stringAt } from "./jsonValue";
import { fetchJson } from "./transport";

export interface MlbScheduleGame {
  gamePk: number;
  gameNumber: 1 | 2;
  gameDate: string;
  abstractState: string;
  detailedState: string;
  venue?: string;
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
  gameNumber: 1 | 2;
  location: "HOME" | "AWAY";
  opponentId: number;
  opponent: string;
  opponentAbbreviation: string;
  venue?: string;
}

function scheduleTeam(value: unknown) {
  const team = objectAt(value, "team");
  return {
    id: numberAt(team, "id"),
    abbreviation: stringAt(team, "abbreviation", "—"),
    name: stringAt(team, "name", "Unknown team"),
  };
}

function parseSchedule(payload: unknown): readonly MlbScheduleGame[] {
  return arrayAt(payload, "dates")
    .flatMap((date) => arrayAt(date, "games"))
    .flatMap((candidate): MlbScheduleGame[] => {
      if (!isObject(candidate)) return [];
      const gamePk = numberAt(candidate, "gamePk");
      const gameNumber = numberAt(candidate, "gameNumber", 1);
      const teams = objectAt(candidate, "teams");
      if (gamePk <= 0 || (gameNumber !== 1 && gameNumber !== 2) || !teams) return [];
      return [
        {
          gamePk,
          gameNumber,
          gameDate: stringAt(candidate, "gameDate"),
          abstractState: stringAt(objectAt(candidate, "status"), "abstractGameState", "Preview"),
          detailedState: stringAt(objectAt(candidate, "status"), "detailedState", "Scheduled"),
          venue: stringAt(objectAt(candidate, "venue"), "name") || undefined,
          away: scheduleTeam(teams.away),
          home: scheduleTeam(teams.home),
        },
      ];
    });
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
      return state !== "FINAL" && state !== "LIVE" && Date.parse(game.gameDate) > nowMs;
    })
    .map((game) => {
      const metsAtHome = game.home.id === METS_TEAM_ID;
      const opponent = metsAtHome ? game.away : game.home;
      return {
        gamePk: game.gamePk,
        gameDate: game.gameDate,
        gameNumber: game.gameNumber,
        location: metsAtHome ? ("HOME" as const) : ("AWAY" as const),
        opponentId: opponent.id,
        opponent: opponent.name,
        opponentAbbreviation: opponent.abbreviation || opponent.name.slice(0, 3).toUpperCase(),
        venue: game.venue,
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
