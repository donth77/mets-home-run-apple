import { useEffect, useMemo, useState } from "react";
import {
  easternDate,
  fetchMlbSeasonDates,
  offseasonWindowForDate,
  type MlbOffseasonWindow,
  type MlbSeasonDates,
} from "@apple/mlb-live-feed";
import { mlbApiFetch } from "./mlbApiFetch";

const CALENDAR_RECHECK_MS = 60_000;
const METADATA_REFRESH_MS = 24 * 60 * 60_000;
const METADATA_RETRY_MS = 15 * 60_000;

export type MlbSeasonPhaseStatus = "CHECKING" | "READY" | "ERROR";

export interface MlbSeasonPhaseState {
  status: MlbSeasonPhaseStatus;
  isOffseason: boolean;
  date: string;
  window?: MlbOffseasonWindow;
  checkedAt?: string;
  error?: string;
}

function seasonYearsForDate(date: string) {
  const year = Number(date.slice(0, 4));
  return [year - 1, year, year + 1];
}

export function useMlbSeasonPhase(): MlbSeasonPhaseState {
  const [date, setDate] = useState(() => easternDate());
  const [seasons, setSeasons] = useState<readonly MlbSeasonDates[]>([]);
  const [status, setStatus] = useState<MlbSeasonPhaseStatus>("CHECKING");
  const [checkedAt, setCheckedAt] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    let refreshTimer: number | undefined;

    const queueRefresh = (delayMs: number) => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), delayMs);
    };

    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      const requestDate = easternDate();
      try {
        const nextSeasons = await Promise.all(
          seasonYearsForDate(requestDate).map((year) => fetchMlbSeasonDates(year, mlbApiFetch, controller?.signal)),
        );
        if (disposed) return;
        setDate(requestDate);
        setSeasons(nextSeasons);
        setStatus("READY");
        setCheckedAt(new Date().toISOString());
        setError(undefined);
        queueRefresh(METADATA_REFRESH_MS);
      } catch (reason) {
        if (disposed || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setStatus("ERROR");
        setError(reason instanceof Error ? reason.message : "MLB season dates are temporarily unavailable.");
        queueRefresh(METADATA_RETRY_MS);
      }
    };

    void refresh();
    const calendarTimer = window.setInterval(() => setDate(easternDate()), CALENDAR_RECHECK_MS);
    return () => {
      disposed = true;
      controller?.abort();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      window.clearInterval(calendarTimer);
    };
  }, []);

  const windowForDate = useMemo(() => offseasonWindowForDate(date, seasons), [date, seasons]);

  return {
    status,
    isOffseason: Boolean(windowForDate),
    date,
    window: windowForDate,
    checkedAt,
    error,
  };
}
