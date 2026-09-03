import { describe, expect, it, vi } from "vitest";
import { handleNotificationApi, type NotificationApiContext, type NotificationApiStore } from "./api";

const database = {} as D1Database;

function context(
  path: string,
  method = "GET",
  body?: unknown,
  origin = "https://metsapple.com",
): NotificationApiContext {
  return {
    request: new Request(`https://metsapple.com/api/notifications/${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Origin: origin,
      },
    }),
    env: { NOTIFICATIONS_DB: database, VAPID_PUBLIC_KEY: "public-key" },
  };
}

function store(): NotificationApiStore {
  return {
    preferences: vi.fn().mockResolvedValue({ homeRuns: true, metsWins: false }),
    saveSubscription: vi.fn().mockResolvedValue(undefined),
    removeSubscription: vi.fn().mockResolvedValue(undefined),
  };
}

describe("notification API", () => {
  it("publishes only the VAPID public key", async () => {
    const response = await handleNotificationApi(context("config"));
    await expect(response.json()).resolves.toEqual({ vapidPublicKey: "public-key" });
  });

  it("rejects cross-origin subscription writes", async () => {
    const response = await handleNotificationApi(
      context("subscription", "DELETE", { endpoint: "https://fcm.googleapis.com/fcm/send/token" }, "https://evil.test"),
    );
    expect(response.status).toBe(403);
  });

  it("stores explicit home-run and win preferences", async () => {
    const fake = store();
    const response = await handleNotificationApi(
      context("subscription", "PUT", {
        subscription: {
          endpoint: "https://fcm.googleapis.com/fcm/send/token",
          expirationTime: null,
          keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
        },
        preferences: { homeRuns: true, metsWins: true },
      }),
      123,
      () => fake,
    );

    expect(response.status).toBe(200);
    expect(fake.saveSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://fcm.googleapis.com/fcm/send/token" }),
      { homeRuns: true, metsWins: true },
      123,
    );
  });
});
