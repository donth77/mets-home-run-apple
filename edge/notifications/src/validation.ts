import type { BrowserPushSubscription, NotificationPreferences } from "./types";

const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.apple.com",
  "push.services.mozilla.com",
  "notify.windows.com",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBase64Url(value: unknown, minimumLength: number, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimumLength &&
    value.length <= maximumLength &&
    /^[A-Za-z0-9_-]+={0,2}$/.test(value)
  );
}

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

export function parsePushSubscription(value: unknown): BrowserPushSubscription | undefined {
  if (!isRecord(value) || !isAllowedPushEndpoint(value.endpoint) || !isRecord(value.keys)) return undefined;
  if (!isBase64Url(value.keys.p256dh, 40, 160) || !isBase64Url(value.keys.auth, 8, 64)) return undefined;
  const expirationTime = value.expirationTime;
  if (expirationTime !== null && (typeof expirationTime !== "number" || !Number.isFinite(expirationTime))) {
    return undefined;
  }
  return {
    endpoint: value.endpoint,
    expirationTime,
    keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
  };
}

export function parsePreferences(value: unknown): NotificationPreferences | undefined {
  if (!isRecord(value) || typeof value.homeRuns !== "boolean" || typeof value.metsWins !== "boolean") {
    return undefined;
  }
  return { homeRuns: value.homeRuns, metsWins: value.metsWins };
}
