import { createCloudflareGameCore } from "@apple/game-core-wasm/cloudflare";
import { createCloudflareGameStateProjector } from "@apple/game-state-wasm/cloudflare";
import type { NotificationEnv } from "./types";
import { runNotificationCycle as runCycle } from "./watcher";

const runtime = {
  createGameCore: createCloudflareGameCore,
  createGameStateProjector: createCloudflareGameStateProjector,
};

export function runNotificationCycle(env: NotificationEnv, now = new Date()) {
  return runCycle(env, runtime, now);
}

export default {
  async scheduled(_controller: ScheduledController, env: NotificationEnv, context: ExecutionContext) {
    context.waitUntil(runNotificationCycle(env));
  },
} satisfies ExportedHandler<NotificationEnv>;

export { handleNotificationApi } from "./api";
export { NotificationDispatcher } from "./dispatcher";
