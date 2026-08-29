/** @vitest-environment happy-dom */

import { act, cleanup, renderHook } from "@testing-library/react";
import type { GameSnapshot } from "@apple/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  poll: vi.fn(),
}));

vi.mock("@apple/mlb-live-feed", () => ({
  MLB_STATS_API_ORIGIN: "https://statsapi.mlb.com",
  MlbRecordingClient: class {
    poll(...arguments_: unknown[]) {
      return testState.poll(...arguments_);
    }
  },
  easternDate: () => "2026-08-28",
  fetchMetsSchedule: async () => [
    {
      abstractState: "Live",
      away: { abbreviation: "HOU", id: 117, name: "Houston Astros" },
      detailedState: "In Progress",
      gameDate: "2026-08-28T23:10:00Z",
      gameNumber: 1,
      gamePk: 823583,
      home: { abbreviation: "NYM", id: 121, name: "New York Mets" },
      venue: "Citi Field",
    },
  ],
}));

vi.mock("./liveGameCoreController", () => ({
  LiveGameCoreController: {
    create: async () => ({
      dispose: vi.fn(),
      ingest: () => ({ celebration: undefined, targetPositionMm: 0 }),
      reportPosition: () => ({ celebration: undefined, targetPositionMm: 0 }),
      tick: () => ({ celebration: undefined, targetPositionMm: 0 }),
    }),
  },
  coreSequenceNeedsTicking: () => false,
}));

import { useLiveMetsGame } from "./useLiveMetsGame";

const snapshot: GameSnapshot = {
  atBat: {
    balls: 1,
    bases: { first: false, second: false, third: false },
    batter: "Juan Soto",
    pitcher: "Hunter Brown",
    strikes: 1,
  },
  away: { abbreviation: "HOU", id: 117, name: "Houston Astros", runs: 3 },
  gameNumber: 1,
  gamePk: 823583,
  half: "BOTTOM",
  home: { abbreviation: "NYM", id: 121, name: "New York Mets", runs: 1 },
  inning: 8,
  label: "LIVE",
  lastEvent: "Called Strike",
  outs: 1,
  phase: "LIVE",
  review: "NONE",
  schemaVersion: 1,
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  testState.poll.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("live mobile recovery", () => {
  it("keeps the last game state and recovers quickly after one failed poll", async () => {
    testState.poll
      .mockResolvedValueOnce({ capture: { coreInput: {}, gameSnapshot: snapshot }, waitMs: 10_000 })
      .mockRejectedValueOnce(new TypeError("mobile network changed"))
      .mockResolvedValueOnce({ waitMs: 10_000 });
    const { result } = renderHook(() => useLiveMetsGame());
    await flush();

    expect(result.current.status).toBe("POLLING");
    expect(result.current.snapshot).toBe(snapshot);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.status).toBe("POLLING");
    expect(result.current.snapshot).toBe(snapshot);
    expect(result.current.error).toBe("mobile network changed");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(testState.poll).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe("POLLING");
    expect(result.current.error).toBeUndefined();
  });

  it("polls immediately when a backgrounded phone returns to the page", async () => {
    testState.poll.mockResolvedValue({ capture: { coreInput: {}, gameSnapshot: snapshot }, waitMs: 60_000 });
    renderHook(() => useLiveMetsGame());
    await flush();
    expect(testState.poll).toHaveBeenCalledOnce();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flush();

    expect(testState.poll).toHaveBeenCalledTimes(2);
  });
});
