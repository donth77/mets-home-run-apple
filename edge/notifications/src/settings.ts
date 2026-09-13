import type { NotificationEnv } from "./types";

export interface DispatcherSettings {
  /** Dispatcher objects that fan out in parallel. */
  shards: number;
  /** Pushes per alarm. Each costs about 1 ms of CPU against a 10 ms free-plan budget. */
  pushesPerHop: number;
  /** Alarms one shard may run per UTC day before it sheds home-run fan-out. */
  dailyHopCap: number;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function dispatcherSettings(
  env: Pick<NotificationEnv, "DISPATCHER_SHARDS" | "PUSHES_PER_HOP" | "DISPATCHER_DAILY_HOP_CAP">,
): DispatcherSettings {
  return {
    shards: positiveInteger(env.DISPATCHER_SHARDS, 4),
    pushesPerHop: positiveInteger(env.PUSHES_PER_HOP, 6),
    dailyHopCap: positiveInteger(env.DISPATCHER_DAILY_HOP_CAP, 20_000),
  };
}
