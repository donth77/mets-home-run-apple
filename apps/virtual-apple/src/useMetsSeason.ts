import {
  easternDate,
  fetchMetsPostseasonGames,
  fetchMetsScheduleRange,
  fetchMetsStanding,
  type MetsStanding,
  metsIdleCard,
  type MlbScheduleGame,
  postseasonRunOver,
  seasonFactsNeeded,
  yieldsToHomeSplitSquad,
} from "@apple/mlb-live-feed";
import { useCallback, useEffect, useRef, useState } from "react";
import { mlbApiFetch } from "./mlbApiFetch";

const DAY_MS = 24 * 60 * 60_000;
const SEASON_RECHECK_MS = 30 * 60_000;
const SEASON_FACTS_REFRESH_MS = 60 * 60_000;
const SEASON_RETRY_MS = 5 * 60_000;
/** A game this far past its listed start that never went live is stale schedule data. */
const STALE_START_MS = 6 * 60 * 60_000;

export interface MetsSeasonState {
  status: "CHECKING" | "READY";
  /**
   * The Mets' season is over (out of the race, out of the postseason, or
   * between seasons) and nothing is scheduled within the week. The physical
   * Apple shows its offseason card on the same facts.
   */
  seasonOver: boolean;
  /** A Mets game, spring training included, is scheduled within the week. */
  gameThisWeek: boolean;
  /** Decide again now, as after a game ends. */
  recheck(): void;
}

/** A game the Apples could still follow: not over, not called off, not long overdue. */
export function gameStillAhead(game: MlbScheduleGame, games: readonly MlbScheduleGame[], nowMs: number) {
  const startMs = Date.parse(game.gameDate);
  return (
    game.abstractState.toLowerCase() !== "final" &&
    !/postponed|cancell?ed|suspended/i.test(game.detailedState) &&
    Number.isFinite(startMs) &&
    startMs + STALE_START_MS > nowMs &&
    !yieldsToHomeSplitSquad(game, games)
  );
}

interface SeasonFacts {
  year: number;
  standing?: MetsStanding;
  standingCheckedAt?: number;
  postseasonOver?: boolean;
  postseasonCheckedAt?: number;
}

function due(checkedAt: number | undefined, nowMs: number) {
  return checkedAt === undefined || nowMs - checkedAt >= SEASON_FACTS_REFRESH_MS;
}

/**
 * Whether the Mets' season is over, decided the way the physical Apple
 * decides it: first whether any game is within the week (yesterday through
 * a week ahead, as the Nano reads it); then, in September and October only,
 * whether they are out of the race or out of the postseason; November
 * through February is between seasons.
 */
export function useMetsSeason(leagueOffseason: boolean, enabled: boolean): MetsSeasonState {
  const [state, setState] = useState<Omit<MetsSeasonState, "recheck">>({
    status: "CHECKING",
    seasonOver: false,
    gameThisWeek: false,
  });
  const factsRef = useRef<SeasonFacts>({ year: 0 });
  const recheckRef = useRef<() => void>(() => {});
  const recheck = useCallback(() => recheckRef.current(), []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const queue = (delayMs: number) => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void decide(), delayMs);
    };

    const refreshFacts = async (year: number, signal: AbortSignal) => {
      const nowMs = Date.now();
      if (factsRef.current.year !== year) factsRef.current = { year };
      const facts = factsRef.current;
      if (!facts.standing?.eliminated && due(facts.standingCheckedAt, nowMs)) {
        facts.standingCheckedAt = nowMs;
        facts.standing = (await fetchMetsStanding(year, mlbApiFetch, signal)) ?? facts.standing;
      }
      if (facts.standing?.clinched && !facts.postseasonOver && due(facts.postseasonCheckedAt, nowMs)) {
        facts.postseasonCheckedAt = nowMs;
        facts.postseasonOver = postseasonRunOver(await fetchMetsPostseasonGames(year, mlbApiFetch, signal));
      }
    };

    const decide = async () => {
      controller?.abort();
      controller = new AbortController();
      const now = new Date();
      try {
        const games = await fetchMetsScheduleRange(
          easternDate(new Date(now.getTime() - DAY_MS)),
          easternDate(new Date(now.getTime() + 7 * DAY_MS)),
          mlbApiFetch,
          controller.signal,
        );
        const gameThisWeek = games.some((game) => gameStillAhead(game, games, now.getTime()));
        let seasonOver = false;
        if (!gameThisWeek) {
          const [year, month] = easternDate(now).split("-").map(Number);
          if (seasonFactsNeeded(month)) await refreshFacts(year, controller.signal);
          seasonOver =
            leagueOffseason ||
            metsIdleCard(month, factsRef.current.standing, factsRef.current.postseasonOver) === "OFFSEASON";
        }
        if (disposed) return;
        setState({ status: "READY", seasonOver, gameThisWeek });
        queue(SEASON_RECHECK_MS);
      } catch (reason) {
        if (disposed || (reason instanceof DOMException && reason.name === "AbortError")) return;
        // Without an answer the page keeps what it last decided; the first
        // time, it carries on as if in season rather than hold the page.
        setState((current) => ({ ...current, status: "READY" }));
        queue(SEASON_RETRY_MS);
      }
    };

    recheckRef.current = () => void decide();
    void decide();
    return () => {
      disposed = true;
      recheckRef.current = () => {};
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, leagueOffseason]);

  return { ...state, recheck };
}
