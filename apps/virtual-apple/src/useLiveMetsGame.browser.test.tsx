/** @vitest-environment happy-dom */

import type { GameSnapshot } from "@apple/protocol";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  ingest: vi.fn(),
  poll: vi.fn(),
  reportPosition: vi.fn(),
  schedule: vi.fn(),
  tick: vi.fn(),
}));

vi.mock("@apple/mlb-live-feed", () => ({
  METS_TEAM_ID: 121,
  MLB_STATS_API_ORIGIN: "https://statsapi.mlb.com",
  MlbRecordingClient: class {
    poll(...arguments_: unknown[]) {
      return testState.poll(...arguments_);
    }
  },
  easternDate: () => "2026-08-28",
  fetchMetsSchedule: (...arguments_: unknown[]) => testState.schedule(...arguments_),
}));

vi.mock("./liveGameCoreController", () => ({
  LiveGameCoreController: {
    create: async () => ({
      dispose: vi.fn(),
      ingest: (...arguments_: unknown[]) => testState.ingest(...arguments_),
      reportPosition: (...arguments_: unknown[]) => testState.reportPosition(...arguments_),
      tick: (...arguments_: unknown[]) => testState.tick(...arguments_),
    }),
  },
  coreSequenceNeedsTicking: (sequenceState: string | undefined) =>
    sequenceState === "LEAD_IN" ||
    sequenceState === "EXTENDING" ||
    sequenceState === "RAISED" ||
    sequenceState === "RETRACTING",
}));

import { MINI_APPLE_HEARTBEAT_EVENT } from "./miniAppleHeartbeat";
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

const coreInput = {
  schemaVersion: 1 as const,
  updateMode: "BOOTSTRAP" as const,
  gamePk: snapshot.gamePk,
  gameNumber: snapshot.gameNumber,
  cursor: "20260828_230000",
  phase: snapshot.phase,
  half: snapshot.half,
  inning: snapshot.inning,
  outs: snapshot.outs,
  awayTeamId: snapshot.away.id ?? 0,
  homeTeamId: snapshot.home.id ?? 0,
  awayRuns: snapshot.away.runs,
  homeRuns: snapshot.home.runs,
  plays: [],
};

const activeGame = {
  abstractState: "Live",
  away: { abbreviation: "HOU", id: 117, name: "Houston Astros" },
  detailedState: "In Progress",
  gameDate: "2026-08-28T23:10:00Z",
  gameNumber: 1,
  gamePk: 823583,
  home: { abbreviation: "NYM", id: 121, name: "New York Mets" },
  venue: "Citi Field",
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  testState.ingest.mockReset().mockReturnValue({ celebration: undefined, targetPositionMm: 0 });
  testState.poll.mockReset();
  testState.reportPosition.mockReset().mockReturnValue({ celebration: undefined, targetPositionMm: 0 });
  testState.schedule.mockReset().mockResolvedValue([activeGame]);
  testState.tick.mockReset().mockReturnValue({ celebration: undefined, targetPositionMm: 0 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("live mobile recovery", () => {
  it("keeps the last game state and recovers quickly after one failed poll", async () => {
    testState.poll
      .mockResolvedValueOnce({ capture: { coreInput, gameSnapshot: snapshot }, waitMs: 10_000 })
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
    testState.poll.mockResolvedValue({ capture: { coreInput, gameSnapshot: snapshot }, waitMs: 60_000 });
    renderHook(() => useLiveMetsGame());
    await flush();
    expect(testState.poll).toHaveBeenCalledOnce();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flush();

    expect(testState.poll).toHaveBeenCalledTimes(2);
  });

  it("services a due poll and core clock from the visible Mini Apple heartbeat", async () => {
    const activePresentation = {
      celebration: { eventKey: "823583:final", kind: "METS_WIN" as const, subject: "Mets Win!" },
      decision: { sequenceState: "LEAD_IN" as const },
      targetPositionMm: 0,
    };
    testState.ingest.mockReturnValue(activePresentation);
    testState.tick.mockReturnValue(activePresentation);
    testState.poll.mockResolvedValue({ capture: { coreInput, gameSnapshot: snapshot }, waitMs: 10_000 });
    const startedAt = Date.now();
    renderHook(() => useLiveMetsGame());
    await flush();

    expect(testState.poll).toHaveBeenCalledOnce();
    expect(testState.tick).not.toHaveBeenCalled();
    vi.setSystemTime(startedAt + 10_001);

    act(() => window.dispatchEvent(new Event(MINI_APPLE_HEARTBEAT_EVENT)));
    await flush();

    expect(testState.tick).toHaveBeenCalledOnce();
    expect(testState.poll).toHaveBeenCalledTimes(2);
  });
});

describe("terminal game transitions", () => {
  it("does not leave a final game until its active and queued celebrations have settled", async () => {
    const finalSnapshot: GameSnapshot = {
      ...snapshot,
      home: { ...snapshot.home, runs: 4 },
      label: "FINAL",
      lastEvent: "Juan Soto homers on a fly ball to center field.",
      phase: "FINAL",
    };
    const finalInput = {
      ...coreInput,
      cursor: "20260830_192231",
      phase: "FINAL" as const,
      homeRuns: 4,
      plays: [
        {
          atBatIndex: 6,
          batterName: "Juan Soto",
          battingTeamId: 121,
          complete: true,
          eventKey: "823583:soto-home-run",
          kind: "HOME_RUN" as const,
          review: "NONE" as const,
        },
      ],
      updateMode: "INCREMENTAL" as const,
    };
    const activePresentation = {
      celebration: { eventKey: "823583:soto-home-run", kind: "HOME_RUN" as const, subject: "Juan Soto" },
      decision: { sequenceState: "LEAD_IN" as const },
      targetPositionMm: 0,
    };
    let settled = false;
    testState.ingest.mockReturnValue(activePresentation);
    testState.tick.mockImplementation(() =>
      settled ? { decision: { sequenceState: "IDLE" }, targetPositionMm: 0 } : activePresentation,
    );
    testState.reportPosition.mockImplementation(() => {
      settled = true;
      return { decision: { sequenceState: "IDLE" }, targetPositionMm: 0 };
    });
    testState.poll.mockResolvedValue({
      capture: { coreInput: finalInput, gameSnapshot: finalSnapshot },
      waitMs: 10_000,
    });

    const { result } = renderHook(() => useLiveMetsGame());
    await flush();
    expect(result.current.status).toBe("FINAL");
    expect(result.current.celebration?.subject).toBe("Juan Soto");
    expect(testState.schedule).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(testState.schedule).toHaveBeenCalledOnce();

    act(() => result.current.reportPosition(0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(testState.schedule).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(testState.schedule).toHaveBeenCalledTimes(2);
  });
});
