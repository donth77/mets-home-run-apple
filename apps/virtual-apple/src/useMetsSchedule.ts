import { useEffect, useState } from "react";
import {
  easternDate,
  fetchMetsScheduleRange,
  selectUpcomingMetsGames,
  type UpcomingMetsGame,
} from "@apple/mlb-live-feed";

const SCHEDULE_WINDOW_DAYS = 21;
const SCHEDULE_CACHE_MS = 10 * 60 * 1000;
const SCHEDULE_RETRY_MS = 60 * 1000;

interface ScheduleCache {
  expiresAt: number;
  games: readonly UpcomingMetsGame[];
}

let scheduleCache: ScheduleCache | null = null;

function dateAfterDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export type { UpcomingMetsGame } from "@apple/mlb-live-feed";

export function useMetsSchedule(enabled: boolean) {
  const [games, setGames] = useState<readonly UpcomingMetsGame[]>([]);

  useEffect(() => {
    if (!enabled) {
      setGames([]);
      return;
    }

    let disposed = false;
    let controller: AbortController | undefined;
    let refreshTimer: number | undefined;
    const queueRefresh = (delayMs: number) => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), delayMs);
    };

    const refresh = async () => {
      const now = new Date();
      if (scheduleCache && scheduleCache.expiresAt > now.getTime()) {
        setGames(scheduleCache.games);
        queueRefresh(scheduleCache.expiresAt - now.getTime());
        return;
      }

      controller?.abort();
      controller = new AbortController();
      try {
        const schedule = await fetchMetsScheduleRange(
          easternDate(now),
          easternDate(dateAfterDays(now, SCHEDULE_WINDOW_DAYS)),
          fetch,
          controller.signal,
        );
        if (disposed) return;
        const nextGames = selectUpcomingMetsGames(schedule, now);
        scheduleCache = { expiresAt: Date.now() + SCHEDULE_CACHE_MS, games: nextGames };
        setGames(nextGames);
        queueRefresh(SCHEDULE_CACHE_MS);
      } catch (reason) {
        if (disposed || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setGames([]);
        queueRefresh(SCHEDULE_RETRY_MS);
      }
    };

    void refresh();
    return () => {
      disposed = true;
      controller?.abort();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [enabled]);

  return games;
}
