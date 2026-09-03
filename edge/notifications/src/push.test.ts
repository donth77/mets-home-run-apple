import { buildPushPayload } from "@block65/webcrypto-web-push";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendPushNotification } from "./push";
import type { PendingDelivery } from "./types";

vi.mock("@block65/webcrypto-web-push", () => ({
  buildPushPayload: vi.fn().mockResolvedValue({ method: "POST", headers: {}, body: new Uint8Array([1, 2, 3]) }),
}));

const delivery: PendingDelivery = {
  attempts: 1,
  event: {
    eventKey: "777001:play-1",
    gamePk: 777001,
    kind: "HOME_RUN",
    subject: "Francisco Lindor",
    title: "Francisco Lindor hit a home run!",
    body: "ATL 2, NYM 3 · Bottom 7",
    targetUrl: "/",
    occurredAt: 1_788_400_000_000,
  },
  subscription: {
    id: "subscription-id",
    endpoint: "https://fcm.googleapis.com/fcm/send/token",
    expirationTime: null,
    keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
  },
};

const vapid = { VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private", VAPID_SUBJECT: "https://metsapple.com/" };

beforeEach(() => {
  vi.mocked(buildPushPayload).mockClear();
});

describe("web push delivery", () => {
  it("builds an encrypted, high-urgency payload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    await expect(sendPushNotification(delivery, vapid, fetcher)).resolves.toEqual({
      status: 201,
      disposition: "DELIVERED",
    });
    expect(buildPushPayload).toHaveBeenCalledWith(
      expect.objectContaining({ options: { ttl: 300, urgency: "high" } }),
      delivery.subscription,
      expect.objectContaining({ subject: "https://metsapple.com/" }),
    );
  });

  it("removes expired subscriptions and retries temporary failures", async () => {
    const expired = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 410 }));
    await expect(sendPushNotification(delivery, vapid, expired)).resolves.toEqual({
      status: 410,
      disposition: "EXPIRED_SUBSCRIPTION",
    });

    const temporary = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(sendPushNotification(delivery, vapid, temporary)).resolves.toMatchObject({
      status: 503,
      disposition: "RETRY",
      retryDelayMs: 30_000,
    });
  });
});
