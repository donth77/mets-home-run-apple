import { DurableObject } from "cloudflare:workers";
import { drainHop, emptyShardState, enqueueJob, type ShardState } from "./drain";
import { sendPushNotification } from "./push";
import { dispatcherSettings } from "./settings";
import { NotificationStore } from "./storage";
import type { NotificationEnv, VerifiedNotificationEvent } from "./types";

// One Durable Object per shard. It holds no subscriptions or events; those
// stay in D1. It exists because an alarm is a fresh invocation with its own
// CPU and subrequest budget, which is what lets a free-plan Worker drain a
// fan-out of any size a few pushes at a time.

const STATE_KEY = "state";
export const JOB_TTL_MS = 10 * 60_000;
const RETRY_AFTER_ERROR_MS = 5_000;

export class NotificationDispatcher extends DurableObject<NotificationEnv> {
  async enqueue(event: VerifiedNotificationEvent, shard: number, shards: number, nowMs: number): Promise<boolean> {
    const state = (await this.ctx.storage.get<ShardState>(STATE_KEY)) ?? emptyShardState(shard, shards);
    state.shard = shard;
    state.shards = shards;
    const added = enqueueJob(state, event, nowMs, JOB_TTL_MS);
    if (!added) return false;
    await this.ctx.storage.put(STATE_KEY, state);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(nowMs);
    return true;
  }

  async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<ShardState>(STATE_KEY);
    if (!state) return;
    const store = new NotificationStore(this.env.NOTIFICATIONS_DB);
    const nowMs = Date.now();
    let next: number | undefined;
    try {
      next = await drainHop(
        state,
        {
          listSubscriptions: (kind, occurredAt, range, afterId, limit) =>
            store.subscriptionsInRange(kind, occurredAt, range, afterId, limit),
          send: (delivery) => sendPushNotification(delivery, this.env),
          removeSubscription: (id) => store.removeExpiredSubscription(id),
          log: (entry) => console.log(JSON.stringify(entry)),
        },
        dispatcherSettings(this.env),
        nowMs,
      );
    } catch (reason) {
      console.error(`Notification dispatcher shard ${state.shard} hop failed.`, reason);
      next = nowMs + RETRY_AFTER_ERROR_MS;
    }
    await this.ctx.storage.put(STATE_KEY, state);
    if (next !== undefined) await this.ctx.storage.setAlarm(next);
  }
}
