import { Bell, BellOff } from "lucide-react";
import { type LastPush, pushNotificationsSupported } from "./notificationClient";
import { isStandalonePwa } from "./PwaInstallPrompt";
import type { NotificationSubscription } from "./useNotificationSubscription";

interface NotificationSettingsProps {
  notifications: NotificationSubscription;
}

function describeLastPush(lastPush: LastPush | null) {
  if (!lastPush) return "No notifications have been sent to this device yet.";
  const when = new Date(lastPush.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const what = lastPush.eventKey.startsWith("test:") ? "test notification" : "notification";
  switch (lastPush.outcome) {
    case "DELIVERED":
      return `Last ${what} sent ${when}.`;
    case "EXPIRED_SUBSCRIPTION":
      return `The ${what} from ${when} could not be delivered. Turn notifications off and on again on this device.`;
    case "PERMANENT_FAILURE":
      return `The ${what} from ${when} could not be delivered.`;
    default:
      return `The ${what} from ${when} is still being retried.`;
  }
}

/**
 * The phone's notification card: separate switches for home runs and Mets
 * wins, and a record of the last notification. Phones only get push once the
 * site is installed, so the card waits for that. Desktop uses the toolbar
 * bell instead.
 */
export function NotificationSettings({ notifications }: NotificationSettingsProps) {
  // The server-side test push is a debugging tool: a dev build, or a page
  // opened with ?diag=1 while the server has the route switched on.
  const debugging = import.meta.env.DEV || new URLSearchParams(window.location.search).has("diag");
  const available = isStandalonePwa() && pushNotificationsSupported();
  const { state, preferences, lastPush, message, enable, disable, setPreference, testPush, testLocally } = notifications;

  if (!available || state === "CHECKING") return null;

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

      {state === "ENABLED" && debugging && (
        <button className="notification-settings__test" type="button" onClick={() => void testPush()}>
          Send test notification
        </button>
      )}
      {state === "ENABLED" && <p className="notification-settings__last">{describeLastPush(lastPush)}</p>}
      {import.meta.env.DEV && (
        <button className="notification-settings__test" type="button" onClick={() => void testLocally()}>
          Show a sample notification
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
