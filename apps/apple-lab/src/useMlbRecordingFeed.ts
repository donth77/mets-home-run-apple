import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameCore, type CoreResult } from "@apple/game-core-wasm";
import {
  easternDate,
  fetchMetsSchedule,
  MlbRecordingClient,
  type FeedPayloadKind,
  type MlbScheduleGame,
  type NormalizedFeedCapture,
} from "@apple/mlb-live-feed";

export type MlbRecorderStatus = "IDLE" | "DISCOVERING" | "READY" | "CONNECTING" | "POLLING" | "STOPPED" | "ERROR";

export interface MlbRecordingFeedState {
  date: string;
  games: readonly MlbScheduleGame[];
  selectedGame?: MlbScheduleGame;
  status: MlbRecorderStatus;
  capture?: NormalizedFeedCapture;
  decision?: CoreResult;
  payloadKind?: FeedPayloadKind;
  nextPollAt?: string;
  error?: string;
  setDate(value: string): void;
  selectGame(gamePk: number): void;
  discover(): Promise<void>;
  start(): Promise<void>;
  stop(): void;
}

export function useMlbRecordingFeed(): MlbRecordingFeedState {
  const [date, setDate] = useState(() => easternDate());
  const [games, setGames] = useState<readonly MlbScheduleGame[]>([]);
  const [selectedGamePk, setSelectedGamePk] = useState<number>();
  const [status, setStatus] = useState<MlbRecorderStatus>("IDLE");
  const [capture, setCapture] = useState<NormalizedFeedCapture>();
  const [decision, setDecision] = useState<CoreResult>();
  const [payloadKind, setPayloadKind] = useState<FeedPayloadKind>();
  const [nextPollAt, setNextPollAt] = useState<string>();
  const [error, setError] = useState<string>();
  const clientRef = useRef(new MlbRecordingClient());
  const coreRef = useRef<GameCore | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const timerRef = useRef<number | undefined>(undefined);
  const runTokenRef = useRef(0);

  const selectedGame = useMemo(() => games.find(({ gamePk }) => gamePk === selectedGamePk), [games, selectedGamePk]);

  const stop = useCallback(() => {
    runTokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = undefined;
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    setNextPollAt(undefined);
    setStatus((current) => (current === "IDLE" || current === "READY" ? current : "STOPPED"));
  }, []);

  useEffect(
    () => () => {
      runTokenRef.current += 1;
      abortRef.current?.abort();
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      coreRef.current?.dispose();
    },
    [],
  );

  const discover = useCallback(async () => {
    stop();
    setStatus("DISCOVERING");
    setError(undefined);
    setCapture(undefined);
    setDecision(undefined);
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const discovered = await fetchMetsSchedule(date, fetch, controller.signal);
      setGames(discovered);
      setSelectedGamePk((current) =>
        discovered.some(({ gamePk }) => gamePk === current) ? current : discovered[0]?.gamePk,
      );
      setStatus("READY");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Unable to load the Mets schedule.");
      setStatus("ERROR");
    }
  }, [date, stop]);

  const start = useCallback(async () => {
    if (!selectedGame) return;
    stop();
    const token = runTokenRef.current;
    setStatus("CONNECTING");
    setError(undefined);
    setCapture(undefined);
    setDecision(undefined);
    setPayloadKind(undefined);
    clientRef.current.reset();
    coreRef.current?.dispose();
    try {
      coreRef.current = await GameCore.create();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The C++ decision core could not load.");
      setStatus("ERROR");
      return;
    }

    const poll = async (): Promise<void> => {
      if (runTokenRef.current !== token) return;
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await clientRef.current.poll(selectedGame, controller.signal);
        if (runTokenRef.current !== token) return;
        setPayloadKind(result.payloadKind);
        if (result.capture) {
          setCapture(result.capture);
          const core = coreRef.current;
          if (!core) throw new Error("The C++ decision core was released unexpectedly.");
          setDecision(core.ingest(result.capture.input, performance.now()));
        }
        setStatus("POLLING");
        const next = new Date(Date.now() + result.waitMs).toISOString();
        setNextPollAt(next);
        timerRef.current = window.setTimeout(poll, result.waitMs);
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Live recording stopped unexpectedly.");
        setStatus("ERROR");
        setNextPollAt(undefined);
      }
    };
    await poll();
  }, [selectedGame, stop]);

  return {
    date,
    games,
    selectedGame,
    status,
    capture,
    decision,
    payloadKind,
    nextPollAt,
    error,
    setDate,
    selectGame: setSelectedGamePk,
    discover,
    start,
    stop,
  };
}
