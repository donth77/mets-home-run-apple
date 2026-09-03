import { NotificationStore } from "./storage";
import type { NotificationEnv } from "./types";
import { isAllowedPushEndpoint, parsePreferences, parsePushSubscription } from "./validation";

type NotificationApiEnv = Pick<NotificationEnv, "NOTIFICATIONS_DB" | "VAPID_PUBLIC_KEY">;

export interface NotificationApiStore {
  preferences(endpoint: string): Promise<ReturnType<typeof parsePreferences>>;
  saveSubscription(
    subscription: NonNullable<ReturnType<typeof parsePushSubscription>>,
    preferences: NonNullable<ReturnType<typeof parsePreferences>>,
    nowMs: number,
  ): Promise<void>;
  removeSubscription(endpoint: string): Promise<void>;
}

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
): Promise<Response> {
  const url = new URL(context.request.url);
  const route = url.pathname.replace(/^\/api\/notifications\/?/, "");

  if (route === "config" && context.request.method === "GET") {
    if (!context.env.VAPID_PUBLIC_KEY) return json({ error: "Notifications are not configured." }, 503);
    return json({ vapidPublicKey: context.env.VAPID_PUBLIC_KEY });
  }

  if (!["status", "subscription"].includes(route)) return json({ error: "Route not found." }, 404);
  if (!sameOrigin(context.request)) return json({ error: "Request origin is not allowed." }, 403);
  if (!context.env.NOTIFICATIONS_DB) return json({ error: "Notifications are temporarily unavailable." }, 503);

  const body = await jsonBody(context.request);
  if (!body) return json({ error: "Invalid request body." }, 400);
  const store = createStore(context.env.NOTIFICATIONS_DB);

  if (route === "status" && context.request.method === "POST") {
    if (!isAllowedPushEndpoint(body.endpoint)) return json({ error: "Invalid push endpoint." }, 400);
    const preferences = await store.preferences(body.endpoint);
    return json({ enabled: preferences !== undefined, preferences: preferences ?? null });
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
