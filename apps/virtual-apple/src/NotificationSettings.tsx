import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import {
  currentPushSubscription,
  disablePushNotifications,
  enablePushNotifications,
  type NotificationPreferences,
  pushNotificationsSupported,
  registerNotificationServiceWorker,
  savePushPreferences,
  showLocalTestNotification,
  subscriptionStatus,
} from "./notificationClient";
import { isStandalonePwa } from "./PwaInstallPrompt";

const DEFAULT_PREFERENCES: NotificationPreferences = { homeRuns: true, metsWins: true };

type NotificationState = "CHECKING" | "DISABLED" | "ENABLING" | "ENABLED" | "DENIED";

export function NotificationSettings() {
  const [state, setState] = useState<NotificationState>("CHECKING");
  const [subscription, setSubscription] = useState<PushSubscription>();
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [message, setMessage] = useState("");
  const available = isStandalonePwa() && pushNotificationsSupported();

  useEffect(() => {
    if (!available) return;
    let disposed = false;
    void (async () => {
      if (Notification.permission === "denied") {
        setState("DENIED");
        return;
      }
      try {
        const registration = await registerNotificationServiceWorker();
        const active = await currentPushSubscription(registration);
        if (disposed) return;
        if (!active) {
          setState("DISABLED");
          return;
        }
        const status = await subscriptionStatus(active);
        if (disposed) return;
        if (!status.enabled) {
          setState("DISABLED");
          return;
        }
        setSubscription(active);
        if (status.preferences) setPreferences(status.preferences);
        setState("ENABLED");
      } catch {
        if (!disposed) setState("DISABLED");
      }
    })();
    return () => {
      disposed = true;
    };
  }, [available]);

  if (!available || state === "CHECKING") return null;

  async function enable() {
    setState("ENABLING");
    setMessage("");
    try {
      const result = await enablePushNotifications(DEFAULT_PREFERENCES);
      if (!result.subscription) {
        setState("DENIED");
        return;
      }
      setPreferences(DEFAULT_PREFERENCES);
      setSubscription(result.subscription);
      setState("ENABLED");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Notifications could not be enabled.");
      setState("DISABLED");
    }
  }

  async function disable() {
    if (!subscription) return;
    setMessage("");
    try {
      await disablePushNotifications(subscription);
    } catch {
      // The browser subscription is still removed in a finally block. Any
      // stale server record is discarded after its push endpoint returns 410.
    }
    setSubscription(undefined);
    setState("DISABLED");
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

  async function testLocally() {
    setMessage("");
    try {
      await showLocalTestNotification();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The test notification could not be shown.");
    }
  }

  return (
    <section className="notification-settings" aria-labelledby="notification-settings-title">
      <div className="notification-settings__identity">
        {state === "ENABLED" ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
        <div>
          <strong id="notification-settings-title">Mets alerts</strong>
          <span>
            {state === "ENABLED"
              ? "Notifications are on."
              : state === "DENIED"
                ? "Allow notifications in system settings to turn on alerts."
                : "Get home run and win alerts when the app is closed."}
          </span>
        </div>
      </div>

      {state === "ENABLED" ? (
        <div className="notification-settings__controls">
          <label>
            <input
              type="checkbox"
              checked={preferences.homeRuns}
              onChange={(event) => void setPreference("homeRuns", event.currentTarget.checked)}
            />
            <span>Home runs</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={preferences.metsWins}
              onChange={(event) => void setPreference("metsWins", event.currentTarget.checked)}
            />
            <span>Mets wins</span>
          </label>
          <button className="notification-settings__off" type="button" onClick={() => void disable()}>
            Turn off
          </button>
        </div>
      ) : (
        state !== "DENIED" && (
          <button type="button" disabled={state === "ENABLING"} onClick={() => void enable()}>
            <Bell aria-hidden="true" />
            {state === "ENABLING" ? "Enabling…" : "Enable notifications"}
          </button>
        )
      )}

      {import.meta.env.DEV && (
        <button className="notification-settings__test" type="button" onClick={() => void testLocally()}>
          Send test notification
        </button>
      )}
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
    </section>
  );
}
