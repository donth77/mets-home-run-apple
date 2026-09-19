import { MAXIMUM_ARCHIVE_TIMESTAMPS, MLB_STATS_API_ORIGIN, MLB_TIMECODE_PATTERN } from "./constants";
import { MlbFeedError } from "./errors";
import { playEventKey } from "./feedNormalization";
import { isFullFeed } from "./feedPayload";
import { arrayAt, numberAt, objectAt, stringAt } from "./jsonValue";
import { formatMlbTimecode } from "./timecode";
import { fetchJson } from "./transport";
import { METS_TEAM_ID } from "./constants";
import type { MlbHistoricalBookmark, MlbHistoricalGameIndex } from "./types";

function historicalTargetIndex(timestamps: readonly string[], target: string) {
  let low = 0;
  let high = timestamps.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timestamps[middle] < target) low = middle + 1;
    else high = middle;
  }
  return Math.min(low, timestamps.length - 1);
}

export async function fetchMlbHistoricalGameIndex(
  gamePk: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<MlbHistoricalGameIndex> {
  if (!Number.isInteger(gamePk) || gamePk <= 0) {
    throw new MlbFeedError("Historical replay requires a valid game identifier.", "INVALID_GAME_PK");
  }
  const timestampsUrl = `${MLB_STATS_API_ORIGIN}/api/v1.1/game/${gamePk}/feed/live/timestamps`;
  const fullFeedUrl = `${MLB_STATS_API_ORIGIN}/api/v1.1/game/${gamePk}/feed/live`;
  const [timestampPayload, finalFeed] = await Promise.all([
    fetchJson(fetcher, timestampsUrl, signal),
    fetchJson(fetcher, fullFeedUrl, signal),
  ]);
  if (
    !Array.isArray(timestampPayload) ||
    timestampPayload.length === 0 ||
    timestampPayload.length > MAXIMUM_ARCHIVE_TIMESTAMPS
  ) {
    throw new MlbFeedError("Historical replay returned an invalid timestamp index.", "INVALID_TIMESTAMP_INDEX");
  }
  if (!timestampPayload.every((value) => typeof value === "string" && MLB_TIMECODE_PATTERN.test(value))) {
    throw new MlbFeedError("Historical replay returned a malformed timecode.", "INVALID_TIMESTAMP_INDEX");
  }
  if (!isFullFeed(finalFeed)) {
    throw new MlbFeedError("Historical replay could not load the completed game feed.", "INVALID_FEED_SHAPE");
  }

  const timestamps = [...new Set(timestampPayload)].sort();
  const gameData = objectAt(finalFeed, "gameData");
  const teams = objectAt(gameData, "teams");
  const awayTeamId = numberAt(objectAt(teams, "away"), "id");
  const homeTeamId = numberAt(objectAt(teams, "home"), "id");
  const plays = arrayAt(objectAt(objectAt(finalFeed, "liveData"), "plays"), "allPlays");
  const bookmarks: MlbHistoricalBookmark[] = [];

  for (const play of plays) {
    const result = objectAt(play, "result");
    if (stringAt(result, "eventType") !== "home_run") continue;
    const about = objectAt(play, "about");
    const matchup = objectAt(play, "matchup");
    const batterName = stringAt(objectAt(matchup, "batter"), "fullName", "Unknown batter");
    const grandSlam = numberAt(result, "rbi") === 4;
    const eventDate = stringAt(about, "endTime");
    let target: string;
    try {
      target = formatMlbTimecode(eventDate);
    } catch {
      continue;
    }
    const targetIndex = historicalTargetIndex(timestamps, target);
    const beforeIndex = Math.max(0, targetIndex - 1);
    const half = stringAt(about, "halfInning").toLowerCase();
    const battingTeamId = half === "bottom" ? homeTeamId : awayTeamId;
    // Only Mets home runs move the Apple, so only those are worth a bookmark.
    if (battingTeamId !== METS_TEAM_ID) continue;
    bookmarks.push({
      id: playEventKey(play, gamePk),
      kind: grandSlam ? "GRAND_SLAM" : "HOME_RUN",
      label: `${grandSlam ? "Grand slam" : "Home run"} · ${batterName}`,
      detail: stringAt(result, "description", `${grandSlam ? "Grand slam" : "Home run"} by ${batterName}`),
      targetIndex,
      beforeIndex,
      targetTimecode: timestamps[targetIndex],
      beforeTimecode: timestamps[beforeIndex],
      battingTeamId,
    });
  }

  const status = objectAt(gameData, "status");
  const abstractState = stringAt(status, "abstractGameState").toLowerCase();
  const detailedState = stringAt(status, "detailedState").toLowerCase();
  if (abstractState === "final" || detailedState.includes("final") || detailedState === "game over") {
    const targetIndex = timestamps.length - 1;
    const beforeIndex = Math.max(0, targetIndex - 1);
    // A Mets win is the other thing that moves the Apple; any other final is
    // only the screen changing over.
    const linescoreTeams = objectAt(objectAt(objectAt(finalFeed, "liveData"), "linescore"), "teams");
    const homeRuns = numberAt(objectAt(linescoreTeams, "home"), "runs");
    const awayRuns = numberAt(objectAt(linescoreTeams, "away"), "runs");
    const metsWon =
      (homeTeamId === METS_TEAM_ID && homeRuns > awayRuns) || (awayTeamId === METS_TEAM_ID && awayRuns > homeRuns);
    bookmarks.push({
      id: `${gamePk}:final`,
      kind: metsWon ? "METS_WIN" : "FINAL",
      label: metsWon ? "Mets win" : "Final state",
      detail: metsWon
        ? "The final update that makes it a Mets win, which the Apple celebrates."
        : "Transition from the last live update to MLB's final game status. No celebration.",
      targetIndex,
      beforeIndex,
      targetTimecode: timestamps[targetIndex],
      beforeTimecode: timestamps[beforeIndex],
    });
  }

  bookmarks.sort((left, right) => left.targetIndex - right.targetIndex || left.id.localeCompare(right.id));
  return { timestamps, bookmarks };
}
