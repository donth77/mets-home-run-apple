import { describe, expect, it, vi } from "vitest";
import { drainHop, emptyShardState, enqueueJob, MAX_ATTEMPTS, type DrainDependencies, type ShardState } from "./drain";
import type { PushDeliveryResult } from "./push";
import { ID_ALPHABET, shardRanges } from "./shards";
import type { StoredSubscription, VerifiedNotificationEvent } from "./types";

const T0 = Date.parse("2026-09-12T20:00:00Z");
const TTL = 10 * 60_000;
const options = { pushesPerHop: 6, dailyHopCap: 1_000 };

function event(overrides: Partial<VerifiedNotificationEvent> = {}): VerifiedNotificationEvent {
  return {
    eventKey: "823496:hr-1",
    gamePk: 823496,
    kind: "HOME_RUN",
    subject: "Francisco Lindor",
    title: "Francisco Lindor hit a home run!",
    body: "NYM 4, ATL 2 · Top 7",
    targetUrl: "/",
    occurredAt: T0 - 30_000,
    ...overrides,
  };
}

interface FakeSubscription extends StoredSubscription {
  homeRunsSince: number | null;
  metsWinsSince: number | null;
}

/** Ids spread over the whole alphabet: one per symbol, `count` symbols. */
function subscriptions(count: number, since = T0 - 60_000): FakeSubscription[] {
  return [...ID_ALPHABET].slice(0, count).map((symbol, index) => ({
    id: `${symbol}${String(index).padStart(3, "0")}`,
    endpoint: `https://push.example/${symbol}`,
    expirationTime: null,
    keys: { p256dh: "p", auth: "a" },
    homeRunsSince: since,
    metsWinsSince: since,
  }));
}

function fakeDependencies(
  rows: FakeSubscription[],
  send: (id: string, attempt: number) => PushDeliveryResult | Error = () => ({ status: 201, disposition: "DELIVERED" }),
) {
  const sent: string[] = [];
  const removed: string[] = [];
  const logs: Record<string, unknown>[] = [];
  const dependencies: DrainDependencies = {
    // Mirrors the D1 query: opted in before the event, within the range, after the cursor, id order.
    async listSubscriptions(kind, occurredAt, range, afterId, limit) {
      const since = (row: FakeSubscription) => (kind === "METS_WIN" ? row.metsWinsSince : row.homeRunsSince);
      return rows
        .filter((row) => {
          const optedIn = since(row);
          return optedIn !== null && optedIn <= occurredAt;
        })
        .filter((row) => row.id >= range.from && row.id < range.to && row.id > afterId)
        .sort((left, right) => (left.id < right.id ? -1 : 1))
        .slice(0, limit);
    },
    async send(delivery) {
      sent.push(delivery.subscription.id);
      const result = send(delivery.subscription.id, delivery.attempts);
      if (result instanceof Error) throw result;
      return result;
    },
    async removeSubscription(id) {
      removed.push(id);
    },
    log: (entry) => logs.push(entry),
  };
  return { dependencies, sent, removed, logs };
}

async function drainUntilIdle(state: ShardState, dependencies: DrainDependencies, start = T0, maxHops = 100) {
  let now = start;
  let hops = 0;
  for (;;) {
    const next = await drainHop(state, dependencies, options, now);
    hops += 1;
    if (next === undefined || hops >= maxHops) return { hops, next };
    now = Math.max(now + 1, next);
  }
}

describe("enqueueJob", () => {
  it("adds a job once per event", () => {
    const state = emptyShardState(0, 4);
    expect(enqueueJob(state, event(), T0, TTL)).toBe(true);
    expect(enqueueJob(state, event(), T0 + 1, TTL)).toBe(false);
    expect(state.jobs["823496:hr-1"]?.expiresAt).toBe(T0 + TTL);
  });
});

describe("drainHop", () => {
  it("sends to every subscription the shard owns, a few per hop, then goes idle", async () => {
    const rows = subscriptions(64);
    const state = emptyShardState(1, 4);
    enqueueJob(state, event(), T0, TTL);
    const { dependencies, sent, logs } = fakeDependencies(rows);

    const first = await drainHop(state, dependencies, options, T0);
    expect(first).toBe(T0);
    expect(sent).toHaveLength(6);

    const { next } = await drainUntilIdle(state, dependencies);
    expect(next).toBeUndefined();
    const owned = shardRanges(1, 4).map((range) => range.from);
    const expected = rows
      .filter((row) => owned.includes(row.id[0]))
      .map((row) => row.id)
      .sort();
    expect([...sent].sort()).toEqual(expected);
    expect(new Set(sent).size).toBe(sent.length);
    expect(state.jobs).toEqual({});
    expect(logs.at(-1)).toMatchObject({ type: "fanout-complete", shard: 1, sent: expected.length, failed: 0 });
  });

  it("skips subscriptions that opted in after the event", async () => {
    const rows = subscriptions(8);
    rows[0].homeRunsSince = T0;
    rows[1].homeRunsSince = null;
    const state = emptyShardState(0, 1);
    enqueueJob(state, event({ occurredAt: T0 - 1 }), T0, TTL);
    const { dependencies, sent } = fakeDependencies(rows);
    await drainUntilIdle(state, dependencies);
    expect(sent).not.toContain(rows[0].id);
    expect(sent).not.toContain(rows[1].id);
    expect(sent).toHaveLength(6);
  });

  it("finishes a job whose subscriptions fit in one hop", async () => {
    const rows = subscriptions(3);
    const state = emptyShardState(0, 1);
    enqueueJob(state, event(), T0, TTL);
    const { dependencies } = fakeDependencies(rows);
    const job = state.jobs["823496:hr-1"];
    expect(job.afterId).toBe("");
    await drainHop(state, dependencies, options, T0);
    // Three rows fit one hop, so the walk finished and the job is gone.
    expect(state.jobs).toEqual({});
  });

  it("holds a retry until it is due and reports the next alarm", async () => {
    const rows = subscriptions(1);
    const state = emptyShardState(0, 1);
    enqueueJob(state, event(), T0, TTL);
    let calls = 0;
    const { dependencies, sent } = fakeDependencies(rows, () =>
      calls++ === 0
        ? { status: 503, disposition: "RETRY", retryDelayMs: 30_000 }
        : { status: 201, disposition: "DELIVERED" },
    );
    const next = await drainUntilIdle(state, dependencies, T0, 3);
    // First hop: retry queued for T0 + 30 s. Second hop (at T0 + 30 s): delivered.
    expect(sent).toEqual([rows[0].id, rows[0].id]);
    expect(next.next).toBeUndefined();
    expect(state.retries).toEqual([]);
    expect(state.jobs).toEqual({});
  });

  it("returns the retry time as the next alarm when nothing else is pending", async () => {
    const rows = subscriptions(1);
    const state = emptyShardState(0, 1);
    enqueueJob(state, event(), T0, TTL);
    const { dependencies } = fakeDependencies(rows, () => ({
      status: 429,
      disposition: "RETRY",
      retryDelayMs: 45_000,
    }));
    const next = await drainHop(state, dependencies, options, T0);
    expect(next).toBe(T0 + 45_000);
    expect(state.retries).toHaveLength(1);
    expect(state.jobs["823496:hr-1"]).toBeDefined();
  });

  it("gives up after the attempt limit and counts the failure", async () => {
    const rows = subscriptions(1);
    const state = emptyShardState(0, 1);
    enqueueJob(state, event(), T0, TTL);
    const { dependencies, sent, logs } = fakeDependencies(rows, () => new Error("socket hang up"));
    const { hops } = await drainUntilIdle(state, dependencies);
    expect(sent).toHaveLength(MAX_ATTEMPTS);
    expect(hops).toBeLessThan(20);
    expect(logs.at(-1)).toMatchObject({ type: "fanout-complete", failed: 1, sent: 0 });
  });

  it("deletes a subscription the push service reports gone", async () => {
    const rows = subscriptions(2);
    const state = emptyShardState(0, 1);
    enqueueJob(state, event(), T0, TTL);
    const { dependencies, removed, logs } = fakeDependencies(rows, (id) =>
      id === rows[0].id
        ? { status: 410, disposition: "EXPIRED_SUBSCRIPTION" }
        : { status: 201, disposition: "DELIVERED" },
    );
    await drainUntilIdle(state, dependencies);
    expect(removed).toEqual([rows[0].id]);
    expect(logs.at(-1)).toMatchObject({ type: "fanout-complete", sent: 1, dropped: 1 });
  });

  it("drops an expired job without sending", async () => {
    const rows = subscriptions(4);
    const state = emptyShardState(0, 1);
    enqueueJob(state, event(), T0, TTL);
    const { dependencies, sent, logs } = fakeDependencies(rows);
    const next = await drainHop(state, dependencies, options, T0 + TTL);
    expect(sent).toEqual([]);
    expect(next).toBeUndefined();
    expect(logs[0]).toMatchObject({ type: "fanout-expired" });
  });

  it("sheds home-run fan-out past the daily hop cap but keeps a Mets win", async () => {
    const rows = subscriptions(4);
    const state = emptyShardState(0, 1);
    state.hops = { day: "2026-09-12", count: 1_000 };
    enqueueJob(state, event(), T0, TTL);
    enqueueJob(state, event({ eventKey: "823496:final", kind: "METS_WIN", title: "Mets win!" }), T0 + 1, TTL);
    const { dependencies, sent, logs } = fakeDependencies(rows);
    await drainUntilIdle(state, dependencies);
    expect(logs[0]).toMatchObject({ type: "fanout-shed", eventKey: "823496:hr-1" });
    expect(sent).toHaveLength(4);
    expect(state.jobs).toEqual({});
  });

  it("resets the hop counter on a new UTC day", async () => {
    const state = emptyShardState(0, 1);
    state.hops = { day: "2026-09-11", count: 5_000 };
    const { dependencies } = fakeDependencies([]);
    await drainHop(state, dependencies, options, T0);
    expect(state.hops).toEqual({ day: "2026-09-12", count: 1 });
  });

  it("sends the hop concurrently", async () => {
    const rows = subscriptions(6);
    const state = emptyShardState(0, 1);
    enqueueJob(state, event(), T0, TTL);
    let inFlight = 0;
    let peak = 0;
    const dependencies: DrainDependencies = {
      ...fakeDependencies(rows).dependencies,
      async send() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { status: 201, disposition: "DELIVERED" };
      },
    };
    await drainHop(state, dependencies, options, T0);
    expect(peak).toBe(6);
  });
});

describe("dispatchToShards", () => {
  it("hands the event to every shard with its index", async () => {
    const { dispatchToShards } = await import("./watcher");
    const enqueue = vi.fn(
      async (_event: VerifiedNotificationEvent, _shard: number, _shards: number, _now: number) => true,
    );
    const idFromName = vi.fn((name: string) => name);
    const env = {
      DISPATCHER: { idFromName, get: () => ({ enqueue }) },
      DISPATCHER_SHARDS: "3",
    } as unknown as Parameters<typeof dispatchToShards>[0];
    await dispatchToShards(env, event(), T0);
    expect(idFromName.mock.calls.map(([name]) => name)).toEqual(["shard-0", "shard-1", "shard-2"]);
    expect(enqueue.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
  });
});
