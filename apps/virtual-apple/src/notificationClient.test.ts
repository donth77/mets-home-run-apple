/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { enablePushNotifications, savePushPreferences, subscriptionJson } from "./notificationClient";

const safariSubscription = {
  endpoint: "https://web.push.apple.com/QP1/token",
  toJSON: () => ({ endpoint: "https://web.push.apple.com/QP1/token", keys: { p256dh: "p", auth: "a" } }),
} as unknown as PushSubscription;

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("push subscription client", () => {
  it("sends expirationTime as null when Safari leaves the key out", async () => {
    expect(subscriptionJson(safariSubscription)).toEqual({
      endpoint: "https://web.push.apple.com/QP1/token",
      expirationTime: null,
      keys: { p256dh: "p", auth: "a" },
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ enabled: true }));
    vi.stubGlobal("fetch", fetchMock);

    await savePushPreferences(safariSubscription, { homeRuns: true, metsWins: false });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      subscription: {
        endpoint: "https://web.push.apple.com/QP1/token",
        expirationTime: null,
        keys: { p256dh: "p", auth: "a" },
      },
      preferences: { homeRuns: true, metsWins: false },
    });
  });

  it("asks for permission before anything is awaited, so the iOS prompt stays inside the tap", async () => {
    const order: string[] = [];
    vi.stubGlobal("Notification", {
      requestPermission: vi.fn(async () => {
        order.push("permission");
        return "granted";
      }),
    });
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => null),
        subscribe: vi.fn(async () => {
          order.push("subscribe");
          return safariSubscription;
        }),
      },
    };
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn(async () => {
          order.push("register");
          return registration;
        }),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        order.push(`fetch ${input}`);
        return jsonResponse(input.endsWith("/config") ? { vapidPublicKey: "QUJD" } : { enabled: true });
      }),
    );

    const result = await enablePushNotifications({ homeRuns: true, metsWins: true });

    expect(result.subscription).toBe(safariSubscription);
    expect(order).toEqual([
      "permission",
      "register",
      "fetch /api/notifications/config",
      "subscribe",
      "fetch /api/notifications/subscription",
    ]);
  });
});
