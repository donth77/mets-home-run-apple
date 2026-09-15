import { describe, expect, it, vi } from "vitest";
import { handleNotificationApi, type NotificationApiContext, type NotificationApiStore } from "./api";

const database = {} as D1Database;

function context(
  path: string,
  method = "GET",
  body?: unknown,
  origin = "https://metsapple.com",
  testPush = false,
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
    env: {
      NOTIFICATIONS_DB: database,
      VAPID_PUBLIC_KEY: "public-key",
      VAPID_PRIVATE_KEY: "private-key",
      VAPID_SUBJECT: "https://metsapple.com/",
      ...(testPush ? { NOTIFICATIONS_TEST_PUSH: "on" } : {}),
    },
  };
}

const endpoint = "https://fcm.googleapis.com/fcm/send/abc";

function store(): NotificationApiStore {
  return {
    status: vi.fn().mockResolvedValue({
      preferences: { homeRuns: true, metsWins: false },
      lastPush: { at: 1_700, eventKey: "823575:hr:1", outcome: "DELIVERED", status: 201 },
    }),
    subscription: vi.fn().mockResolvedValue({
      id: "sub-1",
      endpoint,
      expirationTime: null,
      keys: { p256dh: "p", auth: "a" },
    }),
    saveSubscription: vi.fn().mockResolvedValue(undefined),
    removeSubscription: vi.fn().mockResolvedValue(undefined),
    removeExpiredSubscription: vi.fn().mockResolvedValue(undefined),
    recordLastPush: vi.fn().mockResolvedValue(undefined),
  };
}

describe("notification API", () => {
  it("reports the last push beside the preferences", async () => {
    const response = await handleNotificationApi(context("status", "POST", { endpoint }), 123, () => store());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      preferences: { homeRuns: true, metsWins: false },
      lastPush: { at: 1_700, eventKey: "823575:hr:1", outcome: "DELIVERED", status: 201 },
    });
  });

  it("sends a test push to one device and remembers the outcome", async () => {
    const backing = store();
    const send = vi.fn().mockResolvedValue({ status: 201, disposition: "DELIVERED" });
    const response = await handleNotificationApi(
      context("test", "POST", { endpoint }, undefined, true),
      5_000,
      () => backing,
      send,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sent: true,
      lastPush: { at: 5_000, eventKey: "test:5000", outcome: "DELIVERED", status: 201 },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subscription.endpoint).toBe(endpoint);
    expect(backing.recordLastPush).toHaveBeenCalledWith("sub-1", {
      at: 5_000,
      eventKey: "test:5000",
      outcome: "DELIVERED",
      status: 201,
    });
  });

  it("refuses a test push for a device that never enabled notifications", async () => {
    const backing = store();
    (backing.subscription as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const send = vi.fn();
    const response = await handleNotificationApi(
      context("test", "POST", { endpoint }, undefined, true),
      5_000,
      () => backing,
      send,
    );
    expect(response.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not answer the test push route unless it is switched on", async () => {
    const backing = store();
    const send = vi.fn();
    const response = await handleNotificationApi(context("test", "POST", { endpoint }), 5_000, () => backing, send);
    expect(response.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
    expect(backing.subscription).not.toHaveBeenCalled();
  });

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

  it("stores an iPhone subscription that carries no expirationTime key", async () => {
    const fake = store();
    const response = await handleNotificationApi(
      context("subscription", "PUT", {
        subscription: {
          endpoint: "https://web.push.apple.com/QP1/token",
          keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
        },
        preferences: { homeRuns: true, metsWins: true },
      }),
      123,
      () => fake,
    );

    expect(response.status).toBe(200);
    expect(fake.saveSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://web.push.apple.com/QP1/token", expirationTime: null }),
      { homeRuns: true, metsWins: true },
      123,
    );
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
