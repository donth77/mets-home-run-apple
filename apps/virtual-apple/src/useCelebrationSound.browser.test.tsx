/** @vitest-environment happy-dom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CelebrationSoundCue,
  HOME_RUN_TRACK_URLS,
  useCelebrationSound,
  WIN_TRACK_URLS,
} from "./useCelebrationSound";

const rainAmbienceTestState = vi.hoisted(() => ({
  dispose: vi.fn(),
  prepare: vi.fn(async () => true),
  start: vi.fn(async () => true),
  stop: vi.fn(),
}));

vi.mock("./rainAmbience", () => ({
  createRainAmbience: () => ({
    ...rainAmbienceTestState,
    playing: false,
  }),
  rainAmbienceSupported: () => true,
}));

const audioInstances: FakeAudio[] = [];

class FakeAudio {
  private source = "";
  currentTime = 0;
  muted = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  playMutedStates: boolean[] = [];
  preload = "none";
  srcAssignments: string[] = [];
  volume = 1;
  load = vi.fn();
  pause = vi.fn(() => {
    this.paused = true;
  });
  play = vi.fn(async () => {
    this.playMutedStates.push(this.muted);
    this.paused = false;
  });
  removeAttribute = vi.fn();

  get src() {
    return this.source;
  }

  set src(value: string) {
    this.source = value;
    this.srcAssignments.push(value);
  }

  constructor(src = "") {
    this.source = src;
    if (src) this.srcAssignments.push(src);
    audioInstances.push(this);
  }
}

beforeEach(() => {
  audioInstances.length = 0;
  rainAmbienceTestState.dispose.mockClear();
  rainAmbienceTestState.prepare.mockClear();
  rainAmbienceTestState.start.mockClear();
  rainAmbienceTestState.stop.mockClear();
  vi.spyOn(Math, "random").mockReturnValue(0.75);
  vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("celebration recording playback", () => {
  it("starts rain ambience only while an explicit rain delay is active", async () => {
    const initialProps = { cue: undefined as CelebrationSoundCue | undefined, rainActive: false };
    const { result, rerender, unmount } = renderHook(
      ({ cue, rainActive }: typeof initialProps) => useCelebrationSound(cue, rainActive),
      { initialProps },
    );

    await act(async () => result.current.toggle());
    expect(rainAmbienceTestState.prepare).toHaveBeenCalledOnce();
    const stopCallsBeforeRain = rainAmbienceTestState.stop.mock.calls.length;

    rerender({ cue: undefined, rainActive: true });
    await waitFor(() => expect(result.current.rainPlaying).toBe(true));
    expect(rainAmbienceTestState.start).toHaveBeenCalledOnce();

    rerender({ cue: undefined, rainActive: false });
    await waitFor(() => expect(result.current.rainPlaying).toBe(false));
    expect(rainAmbienceTestState.stop.mock.calls.length).toBeGreaterThan(stopCallsBeforeRain);
    unmount();
    expect(rainAmbienceTestState.dispose).toHaveBeenCalledOnce();
  });

  it("plays one random home-run recording for the event and keeps that choice stable", async () => {
    const initialProps: { cue: CelebrationSoundCue | undefined } = { cue: undefined };
    const { result, rerender, unmount } = renderHook(
      ({ cue }: { cue: CelebrationSoundCue | undefined }) => useCelebrationSound(cue),
      { initialProps },
    );

    await act(async () => result.current.toggle());
    expect(audioInstances).toHaveLength(1);
    const [celebrationAudio] = audioInstances;
    if (!celebrationAudio) throw new Error("Expected the shared celebration audio player.");
    expect(celebrationAudio.play).toHaveBeenCalledOnce();
    expect(celebrationAudio.playMutedStates).toEqual([true]);
    expect(celebrationAudio.volume).toBe(0.82);
    expect(celebrationAudio.muted).toBe(false);
    expect([...HOME_RUN_TRACK_URLS, ...WIN_TRACK_URLS]).not.toContain(celebrationAudio.src);
    celebrationAudio.play.mockClear();
    celebrationAudio.playMutedStates.length = 0;
    celebrationAudio.srcAssignments.length = 0;

    rerender({ cue: { id: "777686:home-run", kind: "HOME_RUN" } });
    await waitFor(() => expect(celebrationAudio.play).toHaveBeenCalledOnce());
    expect(celebrationAudio.src).toBe(HOME_RUN_TRACK_URLS[3]);
    expect(celebrationAudio.srcAssignments).toEqual([HOME_RUN_TRACK_URLS[3]]);
    expect(celebrationAudio.playMutedStates).toEqual([false]);
    expect(audioInstances).toHaveLength(1);

    vi.mocked(Math.random).mockReturnValue(0);
    rerender({ cue: { id: "777686:home-run", kind: "HOME_RUN" } });
    expect(celebrationAudio.play).toHaveBeenCalledOnce();
    expect(celebrationAudio.src).toBe(HOME_RUN_TRACK_URLS[3]);

    const pauseCallsBeforeCueClears = celebrationAudio.pause.mock.calls.length;
    rerender({ cue: undefined });
    expect(celebrationAudio.pause).toHaveBeenCalledTimes(pauseCallsBeforeCueClears + 1);
    expect(celebrationAudio.currentTime).toBe(0);
    unmount();
  });

  it("keeps the randomly selected full song playing after the source cue clears", async () => {
    const initialProps: { cue: CelebrationSoundCue | undefined } = { cue: undefined };
    const { result, rerender, unmount } = renderHook(
      ({ cue }: { cue: CelebrationSoundCue | undefined }) => useCelebrationSound(cue),
      { initialProps },
    );

    await act(async () => result.current.toggle());
    expect(audioInstances).toHaveLength(1);
    const [celebrationAudio] = audioInstances;
    if (!celebrationAudio) throw new Error("Expected the shared celebration audio player.");
    expect(celebrationAudio.playMutedStates).toEqual([true]);
    celebrationAudio.play.mockClear();
    celebrationAudio.playMutedStates.length = 0;
    celebrationAudio.srcAssignments.length = 0;

    rerender({ cue: { id: "777686:final", kind: "METS_WIN" } });
    await waitFor(() => expect(result.current.winTrackPlaying).toBe(true));
    expect(celebrationAudio.src).toBe(WIN_TRACK_URLS[1]);
    expect(celebrationAudio.srcAssignments).toEqual([WIN_TRACK_URLS[1]]);
    expect(celebrationAudio.play).toHaveBeenCalledOnce();
    expect(celebrationAudio.playMutedStates).toEqual([false]);
    expect(audioInstances).toHaveLength(1);

    const pauseCallsBeforeCueClears = celebrationAudio.pause.mock.calls.length;
    rerender({ cue: undefined });
    expect(result.current.winTrackPlaying).toBe(true);
    expect(celebrationAudio.pause).toHaveBeenCalledTimes(pauseCallsBeforeCueClears);

    act(() => celebrationAudio.onended?.());
    expect(result.current.winTrackPlaying).toBe(false);
    unmount();
  });

  it("reuses the same player when a home-run track is replaced by a win track", async () => {
    const initialProps: { cue: CelebrationSoundCue | undefined } = { cue: undefined };
    const { result, rerender, unmount } = renderHook(
      ({ cue }: { cue: CelebrationSoundCue | undefined }) => useCelebrationSound(cue),
      { initialProps },
    );

    await act(async () => result.current.toggle());
    const [celebrationAudio] = audioInstances;
    if (!celebrationAudio) throw new Error("Expected the shared celebration audio player.");
    celebrationAudio.play.mockClear();
    celebrationAudio.playMutedStates.length = 0;

    vi.mocked(Math.random).mockReturnValue(0);
    rerender({ cue: { id: "demo:home-run", kind: "HOME_RUN" } });
    await waitFor(() => expect(celebrationAudio.src).toBe(HOME_RUN_TRACK_URLS[0]));

    const pauseCallsBeforeWin = celebrationAudio.pause.mock.calls.length;
    rerender({ cue: { id: "demo:mets-win", kind: "METS_WIN" } });
    await waitFor(() => expect(celebrationAudio.src).toBe(WIN_TRACK_URLS[0]));

    expect(audioInstances).toHaveLength(1);
    expect(celebrationAudio.pause.mock.calls.length).toBeGreaterThan(pauseCallsBeforeWin);
    expect(celebrationAudio.playMutedStates).toEqual([false, false]);
    unmount();
  });
});
