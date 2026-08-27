import type { CoreResult } from "@apple/game-core-wasm";
import { easternDate, fetchMetsSchedule, MlbRecordingClient, type MlbScheduleGame } from "@apple/mlb-live-feed";
import type { GameSnapshot } from "@apple/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { type LiveCelebration, type LiveCorePresentation, LiveGameCoreController } from "./liveGameCoreController";

export type { LiveCelebration } from "./liveGameCoreController";

const SCHEDULE_RECHECK_NEAR_GAME_MS = 60_000;
const SCHEDULE_RECHECK_IDLE_MS = 15 * 60_000;
const FEED_RETRY_MS = 60_000;
export const FINAL_SCOREBOARD_HOLD_MS = 60_000;

export type LiveMetsGameStatus = "CHECKING" | "BETWEEN_GAMES" | "CONNECTING" | "POLLING" | "FINAL" | "ERROR";

export interface LiveMetsGameState {
  status: LiveMetsGameStatus;
  game?: MlbScheduleGame;
  snapshot?: GameSnapshot;
  decision?: CoreResult;
  celebration?: LiveCelebration;
  targetPositionMm: number;
  checkedAt?: string;
  error?: string;
  reportPosition(positionMm: number): void;
}

export function selectTrackableMetsGame(games: readonly MlbScheduleGame[]) {
  return games.find((game) => {
    const abstractState = game.abstractState.toLowerCase();
    const detailedState = game.detailedState.toLowerCase();
    return (
      abstractState === "live" ||
      ["in progress", "warmup", "delayed", "suspended", "review", "challenge"].some((state) =>
        detailedState.includes(state),
      )
    );
  });
}

export function liveFeedContinuation(phase: GameSnapshot["phase"], waitMs: number) {
  return phase === "FINAL"
    ? { kind: "DISCOVER" as const, delayMs: FINAL_SCOREBOARD_HOLD_MS }
    : { kind: "POLL" as const, delayMs: waitMs };
}

function scheduleRecheckDelay(games: readonly MlbScheduleGame[]) {
  const nextStart = games
    .map((game) => Date.parse(game.gameDate))
    .filter((value) => Number.isFinite(value) && value > Date.now())
    .sort((left, right) => left - right)[0];
  if (!nextStart) return SCHEDULE_RECHECK_IDLE_MS;
  return nextStart - Date.now() <= 30 * 60_000
    ? SCHEDULE_RECHECK_NEAR_GAME_MS
    : Math.min(SCHEDULE_RECHECK_IDLE_MS, Math.max(SCHEDULE_RECHECK_NEAR_GAME_MS, nextStart - Date.now() - 30 * 60_000));
}

function isAbortError(reason: unknown) {
  return typeof reason === "object" && reason !== null && "name" in reason && reason.name === "AbortError";
}

export function useLiveMetsGame(enabled = true): LiveMetsGameState {
  const [status, setStatus] = useState<LiveMetsGameStatus>("CHECKING");
  const [game, setGame] = useState<MlbScheduleGame>();
  const [snapshot, setSnapshot] = useState<GameSnapshot>();
  const [decision, setDecision] = useState<CoreResult>();
  const [celebration, setCelebration] = useState<LiveCelebration>();
  const [targetPositionMm, setTargetPositionMm] = useState(0);
  const [checkedAt, setCheckedAt] = useState<string>();
  const [error, setError] = useState<string>();
  const coreRef = useRef<LiveGameCoreController | undefined>(undefined);

  const acceptCorePresentation = useCallback((presentation: LiveCorePresentation) => {
    setDecision(presentation.decision);
    setCelebration(presentation.celebration);
    setTargetPositionMm(presentation.targetPositionMm);
  }, []);

  const reportPosition = useCallback(
    (positionMm: number) => {
      const presentation = coreRef.current?.reportPosition(positionMm, performance.now());
      if (presentation) acceptCorePresentation(presentation);
    },
    [acceptCorePresentation],
  );

  useEffect(() => {
    let disposed = false;
    let runToken = 0;
    let requestController: AbortController | undefined;
    let scheduleTimer: number | undefined;
    let feedTimer: number | undefined;
    let tickTimer: number | undefined;

    const stopTracking = () => {
      runToken += 1;
      requestController?.abort();
      requestController = undefined;
      if (feedTimer !== undefined) window.clearTimeout(feedTimer);
      if (tickTimer !== undefined) window.clearInterval(tickTimer);
      feedTimer = undefined;
      tickTimer = undefined;
      coreRef.current?.dispose();
      coreRef.current = undefined;
      setTargetPositionMm(0);
      setDecision(undefined);
      setCelebration(undefined);
    };

    const queueDiscovery = (delayMs: number) => {
      if (scheduleTimer !== undefined) window.clearTimeout(scheduleTimer);
      scheduleTimer = window.setTimeout(() => void discover(), delayMs);
    };

    const startTracking = async (selectedGame: MlbScheduleGame) => {
      stopTracking();
      const token = runToken;
      setGame(selectedGame);
      setStatus("CONNECTING");
      setError(undefined);
      const client = new MlbRecordingClient();
      try {
        const core = await LiveGameCoreController.create();
        if (disposed || token !== runToken) {
          core.dispose();
          return;
        }
        coreRef.current = core;
        tickTimer = window.setInterval(() => {
          if (!coreRef.current) return;
          try {
            acceptCorePresentation(coreRef.current.tick(performance.now()));
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Live game timing stopped unexpectedly.");
            setStatus("ERROR");
          }
        }, 100);

        const poll = async (): Promise<void> => {
          if (disposed || token !== runToken) return;
          requestController = new AbortController();
          try {
            const result = await client.poll(selectedGame, requestController.signal);
            if (disposed || token !== runToken) return;
            if (result.capture) {
              setSnapshot(result.capture.gameSnapshot);
              acceptCorePresentation(core.ingest(result.capture.coreInput, performance.now()));
              const continuation = liveFeedContinuation(result.capture.gameSnapshot.phase, result.waitMs);
              if (continuation.kind === "DISCOVER") {
                setStatus("FINAL");
                queueDiscovery(continuation.delayMs);
                return;
              }
              setStatus("POLLING");
              feedTimer = window.setTimeout(poll, continuation.delayMs);
              return;
            } else {
              setStatus((current) => (current === "CONNECTING" ? "POLLING" : current));
            }
            feedTimer = window.setTimeout(poll, result.waitMs);
          } catch (reason) {
            if (isAbortError(reason) || disposed || token !== runToken) return;
            setError(reason instanceof Error ? reason.message : "Live Mets data is temporarily unavailable.");
            setStatus("ERROR");
            queueDiscovery(FEED_RETRY_MS);
          }
        };
        await poll();
      } catch (reason) {
        if (disposed || token !== runToken) return;
        setError(reason instanceof Error ? reason.message : "The live game service could not start.");
        setStatus("ERROR");
        queueDiscovery(FEED_RETRY_MS);
      }
    };

    const discover = async () => {
      stopTracking();
      setStatus("CHECKING");
      setError(undefined);
      requestController = new AbortController();
      try {
        const games = await fetchMetsSchedule(easternDate(), fetch, requestController.signal);
        if (disposed) return;
        setCheckedAt(new Date().toISOString());
        const activeGame = selectTrackableMetsGame(games);
        if (activeGame) {
          await startTracking(activeGame);
          return;
        }
        setGame(undefined);
        setSnapshot(undefined);
        setStatus("BETWEEN_GAMES");
        queueDiscovery(scheduleRecheckDelay(games));
      } catch (reason) {
        if (isAbortError(reason) || disposed) return;
        setError(reason instanceof Error ? reason.message : "The Mets schedule is temporarily unavailable.");
        setStatus("ERROR");
        queueDiscovery(FEED_RETRY_MS);
      }
    };

    if (enabled) {
      void discover();
    } else {
      setStatus("CHECKING");
      setGame(undefined);
      setSnapshot(undefined);
      setError(undefined);
    }
    return () => {
      disposed = true;
      if (scheduleTimer !== undefined) window.clearTimeout(scheduleTimer);
      stopTracking();
    };
  }, [acceptCorePresentation, enabled]);

  return {
    status,
    game,
    snapshot,
    decision,
    celebration,
    targetPositionMm,
    checkedAt,
    error,
    reportPosition,
  };
}
