import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameCore, type CoreResult } from "@apple/game-core-wasm";
import {
  dateFromMlbTimecode,
  easternDate,
  fetchMetsSchedule,
  fetchMlbHistoricalGameIndex,
  MlbRecordingClient,
  type FeedPayloadKind,
  type MlbHistoricalBookmark,
  type MlbHistoricalGameIndex,
  type MlbScheduleGame,
  type NormalizedFeedCapture,
} from "@apple/mlb-live-feed";

export type HistoricalReplayStatus =
  | "IDLE"
  | "DISCOVERING"
  | "READY"
  | "INDEXING"
  | "LOADING"
  | "PLAYING"
  | "COMPLETE"
  | "ERROR";

export interface HistoricalReplayReceipt {
  id: string;
  updateIndex: number;
  timecode: string;
  payloadKind: FeedPayloadKind;
  capture: NormalizedFeedCapture;
  decision: CoreResult;
}

export interface MlbHistoricalReplayState {
  date: string;
  games: readonly MlbScheduleGame[];
  selectedGame?: MlbScheduleGame;
  archive?: MlbHistoricalGameIndex;
  status: HistoricalReplayStatus;
  capture?: NormalizedFeedCapture;
  decision?: CoreResult;
  payloadKind?: FeedPayloadKind;
  currentIndex: number;
  currentTimecode?: string;
  playing: boolean;
  speed: number;
  stagedBookmarkId?: string;
  receipts: readonly HistoricalReplayReceipt[];
  error?: string;
  setDate(value: string): void;
  selectGame(gamePk: number): void;
  setSpeed(value: number): void;
  discover(): Promise<void>;
  loadArchive(): Promise<void>;
  stageAt(index: number): Promise<boolean>;
  step(direction: -1 | 1): Promise<void>;
  togglePlaying(): Promise<void>;
  stageBookmark(bookmark: MlbHistoricalBookmark): Promise<void>;
  runBookmark(bookmark: MlbHistoricalBookmark): Promise<void>;
  stop(): void;
}

const replaySpeeds = new Set([0.5, 1, 2]);

function previousEasternDate() {
  return easternDate(new Date(Date.now() - 24 * 60 * 60 * 1_000));
}

function isAbortError(reason: unknown) {
  return reason instanceof DOMException && reason.name === "AbortError";
}

export function useMlbHistoricalReplay(): MlbHistoricalReplayState {
  const [date, setDate] = useState(previousEasternDate);
  const [games, setGames] = useState<readonly MlbScheduleGame[]>([]);
  const [selectedGamePk, setSelectedGamePk] = useState<number>();
  const [archive, setArchive] = useState<MlbHistoricalGameIndex>();
  const [status, setStatus] = useState<HistoricalReplayStatus>("IDLE");
  const [capture, setCapture] = useState<NormalizedFeedCapture>();
  const [decision, setDecision] = useState<CoreResult>();
  const [payloadKind, setPayloadKind] = useState<FeedPayloadKind>();
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [stagedBookmarkId, setStagedBookmarkId] = useState<string>();
  const [receipts, setReceipts] = useState<readonly HistoricalReplayReceipt[]>([]);
  const [error, setError] = useState<string>();
  const clientRef = useRef(new MlbRecordingClient());
  const coreRef = useRef<GameCore | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const operationTokenRef = useRef(0);
  const clockRef = useRef(0);
  const currentIndexRef = useRef(-1);

  const selectedGame = useMemo(() => games.find(({ gamePk }) => gamePk === selectedGamePk), [games, selectedGamePk]);
  const currentTimecode = currentIndex >= 0 ? archive?.timestamps[currentIndex] : undefined;

  const cancelOperation = useCallback(() => {
    operationTokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = undefined;
  }, []);

  const releaseRuntime = useCallback(() => {
    clientRef.current.reset();
    coreRef.current?.dispose();
    coreRef.current = undefined;
    clockRef.current = 0;
    currentIndexRef.current = -1;
  }, []);

  const stop = useCallback(() => {
    cancelOperation();
    setPlaying(false);
    setStatus((current) => (current === "PLAYING" || current === "LOADING" ? "READY" : current));
  }, [cancelOperation]);

  useEffect(
    () => () => {
      cancelOperation();
      coreRef.current?.dispose();
    },
    [cancelOperation],
  );

  const clearArchive = useCallback(() => {
    stop();
    releaseRuntime();
    setArchive(undefined);
    setCapture(undefined);
    setDecision(undefined);
    setPayloadKind(undefined);
    setCurrentIndex(-1);
    setReceipts([]);
    setStagedBookmarkId(undefined);
  }, [releaseRuntime, stop]);

  const discover = useCallback(async () => {
    clearArchive();
    setStatus("DISCOVERING");
    setError(undefined);
    const token = operationTokenRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const discovered = await fetchMetsSchedule(date, fetch, controller.signal);
      if (token !== operationTokenRef.current) return;
      setGames(discovered);
      setSelectedGamePk((current) =>
        discovered.some(({ gamePk }) => gamePk === current) ? current : discovered[0]?.gamePk,
      );
      setStatus("READY");
    } catch (reason) {
      if (isAbortError(reason) || token !== operationTokenRef.current) return;
      setError(reason instanceof Error ? reason.message : "Unable to load the Mets schedule.");
      setStatus("ERROR");
    }
  }, [clearArchive, date]);

  const loadArchive = useCallback(async () => {
    if (!selectedGame) return;
    clearArchive();
    setStatus("INDEXING");
    setError(undefined);
    const token = operationTokenRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const nextArchive = await fetchMlbHistoricalGameIndex(selectedGame.gamePk, fetch, controller.signal);
      if (token !== operationTokenRef.current) return;
      setArchive(nextArchive);
      setStatus("READY");
    } catch (reason) {
      if (isAbortError(reason) || token !== operationTokenRef.current) return;
      setError(reason instanceof Error ? reason.message : "Unable to index the archived game.");
      setStatus("ERROR");
    }
  }, [clearArchive, selectedGame]);

  const stageAt = useCallback(
    async (requestedIndex: number) => {
      if (!selectedGame || !archive) return false;
      const targetIndex = Math.min(Math.max(0, requestedIndex), archive.timestamps.length - 1);
      cancelOperation();
      releaseRuntime();
      setPlaying(false);
      setStatus("LOADING");
      setError(undefined);
      setStagedBookmarkId(undefined);
      const token = operationTokenRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const core = await GameCore.create();
        if (token !== operationTokenRef.current) {
          core.dispose();
          return false;
        }
        coreRef.current = core;
        const result = await clientRef.current.loadTimecode(
          selectedGame,
          archive.timestamps[targetIndex],
          controller.signal,
        );
        if (token !== operationTokenRef.current || !result.capture) return false;
        const nextDecision = core.ingest(result.capture.coreInput, 0);
        currentIndexRef.current = targetIndex;
        setCurrentIndex(targetIndex);
        setCapture(result.capture);
        setDecision(nextDecision);
        setPayloadKind(result.payloadKind);
        setReceipts([
          {
            id: `${targetIndex}:${result.cursor}`,
            updateIndex: targetIndex,
            timecode: archive.timestamps[targetIndex],
            payloadKind: result.payloadKind,
            capture: result.capture,
            decision: nextDecision,
          },
        ]);
        setStatus(targetIndex === archive.timestamps.length - 1 ? "COMPLETE" : "READY");
        return true;
      } catch (reason) {
        if (isAbortError(reason) || token !== operationTokenRef.current) return false;
        setError(reason instanceof Error ? reason.message : "Unable to stage the archived update.");
        setStatus("ERROR");
        return false;
      }
    },
    [archive, cancelOperation, releaseRuntime, selectedGame],
  );

  const advanceTo = useCallback(
    async (requestedIndex: number, continuePlaying = false) => {
      if (!selectedGame || !archive) return false;
      const targetIndex = Math.min(Math.max(0, requestedIndex), archive.timestamps.length - 1);
      if (!coreRef.current || targetIndex <= currentIndexRef.current) {
        const staged = await stageAt(targetIndex);
        if (staged && continuePlaying && targetIndex < archive.timestamps.length - 1) {
          setPlaying(true);
          setStatus("PLAYING");
        }
        return staged;
      }

      cancelOperation();
      setStatus("LOADING");
      setError(undefined);
      const token = operationTokenRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const previousIndex = currentIndexRef.current;
        const result = await clientRef.current.loadTimecode(
          selectedGame,
          archive.timestamps[targetIndex],
          controller.signal,
        );
        if (token !== operationTokenRef.current) return false;
        const core = coreRef.current;
        if (!core) throw new Error("The C++ replay core was released unexpectedly.");
        const elapsed = Math.max(
          1,
          dateFromMlbTimecode(archive.timestamps[targetIndex]).getTime() -
            dateFromMlbTimecode(archive.timestamps[Math.max(0, previousIndex)]).getTime(),
        );
        clockRef.current += elapsed;
        if (result.capture) {
          const acceptedCapture = result.capture;
          const acceptedDecision = core.ingest(acceptedCapture.coreInput, clockRef.current);
          setCapture(acceptedCapture);
          setDecision(acceptedDecision);
          setReceipts((current) =>
            [
              {
                id: `${targetIndex}:${result.cursor}`,
                updateIndex: targetIndex,
                timecode: archive.timestamps[targetIndex],
                payloadKind: result.payloadKind,
                capture: acceptedCapture,
                decision: acceptedDecision,
              },
              ...current,
            ].slice(0, 200),
          );
        }
        currentIndexRef.current = targetIndex;
        setCurrentIndex(targetIndex);
        setPayloadKind(result.payloadKind);
        const complete = targetIndex === archive.timestamps.length - 1;
        setPlaying(continuePlaying && !complete);
        setStatus(complete ? "COMPLETE" : continuePlaying ? "PLAYING" : "READY");
        return true;
      } catch (reason) {
        if (isAbortError(reason) || token !== operationTokenRef.current) return false;
        setPlaying(false);
        setError(reason instanceof Error ? reason.message : "Historical replay stopped unexpectedly.");
        setStatus("ERROR");
        return false;
      }
    },
    [archive, cancelOperation, selectedGame, stageAt],
  );

  const step = useCallback(
    async (direction: -1 | 1) => {
      if (!archive) return;
      setPlaying(false);
      const base = currentIndexRef.current < 0 ? 0 : currentIndexRef.current;
      await advanceTo(base + direction);
    },
    [advanceTo, archive],
  );

  const togglePlaying = useCallback(async () => {
    if (!archive) return;
    if (playing) {
      setPlaying(false);
      setStatus((current) => (current === "PLAYING" ? "READY" : current));
      return;
    }
    if (currentIndexRef.current < 0 || currentIndexRef.current >= archive.timestamps.length - 1) {
      const staged = await stageAt(0);
      if (!staged) return;
    }
    setPlaying(true);
    setStatus("PLAYING");
  }, [archive, playing, stageAt]);

  useEffect(() => {
    if (!playing || !archive || status !== "PLAYING") return;
    if (currentIndex >= archive.timestamps.length - 1) {
      setPlaying(false);
      setStatus("COMPLETE");
      return;
    }
    const timer = window.setTimeout(() => void advanceTo(currentIndex + 1, true), Math.round(1_000 / speed));
    return () => window.clearTimeout(timer);
  }, [advanceTo, archive, currentIndex, playing, speed, status]);

  const stageBookmark = useCallback(
    async (bookmark: MlbHistoricalBookmark) => {
      const staged = await stageAt(bookmark.beforeIndex);
      if (staged) setStagedBookmarkId(bookmark.id);
    },
    [stageAt],
  );

  const runBookmark = useCallback(
    async (bookmark: MlbHistoricalBookmark) => {
      if (currentIndexRef.current !== bookmark.beforeIndex || stagedBookmarkId !== bookmark.id) {
        const staged = await stageAt(bookmark.beforeIndex);
        if (!staged) return;
      }
      setStagedBookmarkId(bookmark.id);
      await advanceTo(bookmark.targetIndex);
    },
    [advanceTo, stageAt, stagedBookmarkId],
  );

  const setSpeed = useCallback((value: number) => {
    if (replaySpeeds.has(value)) setSpeedState(value);
  }, []);

  return {
    date,
    games,
    selectedGame,
    archive,
    status,
    capture,
    decision,
    payloadKind,
    currentIndex,
    currentTimecode,
    playing,
    speed,
    stagedBookmarkId,
    receipts,
    error,
    setDate,
    selectGame: (gamePk) => {
      clearArchive();
      setSelectedGamePk(gamePk);
      setStatus("READY");
    },
    setSpeed,
    discover,
    loadArchive,
    stageAt,
    step,
    togglePlaying,
    stageBookmark,
    runBookmark,
    stop,
  };
}
