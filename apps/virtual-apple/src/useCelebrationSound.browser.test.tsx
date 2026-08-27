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
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  preload = "none";
  src: string;
  volume = 1;
  load = vi.fn();
  pause = vi.fn(() => {
    this.paused = true;
  });
  play = vi.fn(async () => {
    this.paused = false;
  });
  removeAttribute = vi.fn();

  constructor(src: string) {
    this.src = src;
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
    expect(audioInstances.map(({ src }) => src)).toEqual([...HOME_RUN_TRACK_URLS, ...WIN_TRACK_URLS]);
    expect(audioInstances.every(({ play }) => play.mock.calls.length === 1)).toBe(true);
    audioInstances.forEach(({ play }) => {
      play.mockClear();
    });
    const homeRunAudio = audioInstances.find(({ src }) => src === HOME_RUN_TRACK_URLS[3]);
    expect(homeRunAudio).toBeDefined();
    if (!homeRunAudio) throw new Error("Expected the fourth home-run audio track.");
    expect(homeRunAudio.volume).toBe(0.82);

    rerender({ cue: { id: "777686:home-run", kind: "HOME_RUN" } });
    await waitFor(() => expect(homeRunAudio.play).toHaveBeenCalledOnce());
    expect(
      audioInstances
        .filter(({ src }) => HOME_RUN_TRACK_URLS.includes(src as (typeof HOME_RUN_TRACK_URLS)[number]))
        .filter(({ play }) => play.mock.calls.length > 0),
    ).toEqual([homeRunAudio]);

    vi.mocked(Math.random).mockReturnValue(0);
    rerender({ cue: { id: "777686:home-run", kind: "HOME_RUN" } });
    expect(homeRunAudio.play).toHaveBeenCalledOnce();
    const firstHomeRunAudio = audioInstances.find(({ src }) => src === HOME_RUN_TRACK_URLS[0]);
    expect(firstHomeRunAudio).toBeDefined();
    if (!firstHomeRunAudio) throw new Error("Expected the first home-run audio track.");
    expect(firstHomeRunAudio.play).not.toHaveBeenCalled();

    const pauseCallsBeforeCueClears = homeRunAudio.pause.mock.calls.length;
    rerender({ cue: undefined });
    expect(homeRunAudio.pause).toHaveBeenCalledTimes(pauseCallsBeforeCueClears + 1);
    expect(homeRunAudio.currentTime).toBe(0);
    unmount();
  });

  it("keeps the randomly selected full song playing after the source cue clears", async () => {
    const initialProps: { cue: CelebrationSoundCue | undefined } = { cue: undefined };
    const { result, rerender, unmount } = renderHook(
      ({ cue }: { cue: CelebrationSoundCue | undefined }) => useCelebrationSound(cue),
      { initialProps },
    );

    await act(async () => result.current.toggle());
    expect(audioInstances.map(({ src }) => src)).toEqual([...HOME_RUN_TRACK_URLS, ...WIN_TRACK_URLS]);
    expect(audioInstances.every(({ play }) => play.mock.calls.length === 1)).toBe(true);
    audioInstances.forEach(({ play }) => {
      play.mockClear();
    });
    const firstWinAudio = audioInstances.find(({ src }) => src === WIN_TRACK_URLS[0]);
    const secondWinAudio = audioInstances.find(({ src }) => src === WIN_TRACK_URLS[1]);
    expect(firstWinAudio).toBeDefined();
    expect(secondWinAudio).toBeDefined();
    if (!firstWinAudio || !secondWinAudio) throw new Error("Expected both Mets-win audio tracks.");

    rerender({ cue: { id: "777686:final", kind: "METS_WIN" } });
    await waitFor(() => expect(result.current.winTrackPlaying).toBe(true));
    expect(firstWinAudio.play).not.toHaveBeenCalled();
    expect(secondWinAudio.play).toHaveBeenCalledOnce();

    const pauseCallsBeforeCueClears = secondWinAudio.pause.mock.calls.length;
    rerender({ cue: undefined });
    expect(result.current.winTrackPlaying).toBe(true);
    expect(secondWinAudio.pause).toHaveBeenCalledTimes(pauseCallsBeforeCueClears);

    act(() => secondWinAudio.onended?.());
    expect(result.current.winTrackPlaying).toBe(false);
    unmount();
  });
});
