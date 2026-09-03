/** @vitest-environment happy-dom */

import type { GameSnapshot, NormalizedGameInput } from "@apple/protocol";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  clientArguments: [] as unknown[],
  gameStateClassify: vi.fn(),
  gameStateDispose: vi.fn(),
  gameStateProject: vi.fn(),
  ingest: vi.fn(),
  poll: vi.fn(),
  reportPosition: vi.fn(),
  schedule: vi.fn(),
  tick: vi.fn(),
}));

vi.mock("@apple/game-state-wasm", () => ({
  GameStateProjector: {
    create: async () => ({
      dispose: testState.gameStateDispose,
      project: (...arguments_: unknown[]) => testState.gameStateProject(...arguments_),
      classifyStatus: (...arguments_: unknown[]) => testState.gameStateClassify(...arguments_),
    }),
  },
}));

vi.mock("@apple/mlb-live-feed", () => ({
  METS_TEAM_ID: 121,
  MLB_STATS_API_ORIGIN: "https://statsapi.mlb.com",
  MlbRecordingClient: class {
    constructor(...arguments_: unknown[]) {
      testState.clientArguments = arguments_;
    }

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
  testState.clientArguments = [];
  testState.gameStateClassify.mockReset();
  testState.gameStateDispose.mockReset();
  testState.gameStateProject.mockReset();
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
  it("constructs the live feed with the C++ game-state projector", async () => {
    testState.poll.mockResolvedValue({ capture: { coreInput, gameSnapshot: snapshot }, waitMs: 10_000 });
    const { unmount } = renderHook(() => useLiveMetsGame());
    await flush();

    expect(testState.clientArguments).toHaveLength(4);
    expect(testState.clientArguments[2]).toBeTypeOf("function");
    expect(testState.clientArguments[3]).toBeTypeOf("function");
    const canonicalFrame = { gamePk: 823583 };
    testState.gameStateProject.mockReturnValue({ coreInput, gameSnapshot: snapshot });
    expect((testState.clientArguments[2] as (value: unknown) => unknown)(canonicalFrame)).toEqual({
      coreInput,
      gameSnapshot: snapshot,
    });
    expect(testState.gameStateProject).toHaveBeenCalledWith(canonicalFrame);
    // The status classifier (delays, suspended, postponed, cancelled) is the same C++.
    const facts = { abstractState: "Live", detailedState: "Delayed", statusCode: "IO" };
    const classification = { phase: "DELAYED", label: "RAIN DELAY", weatherDelay: true };
    testState.gameStateClassify.mockReturnValue(classification);
    expect((testState.clientArguments[3] as (value: unknown) => unknown)(facts)).toEqual(classification);
    expect(testState.gameStateClassify).toHaveBeenCalledWith(facts);

    unmount();
    expect(testState.gameStateDispose).toHaveBeenCalledOnce();
  });

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

describe("fresh-entry celebration replay", () => {
  it("starts the full core sequence for a home run completed within the replay window", async () => {
    vi.setSystemTime(new Date("2026-08-28T23:05:00.000Z"));
    const eventKey = "823583:recent-home-run";
    const recentInput = {
      ...coreInput,
      cursor: "20260828_230400",
      homeRuns: 2,
      plays: [
        {
          atBatIndex: 42,
          batterName: "Juan Soto",
          battingTeamId: 121,
          complete: true,
          eventKey,
          kind: "HOME_RUN" as const,
          review: "NONE" as const,
        },
      ],
    };
    const activePresentation = {
      celebration: { eventKey, kind: "HOME_RUN" as const, subject: "Juan Soto" },
      decision: { sequenceState: "LEAD_IN" as const },
      targetPositionMm: 0,
    };
    testState.ingest.mockImplementation((input: NormalizedGameInput) =>
      input.updateMode === "INCREMENTAL"
        ? activePresentation
        : { decision: { sequenceState: "IDLE" }, celebration: undefined, targetPositionMm: 0 },
    );
    testState.poll.mockResolvedValue({
      capture: {
        coreInput: recentInput,
        gameSnapshot: { ...snapshot, home: { ...snapshot.home, runs: 2 } },
        replayCandidates: [{ eventKey, kind: "HOME_RUN", occurredAt: "2026-08-28T23:04:00.000Z" }],
      },
      waitMs: 10_000,
    });

    const { result } = renderHook(() => useLiveMetsGame());
    await flush();

    expect(testState.ingest.mock.calls.map(([input]) => input.updateMode)).toEqual(["BOOTSTRAP", "INCREMENTAL"]);
    expect(result.current.celebration).toEqual(activePresentation.celebration);
  });

  it("keeps an expired home run in bootstrap history without replaying it", async () => {
    vi.setSystemTime(new Date("2026-08-28T23:10:01.000Z"));
    const eventKey = "823583:expired-home-run";
    const expiredInput = {
      ...coreInput,
      cursor: "20260828_230400",
      plays: [
        {
          atBatIndex: 42,
          batterName: "Juan Soto",
          battingTeamId: 121,
          complete: true,
          eventKey,
          kind: "HOME_RUN" as const,
          review: "NONE" as const,
        },
      ],
    };
    testState.poll.mockResolvedValue({
      capture: {
        coreInput: expiredInput,
        gameSnapshot: snapshot,
        replayCandidates: [{ eventKey, kind: "HOME_RUN", occurredAt: "2026-08-28T23:04:00.000Z" }],
      },
      waitMs: 10_000,
    });

    const { result } = renderHook(() => useLiveMetsGame());
    await flush();

    expect(testState.ingest).toHaveBeenCalledOnce();
    expect(testState.ingest.mock.calls[0]?.[0]).toBe(expiredInput);
    expect(result.current.celebration).toBeUndefined();
  });

  it("opens a recently completed game and replays a core-confirmed Mets win", async () => {
    vi.setSystemTime(new Date("2026-08-29T02:01:00.000Z"));
    const completedGame = { ...activeGame, abstractState: "Final", detailedState: "Final" };
    const finalSnapshot: GameSnapshot = {
      ...snapshot,
      away: { ...snapshot.away, runs: 3 },
      home: { ...snapshot.home, runs: 4 },
      half: "END",
      label: "FINAL",
      phase: "FINAL",
    };
    const finalInput = {
      ...coreInput,
      awayRuns: 3,
      homeRuns: 4,
      cursor: "20260829_020000",
      half: "END" as const,
      phase: "FINAL" as const,
    };
    const activePresentation = {
      celebration: { eventKey: `${snapshot.gamePk}:final`, kind: "METS_WIN" as const, subject: "Mets Win!" },
      decision: { sequenceState: "LEAD_IN" as const },
      targetPositionMm: 0,
    };
    testState.schedule.mockResolvedValue([completedGame]);
    testState.ingest.mockImplementation((input: NormalizedGameInput) =>
      input.updateMode === "INCREMENTAL"
        ? activePresentation
        : { decision: { sequenceState: "IDLE" }, celebration: undefined, targetPositionMm: 0 },
    );
    testState.poll.mockResolvedValue({
      capture: {
        coreInput: finalInput,
        gameSnapshot: finalSnapshot,
        replayCandidates: [
          { eventKey: `${snapshot.gamePk}:final`, kind: "FINAL", occurredAt: "2026-08-29T02:00:00.000Z" },
        ],
      },
      waitMs: 10_000,
    });

    const { result } = renderHook(() => useLiveMetsGame());
    await flush();

    expect(result.current.status).toBe("FINAL");
    expect(result.current.celebration).toEqual(activePresentation.celebration);
  });

  it("inspects an expired completed game without flashing its final scoreboard", async () => {
    vi.setSystemTime(new Date("2026-08-29T02:10:01.000Z"));
    const completedGame = { ...activeGame, abstractState: "Final", detailedState: "Final" };
    const finalSnapshot: GameSnapshot = {
      ...snapshot,
      away: { ...snapshot.away, runs: 3 },
      home: { ...snapshot.home, runs: 4 },
      half: "END",
      label: "FINAL",
      phase: "FINAL",
    };
    const finalInput = {
      ...coreInput,
      awayRuns: 3,
      homeRuns: 4,
      cursor: "20260829_020000",
      half: "END" as const,
      phase: "FINAL" as const,
    };
    testState.schedule.mockResolvedValue([completedGame]);
    testState.poll.mockResolvedValue({
      capture: {
        coreInput: finalInput,
        gameSnapshot: finalSnapshot,
        replayCandidates: [
          { eventKey: `${snapshot.gamePk}:final`, kind: "FINAL", occurredAt: "2026-08-29T02:00:00.000Z" },
        ],
      },
      waitMs: 10_000,
    });

    const { result } = renderHook(() => useLiveMetsGame());
    await flush();

    expect(testState.poll).toHaveBeenCalledOnce();
    expect(result.current.game).toBeUndefined();
    expect(result.current.snapshot).toBeUndefined();
    expect(result.current.celebration).toBeUndefined();
    expect(result.current.status).toBe("CONNECTING");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("BETWEEN_GAMES");
    expect(result.current.snapshot).toBeUndefined();
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
