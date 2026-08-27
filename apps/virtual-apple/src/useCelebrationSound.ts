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

export function selectHomeRunTrackUrl(randomValue = Math.random()) {
  const boundedValue = Number.isFinite(randomValue) ? Math.min(0.999_999, Math.max(0, randomValue)) : 0;
  return HOME_RUN_TRACK_URLS[Math.floor(boundedValue * HOME_RUN_TRACK_URLS.length)];
}

export function selectWinTrackUrl(randomValue = Math.random()) {
  const boundedValue = Number.isFinite(randomValue) ? Math.min(0.999_999, Math.max(0, randomValue)) : 0;
  return WIN_TRACK_URLS[Math.floor(boundedValue * WIN_TRACK_URLS.length)];
}

type AudioTrack = { audio: HTMLAudioElement; url: string };

async function primeAudioTrack({ audio }: AudioTrack) {
  const volume = audio.volume;
  audio.volume = 0;
  try {
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
  }
}

export function useCelebrationSound(cue: CelebrationSoundCue | undefined, rainActive = false) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [rainPlaying, setRainPlaying] = useState(false);
  const [winTrackPlaying, setWinTrackPlaying] = useState(false);
  const homeRunAudioTracksRef = useRef<AudioTrack[]>([]);
  const activeHomeRunAudioRef = useRef<AudioTrack | undefined>(undefined);
  const activeHomeRunCueRef = useRef<string | undefined>(undefined);
  const winAudioTracksRef = useRef<AudioTrack[]>([]);
  const activeWinAudioRef = useRef<AudioTrack | undefined>(undefined);
  const activeWinCueRef = useRef<string | undefined>(undefined);
  const lastCueRef = useRef<string | undefined>(undefined);
  const rainAmbienceRef = useRef<RainAmbienceController | undefined>(undefined);
  const rainRequestRef = useRef(0);
  const supported = useMemo(() => typeof Audio !== "undefined" || rainAmbienceSupported(), []);

  const ensureRainAmbience = useCallback(() => {
    rainAmbienceRef.current ??= createRainAmbience();
    return rainAmbienceRef.current;
  }, []);

  const ensureHomeRunAudioTracks = useCallback(() => {
    if (homeRunAudioTracksRef.current.length > 0) return homeRunAudioTracksRef.current;
    if (typeof Audio === "undefined") return [];
    homeRunAudioTracksRef.current = HOME_RUN_TRACK_URLS.map((url) => {
      const audio = new Audio(url);
      const track = { audio, url };
      audio.preload = "auto";
      audio.volume = 0.82;
      audio.onended = () => {
        if (activeHomeRunAudioRef.current !== track) return;
        activeHomeRunAudioRef.current = undefined;
        activeHomeRunCueRef.current = undefined;
      };
      audio.onerror = () => {
        if (activeHomeRunAudioRef.current !== track) return;
        activeHomeRunAudioRef.current = undefined;
        activeHomeRunCueRef.current = undefined;
        setError("The selected home-run celebration could not be loaded.");
      };
      return track;
    });
    return homeRunAudioTracksRef.current;
  }, []);

  const ensureWinAudioTracks = useCallback(() => {
    if (winAudioTracksRef.current.length > 0) return winAudioTracksRef.current;
    if (typeof Audio === "undefined") return [];
    winAudioTracksRef.current = WIN_TRACK_URLS.map((url) => {
      const audio = new Audio(url);
      const track = { audio, url };
      audio.preload = "auto";
      audio.volume = 0.82;
      audio.onended = () => {
        if (activeWinAudioRef.current !== track) return;
        activeWinAudioRef.current = undefined;
        activeWinCueRef.current = undefined;
        lastCueRef.current = undefined;
        setWinTrackPlaying(false);
      };
      audio.onerror = () => {
        if (activeWinAudioRef.current !== track) return;
        activeWinAudioRef.current = undefined;
        activeWinCueRef.current = undefined;
        lastCueRef.current = undefined;
        setWinTrackPlaying(false);
        setError("The selected Mets-win song could not be loaded.");
      };
      return track;
    });
    return winAudioTracksRef.current;
  }, []);

  const stopWinTrack = useCallback(() => {
    activeWinCueRef.current = undefined;
    const track = activeWinAudioRef.current;
    activeWinAudioRef.current = undefined;
    if (track) {
      track.audio.pause();
      try {
        track.audio.currentTime = 0;
      } catch {
        // Metadata may not be ready yet, so there may be no seekable range.
      }
    }
    setWinTrackPlaying(false);
  }, []);

  const stopHomeRunTrack = useCallback(() => {
    activeHomeRunCueRef.current = undefined;
    const track = activeHomeRunAudioRef.current;
    activeHomeRunAudioRef.current = undefined;
    if (!track) return;
    track.audio.pause();
    try {
      track.audio.currentTime = 0;
    } catch {
      // Metadata may not be ready yet, so there may be no seekable range.
    }
  }, []);

  const stop = useCallback(() => {
    lastCueRef.current = undefined;
    stopHomeRunTrack();
    stopWinTrack();
  }, [stopHomeRunTrack, stopWinTrack]);

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

  const playHomeRunTrack = useCallback(
    async (cueKey: string) => {
      const tracks = ensureHomeRunAudioTracks();
      const selectedUrl = selectHomeRunTrackUrl();
      const track = tracks.find(({ url }) => url === selectedUrl);
      if (!track) {
        setError("The home-run celebration is not supported in this browser.");
        return;
      }

      activeHomeRunAudioRef.current?.audio.pause();
      activeHomeRunAudioRef.current = track;
      track.audio.pause();
      try {
        track.audio.currentTime = 0;
      } catch {
        // Playback will still begin at the start when the file first loads.
      }
      activeHomeRunCueRef.current = cueKey;

      try {
        await track.audio.play();
        if (activeHomeRunCueRef.current === cueKey) setError("");
      } catch {
        if (activeHomeRunCueRef.current !== cueKey) return;
        track.audio.pause();
        activeHomeRunAudioRef.current = undefined;
        activeHomeRunCueRef.current = undefined;
        setError("The browser blocked the home-run celebration. Turn sound on and try again.");
      }
    },
    [ensureHomeRunAudioTracks],
  );

  const playWinTrack = useCallback(
    async (cueKey: string) => {
      const tracks = ensureWinAudioTracks();
      const selectedUrl = selectWinTrackUrl();
      const track = tracks.find(({ url }) => url === selectedUrl);
      if (!track) {
        setError("The Mets-win song is not supported in this browser.");
        lastCueRef.current = undefined;
        return;
      }

      activeWinAudioRef.current?.audio.pause();
      activeWinAudioRef.current = track;
      track.audio.pause();
      try {
        track.audio.currentTime = 0;
      } catch {
        // Playback will still begin at the start when the file first loads.
      }
      activeWinCueRef.current = cueKey;
      setWinTrackPlaying(true);

      try {
        await track.audio.play();
        if (activeWinCueRef.current === cueKey) setError("");
      } catch {
        if (activeWinCueRef.current !== cueKey) return;
        track.audio.pause();
        activeWinAudioRef.current = undefined;
        activeWinCueRef.current = undefined;
        lastCueRef.current = undefined;
        setWinTrackPlaying(false);
        setError("The browser blocked the Mets-win song. Turn sound on and try again.");
      }
    },
    [ensureWinAudioTracks],
  );

  const enable = useCallback(async () => {
    if (enabled) return true;
    const htmlAudioSupported = typeof Audio !== "undefined";
    const rainPreparation = ensureRainAmbience().prepare();
    const htmlAudioPreparation = htmlAudioSupported
      ? Promise.all([...ensureHomeRunAudioTracks(), ...ensureWinAudioTracks()].map(primeAudioTrack))
      : Promise.resolve([]);
    const [rainReady] = await Promise.all([rainPreparation, htmlAudioPreparation]);
    if (!htmlAudioSupported && !rainReady) {
      setError("Scene audio is not supported in this browser.");
      return false;
    }

    try {
      if (htmlAudioSupported) {
        ensureHomeRunAudioTracks();
        ensureWinAudioTracks();
      }
      setError("");
      setEnabled(true);
      return true;
    } catch {
      setError("The browser blocked audio. Try turning sound on again.");
      return false;
    }
  }, [enabled, ensureHomeRunAudioTracks, ensureRainAmbience, ensureWinAudioTracks]);

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
      stopHomeRunTrack();
      if (!activeWinCueRef.current) lastCueRef.current = undefined;
      return;
    }
    if (!enabled) return;

    const cueKey = `${cueKind}:${cueId}`;
    if (lastCueRef.current === cueKey) return;
    lastCueRef.current = cueKey;

    if (cueKind === "METS_WIN") {
      stopHomeRunTrack();
      void playWinTrack(cueKey);
      return;
    }

    stopWinTrack();
    void playHomeRunTrack(cueKey);

    return () => {
      stopHomeRunTrack();
    };
  }, [cueId, cueKind, enabled, playHomeRunTrack, playWinTrack, stopHomeRunTrack, stopWinTrack]);

  useEffect(
    () => () => {
      rainRequestRef.current += 1;
      rainAmbienceRef.current?.dispose();
      rainAmbienceRef.current = undefined;
      activeHomeRunCueRef.current = undefined;
      activeHomeRunAudioRef.current = undefined;
      const homeRunTracks = homeRunAudioTracksRef.current;
      homeRunAudioTracksRef.current = [];
      homeRunTracks.forEach(({ audio }) => {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      });
      activeWinCueRef.current = undefined;
      activeWinAudioRef.current = undefined;
      const tracks = winAudioTracksRef.current;
      winAudioTracksRef.current = [];
      tracks.forEach(({ audio }) => {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      });
    },
    [],
  );

  return { enable, enabled, error, rainPlaying, supported, toggle, winTrackPlaying, stop };
}
