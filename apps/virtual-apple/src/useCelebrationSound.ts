import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRainAmbience, type RainAmbienceController, rainAmbienceSupported } from "./rainAmbience";

export type CelebrationSoundKind = "HOME_RUN" | "METS_WIN";

export interface CelebrationSoundCue {
  id: string;
  kind: CelebrationSoundKind;
}

export const HOME_RUN_TRACK_URLS = [
  new URL("../public/audio/hr1.mp3", import.meta.url).href,
  new URL("../public/audio/hr2.mp3", import.meta.url).href,
  new URL("../public/audio/hr3.mp3", import.meta.url).href,
  new URL("../public/audio/hr4.mp3", import.meta.url).href,
] as const;
export const WIN_TRACK_URLS = [
  new URL("../public/audio/win.mp3", import.meta.url).href,
  new URL("../public/audio/win2.mp3", import.meta.url).href,
] as const;

export const HOME_RUN_AUDIO_DURATION_MS = 30_000;
export const HOME_RUN_AUDIO_FADE_MS = 3_000;
const CELEBRATION_VOLUME = 0.82;
const FADE_UPDATE_MS = 100;

// Unlock delayed playback with silence, never with one of the celebration recordings.
// Otherwise a browser can briefly expose the priming recording before the randomly
// selected event recording replaces it.
const AUDIO_UNLOCK_URL =
  "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

export function selectHomeRunTrackUrl(randomValue = Math.random()) {
  const boundedValue = Number.isFinite(randomValue) ? Math.min(0.999_999, Math.max(0, randomValue)) : 0;
  return HOME_RUN_TRACK_URLS[Math.floor(boundedValue * HOME_RUN_TRACK_URLS.length)];
}

export function selectWinTrackUrl(randomValue = Math.random()) {
  const boundedValue = Number.isFinite(randomValue) ? Math.min(0.999_999, Math.max(0, randomValue)) : 0;
  return WIN_TRACK_URLS[Math.floor(boundedValue * WIN_TRACK_URLS.length)];
}

async function primeCelebrationAudio(audio: HTMLAudioElement) {
  const volume = audio.volume;
  const muted = audio.muted;
  audio.muted = true;
  audio.volume = 0;
  try {
    audio.src = AUDIO_UNLOCK_URL;
    audio.load();
    await audio.play();
    return true;
  } catch {
    return false;
  } finally {
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // Metadata may not be ready yet, so there may be no seekable range.
    }
    audio.volume = volume;
    audio.muted = muted;
  }
}

export function useCelebrationSound(cue: CelebrationSoundCue | undefined, rainActive = false) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [rainPlaying, setRainPlaying] = useState(false);
  const [winTrackPlaying, setWinTrackPlaying] = useState(false);
  const celebrationAudioRef = useRef<HTMLAudioElement | undefined>(undefined);
  const audioPreparedRef = useRef(false);
  const audioPreparationRef = useRef<Promise<boolean> | undefined>(undefined);
  const activeCueRef = useRef<string | undefined>(undefined);
  const activeKindRef = useRef<CelebrationSoundKind | undefined>(undefined);
  const playbackRequestRef = useRef(0);
  const lastCueRef = useRef<string | undefined>(undefined);
  const homeRunFadeStartTimerRef = useRef<number | undefined>(undefined);
  const homeRunFadeTimerRef = useRef<number | undefined>(undefined);
  const rainAmbienceRef = useRef<RainAmbienceController | undefined>(undefined);
  const rainRequestRef = useRef(0);
  const supported = useMemo(() => typeof Audio !== "undefined" || rainAmbienceSupported(), []);

  const ensureRainAmbience = useCallback(() => {
    rainAmbienceRef.current ??= createRainAmbience();
    return rainAmbienceRef.current;
  }, []);

  const clearHomeRunFade = useCallback(() => {
    if (homeRunFadeStartTimerRef.current !== undefined) {
      window.clearTimeout(homeRunFadeStartTimerRef.current);
      homeRunFadeStartTimerRef.current = undefined;
    }
    if (homeRunFadeTimerRef.current !== undefined) {
      window.clearInterval(homeRunFadeTimerRef.current);
      homeRunFadeTimerRef.current = undefined;
    }
  }, []);

  const ensureCelebrationAudio = useCallback(() => {
    if (celebrationAudioRef.current) return celebrationAudioRef.current;
    if (typeof Audio === "undefined") return undefined;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.volume = CELEBRATION_VOLUME;
    audio.onended = () => {
      clearHomeRunFade();
      const finishedKind = activeKindRef.current;
      if (!activeCueRef.current) return;
      activeCueRef.current = undefined;
      activeKindRef.current = undefined;
      if (finishedKind === "METS_WIN") {
        lastCueRef.current = undefined;
        setWinTrackPlaying(false);
      }
    };
    audio.onerror = () => {
      clearHomeRunFade();
      const failedKind = activeKindRef.current;
      if (!activeCueRef.current || !failedKind) return;
      activeCueRef.current = undefined;
      activeKindRef.current = undefined;
      if (failedKind === "METS_WIN") {
        lastCueRef.current = undefined;
        setWinTrackPlaying(false);
      }
      setError(
        failedKind === "METS_WIN"
          ? "The selected Mets-win song could not be loaded."
          : "The selected home-run celebration could not be loaded.",
      );
    };
    celebrationAudioRef.current = audio;
    return audio;
  }, [clearHomeRunFade]);

  const stopCelebrationTrack = useCallback(() => {
    clearHomeRunFade();
    playbackRequestRef.current += 1;
    activeCueRef.current = undefined;
    activeKindRef.current = undefined;
    const audio = celebrationAudioRef.current;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // Metadata may not be ready yet, so there may be no seekable range.
      }
      audio.volume = CELEBRATION_VOLUME;
    }
    setWinTrackPlaying(false);
  }, [clearHomeRunFade]);

  const scheduleHomeRunFade = useCallback(
    (cueKey: string, audio: HTMLAudioElement) => {
      clearHomeRunFade();
      homeRunFadeStartTimerRef.current = window.setTimeout(() => {
        homeRunFadeStartTimerRef.current = undefined;
        const fadeStartedAt = performance.now();
        homeRunFadeTimerRef.current = window.setInterval(() => {
          if (activeCueRef.current !== cueKey || activeKindRef.current !== "HOME_RUN") {
            clearHomeRunFade();
            return;
          }
          const progress = Math.min(1, Math.max(0, performance.now() - fadeStartedAt) / HOME_RUN_AUDIO_FADE_MS);
          audio.volume = CELEBRATION_VOLUME * (1 - progress);
          if (progress >= 1) stopCelebrationTrack();
        }, FADE_UPDATE_MS);
      }, HOME_RUN_AUDIO_DURATION_MS - HOME_RUN_AUDIO_FADE_MS);
    },
    [clearHomeRunFade, stopCelebrationTrack],
  );

  const stop = useCallback(() => {
    lastCueRef.current = undefined;
    stopCelebrationTrack();
  }, [stopCelebrationTrack]);

  const stopRain = useCallback(() => {
    rainRequestRef.current += 1;
    rainAmbienceRef.current?.stop();
    setRainPlaying(false);
  }, []);

  const playRain = useCallback(async () => {
    const request = rainRequestRef.current + 1;
    rainRequestRef.current = request;
    const ambience = ensureRainAmbience();
    const started = await ambience.start();
    if (rainRequestRef.current !== request) {
      if (started) ambience.stop();
      return;
    }
    setRainPlaying(started);
    setError(started ? "" : "Rain ambience is unavailable in this browser.");
  }, [ensureRainAmbience]);

  const playCelebrationTrack = useCallback(
    async (cueKey: string, kind: CelebrationSoundKind) => {
      const audio = ensureCelebrationAudio();
      if (!audio) {
        setError(
          kind === "METS_WIN"
            ? "The Mets-win song is not supported in this browser."
            : "The home-run celebration is not supported in this browser.",
        );
        if (kind === "METS_WIN") lastCueRef.current = undefined;
        return;
      }

      const selectedUrl = kind === "METS_WIN" ? selectWinTrackUrl() : selectHomeRunTrackUrl();
      stopCelebrationTrack();
      const playbackRequest = playbackRequestRef.current;
      activeCueRef.current = cueKey;
      activeKindRef.current = kind;
      setWinTrackPlaying(kind === "METS_WIN");
      audio.volume = CELEBRATION_VOLUME;
      audio.src = selectedUrl;
      audio.load();

      try {
        await audio.play();
        if (playbackRequestRef.current === playbackRequest && activeCueRef.current === cueKey) {
          if (kind === "HOME_RUN") scheduleHomeRunFade(cueKey, audio);
          setError("");
        }
      } catch {
        if (playbackRequestRef.current !== playbackRequest || activeCueRef.current !== cueKey) return;
        audio.pause();
        activeCueRef.current = undefined;
        activeKindRef.current = undefined;
        if (kind === "METS_WIN") lastCueRef.current = undefined;
        setWinTrackPlaying(false);
        setError(
          kind === "METS_WIN"
            ? "The browser blocked the Mets-win song. Turn sound on and try again."
            : "The browser blocked the home-run celebration. Turn sound on and try again.",
        );
      }
    },
    [ensureCelebrationAudio, scheduleHomeRunFade, stopCelebrationTrack],
  );

  const enable = useCallback(async () => {
    if (enabled) return true;
    const htmlAudioSupported = typeof Audio !== "undefined";
    const rainPreparation = ensureRainAmbience().prepare();
    const celebrationAudio = htmlAudioSupported ? ensureCelebrationAudio() : undefined;
    let htmlAudioPreparation = Promise.resolve(false);
    if (celebrationAudio) {
      if (audioPreparedRef.current) {
        htmlAudioPreparation = Promise.resolve(true);
      } else if (audioPreparationRef.current) {
        htmlAudioPreparation = audioPreparationRef.current;
      } else {
        const preparation = primeCelebrationAudio(celebrationAudio).then((prepared) => {
          audioPreparedRef.current = prepared;
          return prepared;
        });
        audioPreparationRef.current = preparation;
        void preparation.finally(() => {
          if (audioPreparationRef.current === preparation) audioPreparationRef.current = undefined;
        });
        htmlAudioPreparation = preparation;
      }
    }
    const [rainReady] = await Promise.all([rainPreparation, htmlAudioPreparation]);
    if (!htmlAudioSupported && !rainReady) {
      setError("Scene audio is not supported in this browser.");
      return false;
    }

    try {
      if (htmlAudioSupported) ensureCelebrationAudio();
      setError("");
      setEnabled(true);
      return true;
    } catch {
      setError("The browser blocked audio. Try turning sound on again.");
      return false;
    }
  }, [enabled, ensureCelebrationAudio, ensureRainAmbience]);

  const toggle = useCallback(async () => {
    if (!enabled) {
      await enable();
      return;
    }

    setEnabled(false);
    stop();
    stopRain();
  }, [enable, enabled, stop, stopRain]);

  const cueId = cue?.id;
  const cueKind = cue?.kind;

  useEffect(() => {
    if (!enabled || !rainActive) {
      stopRain();
      return;
    }
    void playRain();
    return stopRain;
  }, [enabled, playRain, rainActive, stopRain]);

  useEffect(() => {
    if (!cueId || !cueKind) {
      if (activeKindRef.current === "HOME_RUN") stopCelebrationTrack();
      if (activeKindRef.current !== "METS_WIN") lastCueRef.current = undefined;
      return;
    }
    if (!enabled) return;

    const cueKey = `${cueKind}:${cueId}`;
    if (lastCueRef.current === cueKey) return;
    lastCueRef.current = cueKey;

    void playCelebrationTrack(cueKey, cueKind);

    if (cueKind === "HOME_RUN") {
      return () => {
        if (activeCueRef.current === cueKey) stopCelebrationTrack();
      };
    }
  }, [cueId, cueKind, enabled, playCelebrationTrack, stopCelebrationTrack]);

  useEffect(
    () => () => {
      rainRequestRef.current += 1;
      rainAmbienceRef.current?.dispose();
      rainAmbienceRef.current = undefined;
      activeCueRef.current = undefined;
      activeKindRef.current = undefined;
      playbackRequestRef.current += 1;
      audioPreparedRef.current = false;
      audioPreparationRef.current = undefined;
      clearHomeRunFade();
      const audio = celebrationAudioRef.current;
      celebrationAudioRef.current = undefined;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    },
    [clearHomeRunFade],
  );

  return { enable, enabled, error, rainPlaying, supported, toggle, winTrackPlaying, stop };
}
