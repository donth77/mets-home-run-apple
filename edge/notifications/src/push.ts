import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { NotificationEnv, PendingDelivery } from "./types";

export interface PushDeliveryResult {
  status: number;
  disposition: "DELIVERED" | "EXPIRED_SUBSCRIPTION" | "PERMANENT_FAILURE" | "RETRY";
  retryDelayMs?: number;
}

function retryDelay(attempts: number, retryAfter: string | null) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(5 * 60_000, seconds * 1_000);
  return Math.min(5 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

export async function sendPushNotification(
  delivery: PendingDelivery,
  env: Pick<NotificationEnv, "VAPID_PRIVATE_KEY" | "VAPID_PUBLIC_KEY" | "VAPID_SUBJECT">,
  fetcher: typeof fetch = fetch,
): Promise<PushDeliveryResult> {
  const payload = await buildPushPayload(
    {
      data: JSON.stringify({
        title: delivery.event.title,
        body: delivery.event.body,
        eventKey: delivery.event.eventKey,
        kind: delivery.event.kind,
        url: delivery.event.targetUrl,
        timestamp: delivery.event.occurredAt,
      }),
      options: { ttl: 5 * 60, urgency: "high" },
    },
    delivery.subscription,
    {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    },
  );
  const response = await fetcher(delivery.subscription.endpoint, {
    ...payload,
    body: Uint8Array.from(payload.body).buffer,
  });
  if (response.ok) return { status: response.status, disposition: "DELIVERED" };
  if (response.status === 404 || response.status === 410) {
    return { status: response.status, disposition: "EXPIRED_SUBSCRIPTION" };
  }
  if ([400, 413].includes(response.status) || [401, 403].includes(response.status) || delivery.attempts >= 4) {
    return { status: response.status, disposition: "PERMANENT_FAILURE" };
  }
  return {
    status: response.status,
    disposition: "RETRY",
    retryDelayMs: retryDelay(delivery.attempts, response.headers.get("Retry-After")),
  };
}
