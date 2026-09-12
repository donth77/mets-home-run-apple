export interface NotificationPreferences {
  homeRuns: boolean;
  metsWins: boolean;
}

interface NotificationConfig {
  vapidPublicKey: string;
}

interface NotificationStatus {
  enabled: boolean;
  preferences: NotificationPreferences | null;
}

const SERVICE_WORKER_URL = "/virtual-apple-sw.js";

export function pushNotificationsSupported() {
  return (
    typeof Notification !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    window.isSecureContext
  );
}

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(`${value.replaceAll("-", "+").replaceAll("_", "/")}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/notifications/${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  if (!response.ok) throw new Error(body?.error || "Notifications are temporarily unavailable.");
  return body as T;
}

export function registerNotificationServiceWorker() {
  return navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" });
}

export async function currentPushSubscription(registration: ServiceWorkerRegistration) {
  return registration.pushManager.getSubscription();
}

export async function subscriptionStatus(subscription: PushSubscription) {
  return api<NotificationStatus>("status", {
    method: "POST",
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
}

export async function enablePushNotifications(preferences: NotificationPreferences) {
  // Ask first: iOS only shows the prompt while the tap that started this is
  // still a user gesture, so nothing may be awaited ahead of it.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { permission, subscription: undefined };
  const registration = await registerNotificationServiceWorker();
  const config = await api<NotificationConfig>("config");
  const subscription =
    (await currentPushSubscription(registration)) ??
    (await registration.pushManager.subscribe({
      applicationServerKey: applicationServerKey(config.vapidPublicKey),
      userVisibleOnly: true,
    }));
  await savePushPreferences(subscription, preferences);
  return { permission, subscription };
}

/** Safari omits expirationTime from toJSON() when a subscription never expires; the API expects null. */
export function subscriptionJson(subscription: Pick<PushSubscription, "toJSON">) {
  const json = subscription.toJSON();
  return { ...json, expirationTime: json.expirationTime ?? null };
}

export async function savePushPreferences(subscription: PushSubscription, preferences: NotificationPreferences) {
  await api<NotificationStatus>("subscription", {
    method: "PUT",
    body: JSON.stringify({ subscription: subscriptionJson(subscription), preferences }),
  });
}

export async function disablePushNotifications(subscription: PushSubscription) {
  try {
    await api<{ enabled: false }>("subscription", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } finally {
    await subscription.unsubscribe();
  }
}

export async function showLocalTestNotification() {
  const registration = await registerNotificationServiceWorker();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked in system settings.");
  await registration.showNotification("Virtual Apple test", {
    body: "Home run and Mets win alerts are working on this device.",
    icon: "/pwa-icon-192.png",
    badge: "/pwa-icon-192.png",
    tag: "virtual-apple-local-test",
  });
}
