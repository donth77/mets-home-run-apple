import { type PushDeliveryResult, sendPushNotification } from "./push";
import { NotificationStore } from "./storage";
import type { LastPush, NotificationEnv, NotificationPreferences, PendingDelivery, StoredSubscription } from "./types";
import { isAllowedPushEndpoint, parsePreferences, parsePushSubscription } from "./validation";

type NotificationApiEnv = Pick<
  NotificationEnv,
  "NOTIFICATIONS_DB" | "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT" | "NOTIFICATIONS_TEST_PUSH"
>;

export interface NotificationApiStore {
  status(endpoint: string): Promise<{ preferences: NotificationPreferences; lastPush: LastPush | null } | undefined>;
  subscription(endpoint: string): Promise<StoredSubscription | undefined>;
  saveSubscription(
    subscription: NonNullable<ReturnType<typeof parsePushSubscription>>,
    preferences: NonNullable<ReturnType<typeof parsePreferences>>,
    nowMs: number,
  ): Promise<void>;
  removeSubscription(endpoint: string): Promise<void>;
  removeExpiredSubscription(id: string): Promise<void>;
  recordLastPush(id: string, push: LastPush): Promise<void>;
}

export type NotificationApiSend = (
  delivery: PendingDelivery,
  env: Pick<NotificationEnv, "VAPID_PRIVATE_KEY" | "VAPID_PUBLIC_KEY" | "VAPID_SUBJECT">,
) => Promise<PushDeliveryResult>;

export interface NotificationApiContext {
  request: Request;
  env: NotificationApiEnv;
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request: Request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(length) && length > 8_192) return undefined;
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return undefined;
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function handleNotificationApi(
  context: NotificationApiContext,
  nowMs = Date.now(),
  createStore: (database: D1Database) => NotificationApiStore = (database) => new NotificationStore(database),
  sendPush: NotificationApiSend = sendPushNotification,
): Promise<Response> {
  const url = new URL(context.request.url);
  const route = url.pathname.replace(/^\/api\/notifications\/?/, "");

  if (route === "config" && context.request.method === "GET") {
    if (!context.env.VAPID_PUBLIC_KEY) return json({ error: "Notifications are not configured." }, 503);
    return json({ vapidPublicKey: context.env.VAPID_PUBLIC_KEY });
  }

  // The test push exists for debugging sessions only; production does not answer it.
  const testPushOn = context.env.NOTIFICATIONS_TEST_PUSH === "on";
  if (!["status", "subscription", ...(testPushOn ? ["test"] : [])].includes(route)) {
    return json({ error: "Route not found." }, 404);
  }
  if (!sameOrigin(context.request)) return json({ error: "Request origin is not allowed." }, 403);
  if (!context.env.NOTIFICATIONS_DB) return json({ error: "Notifications are temporarily unavailable." }, 503);

  const body = await jsonBody(context.request);
  if (!body) return json({ error: "Invalid request body." }, 400);
  const store = createStore(context.env.NOTIFICATIONS_DB);

  if (route === "status" && context.request.method === "POST") {
    if (!isAllowedPushEndpoint(body.endpoint)) return json({ error: "Invalid push endpoint." }, 400);
    const status = await store.status(body.endpoint);
    return json({
      enabled: status !== undefined,
      preferences: status?.preferences ?? null,
      lastPush: status?.lastPush ?? null,
    });
  }

  // A real push to this one device, through the push service, so the whole
  // path can be checked from the phone without waiting for a home run.
  if (route === "test" && context.request.method === "POST") {
    if (!isAllowedPushEndpoint(body.endpoint)) return json({ error: "Invalid push endpoint." }, 400);
    const subscription = await store.subscription(body.endpoint);
    if (!subscription) return json({ error: "Notifications are not enabled on this device." }, 404);
    const eventKey = `test:${nowMs}`;
    const result = await sendPush(
      {
        event: {
          eventKey,
          gamePk: 0,
          kind: "HOME_RUN",
          subject: "Test",
          title: "Virtual Apple test",
          body: "Notifications reach this device. The next Mets home run will too.",
          targetUrl: "/",
          occurredAt: nowMs,
        },
        subscription,
        attempts: 0,
      },
      context.env,
    );
    const push = { at: nowMs, eventKey, outcome: result.disposition, status: result.status };
    await store.recordLastPush(subscription.id, push);
    if (result.disposition === "EXPIRED_SUBSCRIPTION") await store.removeExpiredSubscription(subscription.id);
    return json({ sent: result.disposition === "DELIVERED", lastPush: push });
  }

  if (route === "subscription" && context.request.method === "PUT") {
    const subscription = parsePushSubscription(body.subscription);
    const preferences = parsePreferences(body.preferences);
    if (!subscription || !preferences) return json({ error: "Invalid push subscription." }, 400);
    await store.saveSubscription(subscription, preferences, nowMs);
    return json({ enabled: true, preferences });
  }

  if (route === "subscription" && context.request.method === "DELETE") {
    if (!isAllowedPushEndpoint(body.endpoint)) return json({ error: "Invalid push endpoint." }, 400);
    await store.removeSubscription(body.endpoint);
    return json({ enabled: false });
  }

  return json({ error: "Method not allowed." }, 405);
}
