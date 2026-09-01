import { easternDate, fetchMetsSchedule, MlbRecordingClient, type MlbScheduleGame } from "@apple/mlb-live-feed";
import type { GameSnapshot } from "@apple/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveCelebrationLatch } from "./liveCelebrationLatch";
import {
  coreSequenceNeedsTicking,
  type LiveCelebration,
  type LiveCorePresentation,
  LiveGameCoreController,
} from "./liveGameCoreController";
import { MINI_APPLE_HEARTBEAT_EVENT } from "./miniAppleHeartbeat";
import { mlbApiFetch } from "./mlbApiFetch";

export type { LiveCelebration } from "./liveGameCoreController";

const SCHEDULE_RECHECK_NEAR_GAME_MS = 60_000;
const SCHEDULE_RECHECK_IDLE_MS = 15 * 60_000;
const DISCOVERY_RETRY_MS = 10_000;
const LIVE_FEED_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;
export const FINAL_SCOREBOARD_HOLD_MS = 60_000;
export const TERMINAL_SCOREBOARD_HOLD_MS = 60_000;

export type LiveMetsGameStatus = "CHECKING" | "BETWEEN_GAMES" | "CONNECTING" | "POLLING" | "FINAL" | "ERROR";

export interface LiveMetsGameState {
  status: LiveMetsGameStatus;
  game?: MlbScheduleGame;
  snapshot?: GameSnapshot;
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

export function liveFeedContinuation(phase: GameSnapshot["phase"], waitMs: number, label = "") {
  if (phase === "FINAL") return { kind: "DISCOVER" as const, delayMs: FINAL_SCOREBOARD_HOLD_MS };
  if (/^(?:postponed|cancelled|canceled)\b/i.test(label.trim())) {
    return { kind: "DISCOVER" as const, delayMs: TERMINAL_SCOREBOARD_HOLD_MS };
  }
  return { kind: "POLL" as const, delayMs: waitMs };
}

export function remainingLivePollDelay(waitMs: number, requestElapsedMs: number) {
  return Math.max(0, waitMs - Math.max(0, requestElapsedMs));
}

export function liveFeedRetryDelay(consecutiveFailures: number) {
  const index = Math.min(LIVE_FEED_RETRY_DELAYS_MS.length - 1, Math.max(0, Math.trunc(consecutiveFailures) - 1));
  return LIVE_FEED_RETRY_DELAYS_MS[index];
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
  const [celebration, setCelebration] = useState<LiveCelebration>();
  const [targetPositionMm, setTargetPositionMm] = useState(0);
  const [checkedAt, setCheckedAt] = useState<string>();
  const [error, setError] = useState<string>();
  const coreRef = useRef<LiveGameCoreController | undefined>(undefined);
  const celebrationLatchRef = useRef(new LiveCelebrationLatch());
  const afterCorePresentationRef = useRef<((presentation: LiveCorePresentation) => void) | undefined>(undefined);

  const acceptCorePresentation = useCallback((presentation: LiveCorePresentation, fallbackSnapshot?: GameSnapshot) => {
    const latched = celebrationLatchRef.current.accept(presentation, fallbackSnapshot);
    setCelebration(latched.celebration);
    setTargetPositionMm(latched.targetPositionMm);
    if (latched.snapshot) setSnapshot(latched.snapshot);
    afterCorePresentationRef.current?.(latched);
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
    let scheduleDueAt = 0;
    let feedTimer: number | undefined;
    let tickTimer: number | undefined;
    let resumeTracking: (() => void) | undefined;
    let serviceTrackingClock: (() => void) | undefined;
    let scheduledDiscoveryRecovery = false;

    const stopTracking = () => {
      runToken += 1;
      requestController?.abort();
      requestController = undefined;
      if (feedTimer !== undefined) window.clearTimeout(feedTimer);
      if (tickTimer !== undefined) window.clearInterval(tickTimer);
      feedTimer = undefined;
      tickTimer = undefined;
      resumeTracking = undefined;
      serviceTrackingClock = undefined;
      coreRef.current?.dispose();
      coreRef.current = undefined;
      afterCorePresentationRef.current = undefined;
      celebrationLatchRef.current.reset();
      setTargetPositionMm(0);
      setCelebration(undefined);
    };

    const queueDiscovery = (delayMs: number, recoveringFromError = false) => {
      if (scheduleTimer !== undefined) window.clearTimeout(scheduleTimer);
      scheduledDiscoveryRecovery = recoveringFromError;
      scheduleDueAt = Date.now() + delayMs;
      scheduleTimer = window.setTimeout(() => {
        scheduleTimer = undefined;
        scheduleDueAt = 0;
        void discover(recoveringFromError);
      }, delayMs);
    };

    const startTracking = async (selectedGame: MlbScheduleGame, recoveringFromError = false) => {
      stopTracking();
      const token = runToken;
      setGame(selectedGame);
      setStatus(recoveringFromError ? "ERROR" : "CONNECTING");
      if (!recoveringFromError) setError(undefined);
      const client = new MlbRecordingClient(mlbApiFetch);
      try {
        const core = await LiveGameCoreController.create();
        if (disposed || token !== runToken) {
          core.dispose();
          return;
        }
        coreRef.current = core;

        const stopCoreTicking = () => {
          if (tickTimer !== undefined) window.clearInterval(tickTimer);
          tickTimer = undefined;
        };
        const tickCore = () => {
          if (!coreRef.current) {
            stopCoreTicking();
            return;
          }
          try {
            const nextPresentation = coreRef.current.tick(performance.now());
            acceptCorePresentation(nextPresentation);
            if (!coreSequenceNeedsTicking(nextPresentation.decision?.sequenceState)) stopCoreTicking();
          } catch (reason) {
            stopCoreTicking();
            setError(reason instanceof Error ? reason.message : "Live game timing stopped unexpectedly.");
            setStatus("ERROR");
          }
        };
        const syncCoreTicking = (presentation: LiveCorePresentation) => {
          if (!coreSequenceNeedsTicking(presentation.decision?.sequenceState)) {
            stopCoreTicking();
            return;
          }
          if (tickTimer !== undefined) return;
          tickTimer = window.setInterval(tickCore, 100);
        };

        let consecutiveFailures = 0;
        let hasCapture = false;
        let pendingDiscoveryDelayMs: number | undefined;
        let pollInFlight = false;
        let nextFeedPollAt = 0;

        const queuePendingDiscoveryIfSettled = (presentation: LiveCorePresentation) => {
          if (
            pendingDiscoveryDelayMs === undefined ||
            presentation.celebration ||
            coreSequenceNeedsTicking(presentation.decision?.sequenceState)
          )
            return;
          const delayMs = pendingDiscoveryDelayMs;
          pendingDiscoveryDelayMs = undefined;
          queueDiscovery(delayMs);
        };
        afterCorePresentationRef.current = queuePendingDiscoveryIfSettled;

        const queuePoll = (delayMs: number) => {
          if (feedTimer !== undefined) window.clearTimeout(feedTimer);
          nextFeedPollAt = Date.now() + delayMs;
          feedTimer = window.setTimeout(() => {
            feedTimer = undefined;
            nextFeedPollAt = 0;
            void poll();
          }, delayMs);
        };

        const poll = async (): Promise<void> => {
          if (disposed || token !== runToken || pollInFlight) return;
          pollInFlight = true;
          nextFeedPollAt = 0;
          const activeController = new AbortController();
          requestController = activeController;
          const requestStartedAt = performance.now();
          try {
            const result = await client.poll(selectedGame, activeController.signal);
            if (disposed || token !== runToken) return;
            consecutiveFailures = 0;
            if (result.capture) {
              hasCapture = true;
              setError(undefined);
              celebrationLatchRef.current.recordCapture(result.capture);
              const continuation = liveFeedContinuation(
                result.capture.gameSnapshot.phase,
                result.waitMs,
                result.capture.gameSnapshot.label,
              );
              if (continuation.kind === "DISCOVER") pendingDiscoveryDelayMs = continuation.delayMs;
              const corePresentation = core.ingest(result.capture.coreInput, performance.now());
              acceptCorePresentation(corePresentation, result.capture.gameSnapshot);
              syncCoreTicking(corePresentation);
              if (continuation.kind === "DISCOVER") {
                setStatus(result.capture.gameSnapshot.phase === "FINAL" ? "FINAL" : "POLLING");
                resumeTracking = undefined;
                queuePendingDiscoveryIfSettled(corePresentation);
                return;
              }
              setStatus("POLLING");
              queuePoll(remainingLivePollDelay(continuation.delayMs, performance.now() - requestStartedAt));
              return;
            } else {
              setError(undefined);
              setStatus("POLLING");
            }
            queuePoll(remainingLivePollDelay(result.waitMs, performance.now() - requestStartedAt));
          } catch (reason) {
            if (isAbortError(reason) || disposed || token !== runToken) return;
            consecutiveFailures += 1;
            setError(reason instanceof Error ? reason.message : "Live Mets data is temporarily unavailable.");
            setStatus(hasCapture ? "POLLING" : "ERROR");
            queuePoll(liveFeedRetryDelay(consecutiveFailures));
          } finally {
            if (requestController === activeController) requestController = undefined;
            pollInFlight = false;
          }
        };
        resumeTracking = () => {
          if (disposed || token !== runToken || pollInFlight) return;
          if (feedTimer !== undefined) window.clearTimeout(feedTimer);
          feedTimer = undefined;
          nextFeedPollAt = 0;
          void poll();
        };
        serviceTrackingClock = () => {
          if (tickTimer !== undefined) tickCore();
          if (nextFeedPollAt === 0 || Date.now() < nextFeedPollAt || pollInFlight) return;
          if (feedTimer !== undefined) window.clearTimeout(feedTimer);
          feedTimer = undefined;
          nextFeedPollAt = 0;
          void poll();
        };
        await poll();
      } catch (reason) {
        if (disposed || token !== runToken) return;
        setError(reason instanceof Error ? reason.message : "The live game service could not start.");
        setStatus("ERROR");
        queueDiscovery(DISCOVERY_RETRY_MS, true);
      }
    };

    const discover = async (recoveringFromError = false) => {
      stopTracking();
      setStatus(recoveringFromError ? "ERROR" : "CHECKING");
      if (!recoveringFromError) setError(undefined);
      requestController = new AbortController();
      try {
        const games = await fetchMetsSchedule(easternDate(), mlbApiFetch, requestController.signal);
        if (disposed) return;
        setCheckedAt(new Date().toISOString());
        const activeGame = selectTrackableMetsGame(games);
        if (activeGame) {
          await startTracking(activeGame, recoveringFromError);
          return;
        }
        setGame(undefined);
        setSnapshot(undefined);
        setError(undefined);
        setStatus("BETWEEN_GAMES");
        queueDiscovery(scheduleRecheckDelay(games));
      } catch (reason) {
        if (isAbortError(reason) || disposed) return;
        setError(reason instanceof Error ? reason.message : "The Mets schedule is temporarily unavailable.");
        setStatus("ERROR");
        queueDiscovery(DISCOVERY_RETRY_MS, true);
      }
    };

    const resume = () => {
      if (disposed || !enabled) return;
      if (resumeTracking) {
        resumeTracking();
        return;
      }
      if (scheduleTimer === undefined) return;
      window.clearTimeout(scheduleTimer);
      scheduleTimer = undefined;
      void discover(scheduledDiscoveryRecovery);
    };
    const resumeWhenVisible = () => {
      if (document.visibilityState === "visible") resume();
    };
    const serviceMiniWindow = () => {
      serviceTrackingClock?.();
      if (scheduleTimer === undefined || scheduleDueAt === 0 || Date.now() < scheduleDueAt) return;
      window.clearTimeout(scheduleTimer);
      scheduleTimer = undefined;
      scheduleDueAt = 0;
      void discover(scheduledDiscoveryRecovery);
    };

    window.addEventListener("online", resume);
    window.addEventListener(MINI_APPLE_HEARTBEAT_EVENT, serviceMiniWindow);
    document.addEventListener("visibilitychange", resumeWhenVisible);

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
      window.removeEventListener("online", resume);
      window.removeEventListener(MINI_APPLE_HEARTBEAT_EVENT, serviceMiniWindow);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, [acceptCorePresentation, enabled]);

  return {
    status,
    game,
    snapshot,
    celebration,
    targetPositionMm,
    checkedAt,
    error,
    reportPosition,
  };
}
