import { MAXIMUM_ARCHIVE_TIMESTAMPS, MLB_STATS_API_ORIGIN, MLB_TIMECODE_PATTERN } from "./constants";
import { MlbFeedError } from "./errors";
import { isFullFeed } from "./feedPayload";
import { playEventKey } from "./feedNormalization";
import { arrayAt, numberAt, objectAt, stringAt } from "./jsonValue";
import { formatMlbTimecode } from "./timecode";
import { fetchJson } from "./transport";
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
    if (stringAt(objectAt(play, "result"), "eventType") !== "home_run") continue;
    const about = objectAt(play, "about");
    const matchup = objectAt(play, "matchup");
    const batterName = stringAt(objectAt(matchup, "batter"), "fullName", "Unknown batter");
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
    bookmarks.push({
      id: playEventKey(play, gamePk),
      kind: "HOME_RUN",
      label: `Home run · ${batterName}`,
      detail: stringAt(objectAt(play, "result"), "description", `Home run by ${batterName}`),
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
    bookmarks.push({
      id: `${gamePk}:final`,
      kind: "FINAL",
      label: "Final state",
      detail: "Transition from the last live update to MLB's final game status.",
      targetIndex,
      beforeIndex,
      targetTimecode: timestamps[targetIndex],
      beforeTimecode: timestamps[beforeIndex],
    });
  }

  bookmarks.sort((left, right) => left.targetIndex - right.targetIndex || left.id.localeCompare(right.id));
  return { timestamps, bookmarks };
}
