import type { PushDeliveryResult } from "./push";
import type { DispatcherSettings } from "./settings";
import { type IdRange, shardRanges } from "./shards";
import type { PendingDelivery, StoredSubscription, VerifiedNotificationEvent } from "./types";

// One dispatcher shard's fan-out, written as plain functions over a state
// object so it runs the same in tests and inside the Durable Object.
//
// A job walks the shard's id ranges with a cursor and sends a few pushes per
// hop. Successful sends write nothing per device; only the cursor moves. A
// push that should be retried is held with its subscription until it is due.
// The cursor advances after a hop's sends, so a hop that dies mid-way repeats
// at most one hop of pushes rather than skipping any.

export const MAX_ATTEMPTS = 4;
export const MAX_RETRIES_HELD = 1_000;

export interface FanoutJob {
  event: VerifiedNotificationEvent;
  queuedAt: number;
  expiresAt: number;
  /** Index into this shard's id ranges; equal to the range count once walked. */
  range: number;
  /** Last id sent within the current range. */
  afterId: string;
  sent: number;
  failed: number;
  /** Subscriptions the push service reported gone, now deleted. */
  dropped: number;
}

export interface PendingRetry {
  eventKey: string;
  subscription: StoredSubscription;
  attempts: number;
  nextAt: number;
}

export interface ShardState {
  version: 1;
  shard: number;
  shards: number;
  jobs: Record<string, FanoutJob>;
  retries: PendingRetry[];
  hops: { day: string; count: number };
}

export interface DrainDependencies {
  listSubscriptions(
    kind: VerifiedNotificationEvent["kind"],
    occurredAt: number,
    range: IdRange,
    afterId: string,
    limit: number,
  ): Promise<readonly StoredSubscription[]>;
  send(delivery: PendingDelivery): Promise<PushDeliveryResult>;
  removeSubscription(id: string): Promise<void>;
  log?(entry: Record<string, unknown>): void;
}

export type DrainOptions = Pick<DispatcherSettings, "pushesPerHop" | "dailyHopCap">;

export function emptyShardState(shard: number, shards: number): ShardState {
  return { version: 1, shard, shards, jobs: {}, retries: [], hops: { day: "", count: 0 } };
}

export function enqueueJob(state: ShardState, event: VerifiedNotificationEvent, nowMs: number, ttlMs: number): boolean {
  if (state.jobs[event.eventKey]) return false;
  state.jobs[event.eventKey] = {
    event,
    queuedAt: nowMs,
    expiresAt: nowMs + ttlMs,
    range: 0,
    afterId: "",
    sent: 0,
    failed: 0,
    dropped: 0,
  };
  return true;
}

function backoffMs(attempts: number) {
  return Math.min(5 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

function utcDay(nowMs: number) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Runs one hop. Mutates `state`; returns when the next alarm should fire, or undefined when idle. */
export async function drainHop(
  state: ShardState,
  dependencies: DrainDependencies,
  options: DrainOptions,
  nowMs: number,
): Promise<number | undefined> {
  const log = dependencies.log ?? (() => {});
  const day = utcDay(nowMs);
  if (state.hops.day !== day) state.hops = { day, count: 0 };
  state.hops.count += 1;
  const shedding = state.hops.count > options.dailyHopCap;
  const ranges = shardRanges(state.shard, state.shards);

  for (const [eventKey, job] of Object.entries(state.jobs)) {
    if (nowMs >= job.expiresAt) {
      delete state.jobs[eventKey];
      log({ type: "fanout-expired", shard: state.shard, eventKey, ...counts(job) });
    } else if (shedding && job.event.kind !== "METS_WIN") {
      delete state.jobs[eventKey];
      log({ type: "fanout-shed", shard: state.shard, eventKey, dayHops: state.hops.count, ...counts(job) });
    }
  }
  state.retries = state.retries.filter((retry) => state.jobs[retry.eventKey] !== undefined);

  const batch: PendingDelivery[] = [];
  const keptRetries: PendingRetry[] = [];
  for (const retry of state.retries) {
    const job = state.jobs[retry.eventKey];
    if (job && retry.nextAt <= nowMs && batch.length < options.pushesPerHop) {
      batch.push({ event: job.event, subscription: retry.subscription, attempts: retry.attempts });
    } else {
      keptRetries.push(retry);
    }
  }
  state.retries = keptRetries;

  const job = Object.values(state.jobs)
    .filter((candidate) => candidate.range < ranges.length)
    .sort((left, right) => left.queuedAt - right.queuedAt)[0];
  const cursor = job ? { range: job.range, afterId: job.afterId } : undefined;
  while (job && cursor && cursor.range < ranges.length && batch.length < options.pushesPerHop) {
    const limit = options.pushesPerHop - batch.length;
    const page = await dependencies.listSubscriptions(
      job.event.kind,
      job.event.occurredAt,
      ranges[cursor.range],
      cursor.afterId,
      limit,
    );
    for (const subscription of page) batch.push({ event: job.event, subscription, attempts: 0 });
    if (page.length < limit) {
      cursor.range += 1;
      cursor.afterId = "";
    } else {
      cursor.afterId = page[page.length - 1].id;
    }
  }

  const results = await Promise.allSettled(batch.map((delivery) => dependencies.send(delivery)));
  for (const [index, result] of results.entries()) {
    const delivery = batch[index];
    const owner = state.jobs[delivery.event.eventKey];
    if (!owner) continue;
    const attempts = delivery.attempts + 1;
    if (result.status === "fulfilled" && result.value.disposition === "DELIVERED") {
      owner.sent += 1;
    } else if (result.status === "fulfilled" && result.value.disposition === "EXPIRED_SUBSCRIPTION") {
      owner.dropped += 1;
      await dependencies.removeSubscription(delivery.subscription.id);
    } else if (result.status === "fulfilled" && result.value.disposition === "PERMANENT_FAILURE") {
      owner.failed += 1;
    } else {
      const delay =
        result.status === "fulfilled" ? (result.value.retryDelayMs ?? backoffMs(attempts)) : backoffMs(attempts);
      const nextAt = nowMs + delay;
      if (attempts >= MAX_ATTEMPTS || nextAt >= owner.expiresAt || state.retries.length >= MAX_RETRIES_HELD) {
        owner.failed += 1;
      } else {
        state.retries.push({
          eventKey: delivery.event.eventKey,
          subscription: delivery.subscription,
          attempts,
          nextAt,
        });
      }
    }
  }
  if (job && cursor) {
    job.range = cursor.range;
    job.afterId = cursor.afterId;
  }

  for (const [eventKey, finished] of Object.entries(state.jobs)) {
    const walked = finished.range >= ranges.length;
    const waiting = state.retries.some((retry) => retry.eventKey === eventKey);
    if (walked && !waiting) {
      delete state.jobs[eventKey];
      log({
        type: "fanout-complete",
        shard: state.shard,
        eventKey,
        kind: finished.event.kind,
        dayHops: state.hops.count,
        ...counts(finished),
      });
    }
  }

  if (Object.values(state.jobs).some((remaining) => remaining.range < ranges.length)) return nowMs;
  const nextRetry = state.retries.reduce<number | undefined>(
    (soonest, retry) => (soonest === undefined || retry.nextAt < soonest ? retry.nextAt : soonest),
    undefined,
  );
  return nextRetry;
}

function counts(job: FanoutJob) {
  return { sent: job.sent, failed: job.failed, dropped: job.dropped };
}
