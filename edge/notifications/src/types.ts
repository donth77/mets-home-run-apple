import type { CoreCelebration } from "@apple/game-core-wasm";
import type { NotificationDispatcher } from "./dispatcher";

/** The dispatcher's last attempt for one device. */
export interface LastPush {
  at: number;
  eventKey: string;
  outcome: "DELIVERED" | "EXPIRED_SUBSCRIPTION" | "PERMANENT_FAILURE" | "RETRY";
  status: number;
}

export interface NotificationPreferences {
  homeRuns: boolean;
  metsWins: boolean;
}

export interface BrowserPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface VerifiedNotificationEvent {
  eventKey: string;
  gamePk: number;
  kind: CoreCelebration;
  subject: string;
  title: string;
  body: string;
  targetUrl: string;
  occurredAt: number;
}

export interface StoredSubscription extends BrowserPushSubscription {
  id: string;
}

export interface PendingDelivery {
  event: VerifiedNotificationEvent;
  subscription: StoredSubscription;
  attempts: number;
}

export interface NotificationEnv {
  NOTIFICATIONS_DB: D1Database;
  DISPATCHER: DurableObjectNamespace<NotificationDispatcher>;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  DISPATCHER_SHARDS?: string;
  PUSHES_PER_HOP?: string;
  DISPATCHER_DAILY_HOP_CAP?: string;
  /** "on" enables the test-push route. Off in production unless a debugging session needs it. */
  NOTIFICATIONS_TEST_PUSH?: string;
}
