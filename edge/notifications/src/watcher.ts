import type { GameCore } from "@apple/game-core-wasm";
import type { GameStateProjector } from "@apple/game-state-wasm";
import {
  easternDate,
  fetchMetsScheduleRange,
  LIVE_FEED_FIELDS,
  MlbRecordingClient,
  type MlbScheduleGame,
  type NormalizedFeedCapture,
} from "@apple/mlb-live-feed";
import { verifiedNotificationEvents } from "./events";
import { dispatcherSettings } from "./settings";
import { shardName } from "./shards";
import { NotificationStore } from "./storage";
import type { NotificationEnv, VerifiedNotificationEvent } from "./types";

interface WatcherDependencies {
  createGameCore: () => Promise<GameCore>;
  createGameStateProjector: () => Promise<GameStateProjector>;
  fetcher?: typeof fetch;
  loadCapture?: (game: MlbScheduleGame, now: Date) => Promise<NormalizedFeedCapture | undefined>;
  dispatch?: (event: VerifiedNotificationEvent, nowMs: number) => Promise<void>;
}

/** Hands a new event to every dispatcher shard; each fans out to its own subscriptions. */
export async function dispatchToShards(env: NotificationEnv, event: VerifiedNotificationEvent, nowMs: number) {
  const { shards } = dispatcherSettings(env);
  for (let shard = 0; shard < shards; shard += 1) {
    const stub = env.DISPATCHER.get(env.DISPATCHER.idFromName(shardName(shard)));
    await stub.enqueue(event, shard, shards, nowMs);
  }
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
      { fields: LIVE_FEED_FIELDS },
    );
    return (await client.poll(game)).capture;
  } finally {
    projector.dispose();
  }
}

function previousEasternDate(now: Date) {
  return easternDate(new Date(now.getTime() - 24 * 60 * 60_000));
}

export async function runNotificationCycle(env: NotificationEnv, dependencies: WatcherDependencies, now = new Date()) {
  const nowMs = now.getTime();
  const fetcher = dependencies.fetcher ?? fetch;
  const store = new NotificationStore(env.NOTIFICATIONS_DB);
  const dispatch = dependencies.dispatch ?? ((event, at) => dispatchToShards(env, event, at));
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
          if (!(await store.recordEvent(event, nowMs))) continue;
          detected += 1;
          await dispatch(event, nowMs);
        }
      }
      if (capture.gameSnapshot.phase === "FINAL") await store.markGameFinal(game.gamePk, nowMs);
    } catch (reason) {
      console.error(`Notification watcher could not inspect game ${game.gamePk}.`, reason);
    }
  }

  return { games: games.length, detected };
}
