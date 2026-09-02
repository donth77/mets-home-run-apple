import { describe, expect, it } from "vitest";
import {
  FINAL_SCOREBOARD_HOLD_MS,
  liveFeedContinuation,
  liveFeedRetryDelay,
  RECENT_FINAL_DISCOVERY_MAX_AGE_MS,
  remainingLivePollDelay,
  selectRecentlyFinalMetsGame,
  selectTrackableMetsGame,
  TERMINAL_SCOREBOARD_HOLD_MS,
} from "./useLiveMetsGame";

function game(gamePk: number, abstractState: string, detailedState: string) {
  return {
    gamePk,
    gameNumber: 1 as const,
    gameDate: "2026-08-27T23:10:00Z",
    abstractState,
    detailedState,
    away: { id: 146, abbreviation: "MIA", name: "Miami Marlins" },
    home: { id: 121, abbreviation: "NYM", name: "New York Mets" },
  };
}

describe("live Mets game selection", () => {
  it("selects an active game without treating a later doubleheader game as live", () => {
    const active = game(2, "Live", "In Progress");
    expect(selectTrackableMetsGame([game(1, "Final", "Final"), active, game(3, "Preview", "Scheduled")])).toBe(active);
  });

  it("keeps delayed and review states connected to their game feed", () => {
    expect(selectTrackableMetsGame([game(1, "Live", "Rain Delay")])?.gamePk).toBe(1);
    expect(selectTrackableMetsGame([game(2, "Live", "Umpire Review")])?.gamePk).toBe(2);
  });

  it("returns no game between games", () => {
    expect(selectTrackableMetsGame([game(1, "Final", "Final"), game(2, "Preview", "Scheduled")])).toBeUndefined();
  });

  it("selects a recently completed game for a one-time Virtual Apple replay check", () => {
    const completed = game(1, "Final", "Final");
    const startedAtMs = Date.parse(completed.gameDate);

    expect(selectRecentlyFinalMetsGame([completed], startedAtMs + 4 * 60 * 60_000)).toBe(completed);
    expect(
      selectRecentlyFinalMetsGame([completed], startedAtMs + RECENT_FINAL_DISCOVERY_MAX_AGE_MS + 1),
    ).toBeUndefined();
    expect(selectRecentlyFinalMetsGame([completed], startedAtMs + 4 * 60 * 60_000, new Set([1]))).toBeUndefined();
  });
});

describe("live feed recovery", () => {
  it("retries transient failures quickly and caps the backoff", () => {
    expect(liveFeedRetryDelay(1)).toBe(2_000);
    expect(liveFeedRetryDelay(2)).toBe(5_000);
    expect(liveFeedRetryDelay(3)).toBe(10_000);
    expect(liveFeedRetryDelay(4)).toBe(30_000);
    expect(liveFeedRetryDelay(20)).toBe(30_000);
  });
});

describe("live feed continuation", () => {
  it("holds an accepted final snapshot before checking for the next game", () => {
    expect(liveFeedContinuation("FINAL", 5_000)).toEqual({
      kind: "DISCOVER",
      delayMs: FINAL_SCOREBOARD_HOLD_MS,
    });
    expect(FINAL_SCOREBOARD_HOLD_MS).toBe(60_000);
  });

  it("keeps polling at the feed cadence while the game is not final", () => {
    expect(liveFeedContinuation("LIVE", 5_000)).toEqual({ kind: "POLL", delayMs: 5_000 });
  });

  it("stops polling terminal postponed and cancelled feeds after a short scoreboard hold", () => {
    expect(liveFeedContinuation("DELAYED", 5_000, "Postponed")).toEqual({
      kind: "DISCOVER",
      delayMs: TERMINAL_SCOREBOARD_HOLD_MS,
    });
    expect(liveFeedContinuation("DELAYED", 5_000, "Cancelled: Weather")).toEqual({
      kind: "DISCOVER",
      delayMs: TERMINAL_SCOREBOARD_HOLD_MS,
    });
    expect(liveFeedContinuation("DELAYED", 5_000, "Suspended: Rain")).toEqual({ kind: "POLL", delayMs: 5_000 });
  });

  it("counts request time toward the polling cadence", () => {
    expect(remainingLivePollDelay(10_000, 275)).toBe(9_725);
    expect(remainingLivePollDelay(10_000, 10_500)).toBe(0);
    expect(remainingLivePollDelay(10_000, -1)).toBe(10_000);
  });
});
