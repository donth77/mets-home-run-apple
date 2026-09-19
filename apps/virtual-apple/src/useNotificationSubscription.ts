import { useEffect, useRef, useState } from "react";
import {
  currentPushSubscription,
  disablePushNotifications,
  enablePushNotifications,
  type LastPush,
  type NotificationPreferences,
  registerNotificationServiceWorker,
  savePushPreferences,
  sendServerTestPush,
  showLocalTestNotification,
  subscriptionStatus,
} from "./notificationClient";

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = { homeRuns: true, metsWins: true };

export type NotificationState = "CHECKING" | "DISABLED" | "ENABLING" | "ENABLED" | "DENIED";

export type NotificationSubscription = ReturnType<typeof useNotificationSubscription>;

// What this browser last knew about its alerts, so a reload or a rebuilt
// toolbar shows the right bell at once instead of a grey one while the
// server is asked again. The server's answer still wins when it arrives.
const HINT_KEY = "virtual-apple:notifications";

function readHint(): "on" | "off" | undefined {
  try {
    const value = window.localStorage.getItem(HINT_KEY);
    return value === "on" || value === "off" ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeHint(value: "on" | "off") {
  try {
    window.localStorage.setItem(HINT_KEY, value);
  } catch {
    // A private window or blocked storage: the next load just checks first.
  }
}

type BraveNavigator = Navigator & { brave?: unknown };

/**
 * Turns the browser's own push registration failures into something a person
 * can act on. "Registration failed - push service error" is the browser
 * unable to reach Google's push service: in Brave that is a setting, off by
 * default; elsewhere it is usually a network that blocks the service.
 */
export function describeEnableFailure(reason: unknown, nav: Navigator = window.navigator): string {
  const text = reason instanceof Error ? reason.message : "";
  if (/push service/i.test(text)) {
    return (nav as BraveNavigator).brave !== undefined
      ? 'Brave could not reach its push service. Turn on "Use Google services for push messaging" under Settings, Privacy and security, then try again.'
      : "Your browser could not reach its push service. Check that nothing on your network blocks it, then try again.";
  }
  return text || "Notifications could not be enabled.";
}

/**
 * This device's push subscription: what the server has for it and the ways
 * to change it. The app holds one of these and hands it to whichever surface
 * is showing, the phone's card or the desktop bell, so a rebuilt toolbar
 * never starts from scratch and both surfaces agree.
 *
 * Changes are optimistic: the bell flips the moment it is pressed, and only
 * flips back if the browser or the server refuses.
 */
export function useNotificationSubscription(available: boolean) {
  const [state, setState] = useState<NotificationState>(() => (readHint() === "on" ? "ENABLED" : "CHECKING"));
  const [subscription, setSubscription] = useState<PushSubscription>();
  const [preferences, setPreferences] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
  const [message, setMessage] = useState("");
  const [lastPush, setLastPush] = useState<LastPush | null>(null);
  // Counts presses, so a check that started before one cannot overwrite it.
  const presses = useRef(0);

  useEffect(() => {
    if (!available) return;
    let disposed = false;
    const started = presses.current;
    const stale = () => disposed || presses.current !== started;
    void (async () => {
      if (Notification.permission === "denied") {
        setState("DENIED");
        writeHint("off");
        return;
      }
      try {
        const registration = await registerNotificationServiceWorker();
        const active = await currentPushSubscription(registration);
        if (stale()) return;
        const status = active ? await subscriptionStatus(active) : undefined;
        if (stale()) return;
        if (!active || !status?.enabled) {
          setState("DISABLED");
          writeHint("off");
          return;
        }
        setSubscription(active);
        if (status.preferences) setPreferences(status.preferences);
        setLastPush(status.lastPush ?? null);
        setState("ENABLED");
        writeHint("on");
      } catch {
        if (!stale()) setState("DISABLED");
      }
    })();
    return () => {
      disposed = true;
    };
  }, [available]);

  async function enable(next: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES) {
    if (state === "ENABLING") return;
    presses.current += 1;
    setState("ENABLING");
    setMessage("");
    try {
      const result = await enablePushNotifications(next);
      if (!result.subscription) {
        setState("DENIED");
        writeHint("off");
        return;
      }
      setPreferences(next);
      setSubscription(result.subscription);
      setState("ENABLED");
      writeHint("on");
    } catch (reason) {
      setMessage(describeEnableFailure(reason));
      setState("DISABLED");
      writeHint("off");
    }
  }

  async function disable() {
    // Off at once; the browser and server are told in the background. If the
    // server call fails its stale record is dropped once its endpoint dies.
    presses.current += 1;
    setState("DISABLED");
    setMessage("");
    writeHint("off");
    const active =
      subscription ??
      (await registerNotificationServiceWorker()
        .then((registration) => currentPushSubscription(registration))
        .catch(() => null));
    setSubscription(undefined);
    if (!active) return;
    try {
      await disablePushNotifications(active);
    } catch {
      // The browser subscription is still removed in a finally block.
    }
  }

  async function setPreference(name: keyof NotificationPreferences, enabled: boolean) {
    if (!subscription) return;
    const previous = preferences;
    const next = { ...preferences, [name]: enabled };
    setPreferences(next);
    setMessage("");
    try {
      await savePushPreferences(subscription, next);
    } catch (reason) {
      setPreferences(previous);
      setMessage(reason instanceof Error ? reason.message : "That setting could not be saved.");
    }
  }

  /** A real push to this device through the push service, for debugging sessions. */
  async function testPush() {
    if (!subscription) return;
    setMessage("Sending a test notification…");
    try {
      const result = await sendServerTestPush(subscription);
      setLastPush(result.lastPush);
      setMessage(
        result.sent
          ? "Sent. It should appear on this device within a few seconds."
          : result.lastPush.outcome === "EXPIRED_SUBSCRIPTION"
            ? "The test notification could not be delivered. Turn notifications off and on again on this device."
            : "The test notification could not be delivered.",
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The test notification could not be sent.");
    }
  }

  /** Asks the browser to show a notification directly, with no server involved. */
  async function testLocally() {
    setMessage("");
    try {
      await showLocalTestNotification();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The test notification could not be shown.");
    }
  }

  return { state, preferences, lastPush, message, enable, disable, setPreference, testPush, testLocally };
}
