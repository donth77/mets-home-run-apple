import type { GameCore } from "@apple/game-core-wasm";
import type { GameStateProjector } from "@apple/game-state-wasm";
import {
  easternDate,
  fetchMetsScheduleRange,
  MlbRecordingClient,
  type MlbScheduleGame,
  type NormalizedFeedCapture,
} from "@apple/mlb-live-feed";
import { verifiedNotificationEvents } from "./events";
import { sendPushNotification } from "./push";
import { NotificationStore } from "./storage";
import type { NotificationEnv } from "./types";

interface WatcherDependencies {
  createGameCore: () => Promise<GameCore>;
  createGameStateProjector: () => Promise<GameStateProjector>;
  fetcher?: typeof fetch;
  loadCapture?: (game: MlbScheduleGame, now: Date) => Promise<NormalizedFeedCapture | undefined>;
}

function isTrackable(game: MlbScheduleGame) {
  const abstractState = game.abstractState.toLowerCase();
  const detailedState = game.detailedState.toLowerCase();
  return (
    abstractState === "live" ||
    abstractState === "final" ||
    /^(?:final|game over)\b/.test(detailedState) ||
    ["in progress", "warmup", "delayed", "suspended", "review", "challenge"].some((state) =>
      detailedState.includes(state),
    )
  );
}

async function defaultLoadCapture(
  game: MlbScheduleGame,
  now: Date,
  fetcher: typeof fetch,
  createProjector: () => Promise<GameStateProjector>,
) {
  const projector = await createProjector();
  try {
    const client = new MlbRecordingClient(
      fetcher,
      () => now,
      (frame) => projector.project(frame),
      (facts) => projector.classifyStatus(facts),
    );
    return (await client.poll(game)).capture;
  } finally {
    projector.dispose();
  }
}

function previousEasternDate(now: Date) {
  return easternDate(new Date(now.getTime() - 24 * 60 * 60_000));
}

export async function runNotificationCycle(
  env: NotificationEnv,
  dependencies: WatcherDependencies,
  now = new Date(),
) {
  const nowMs = now.getTime();
  const fetcher = dependencies.fetcher ?? fetch;
  const store = new NotificationStore(env.NOTIFICATIONS_DB);
  const games = (await fetchMetsScheduleRange(previousEasternDate(now), easternDate(now), fetcher)).filter(isTrackable);
  let detected = 0;

  for (const game of games) {
    try {
      const gameState = await store.gameState(game.gamePk);
      if (gameState.finalized) continue;
      const capture = dependencies.loadCapture
        ? await dependencies.loadCapture(game, now)
        : await defaultLoadCapture(game, now, fetcher, dependencies.createGameStateProjector);
      if (!capture) continue;
      const knownEventKeys = gameState.exists ? await store.knownEventKeys(game.gamePk) : new Set<string>();
      const events = await verifiedNotificationEvents(capture, dependencies.createGameCore, knownEventKeys);
      if (!gameState.exists) {
        await store.initializeGame(game.gamePk, events, nowMs);
      } else {
        for (const event of events) {
          if (await store.recordEvent(event, nowMs)) detected += 1;
        }
      }
      if (capture.gameSnapshot.phase === "FINAL") await store.markGameFinal(game.gamePk, nowMs);
    } catch (reason) {
      console.error(`Notification watcher could not inspect game ${game.gamePk}.`, reason);
    }
  }

  const due = await store.claimDueDeliveries(nowMs);
  let delivered = 0;
  for (const delivery of due) {
    try {
      const result = await sendPushNotification(delivery, env, fetcher);
      if (result.disposition === "DELIVERED") {
        await store.markDelivered(delivery.event.eventKey, delivery.subscription.id, nowMs, result.status);
        delivered += 1;
      } else if (result.disposition === "EXPIRED_SUBSCRIPTION") {
        await store.removeExpiredSubscription(delivery.subscription.id);
      } else if (result.disposition === "RETRY") {
        await store.markDeliveryFailed(
          delivery.event.eventKey,
          delivery.subscription.id,
          nowMs,
          result.status,
          result.retryDelayMs ?? 60_000,
        );
      } else {
        await store.markDeliveryExpired(delivery.event.eventKey, delivery.subscription.id, result.status);
      }
    } catch (reason) {
      console.error(`Notification delivery failed for ${delivery.event.eventKey}.`, reason);
      if (delivery.attempts >= 4) {
        await store.markDeliveryExpired(delivery.event.eventKey, delivery.subscription.id, 0);
      } else {
        await store.markDeliveryFailed(
          delivery.event.eventKey,
          delivery.subscription.id,
          nowMs,
          0,
          Math.min(5 * 60_000, 30_000 * 2 ** Math.max(0, delivery.attempts - 1)),
        );
      }
    }
  }

  return { games: games.length, detected, delivered };
}
