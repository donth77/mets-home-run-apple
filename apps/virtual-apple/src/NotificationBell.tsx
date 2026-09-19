import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import { pushNotificationsSupported } from "./notificationClient";
import type { NotificationSubscription } from "./useNotificationSubscription";

const NOTE_VISIBLE_MS = 6_000;

interface NotificationBellProps {
  notifications: NotificationSubscription;
}

/**
 * Desktop's one-tap switch for alerts, in the toolbar under the radio card.
 * One press turns on both home run and Mets win notifications; a second
 * turns them off. Browsers on a desktop allow push from a normal tab, so
 * unlike the phone there is nothing to install first. The state lives in the
 * app, so the bell reads the same whichever view rebuilt the toolbar.
 */
export function NotificationBell({ notifications }: NotificationBellProps) {
  const { state, message, enable, disable } = notifications;
  // A problem is shown under the toolbar briefly; the tooltip keeps it after.
  const [note, setNote] = useState("");
  useEffect(() => {
    setNote(message);
    if (!message) return;
    const timer = window.setTimeout(() => setNote(""), NOTE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!pushNotificationsSupported()) return null;

  // A press shows at once: while the browser and server catch up the bell
  // already reads as on, and only drops back if they refuse.
  const on = state === "ENABLED" || state === "ENABLING";
  const blocked = state === "DENIED";
  const busy = state === "ENABLING";
  const title =
    message ||
    (blocked
      ? "Notifications are blocked for this site in your browser settings"
      : busy
        ? "Turning on notifications…"
        : on
          ? "Notifications on: home runs and Mets wins"
          : "Turn on notifications for home runs and Mets wins");
  const Icon = on ? Bell : BellOff;

  return (
    <>
      <button
        type="button"
        className="view-mode-button view-mode-button--icon"
        aria-label={on ? "Turn notifications off" : "Turn notifications on"}
        aria-pressed={on}
        aria-busy={busy || undefined}
        disabled={blocked}
        onClick={() => {
          if (busy) return;
          void (on ? disable() : enable());
        }}
        title={title}
      >
        <Icon aria-hidden="true" size={18} strokeWidth={2.25} />
      </button>
      {note && (
        <span className="view-mode-note" role="status" aria-live="polite">
          {note}
        </span>
      )}
    </>
  );
}
