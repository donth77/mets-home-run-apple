import type {
  BrowserPushSubscription,
  NotificationPreferences,
  PendingDelivery,
  VerifiedNotificationEvent,
} from "./types";

const DELIVERY_LEASE_MS = 60_000;
const DELIVERY_MAX_AGE_MS = 10 * 60_000;

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  home_runs_since: number | null;
  mets_wins_since: number | null;
}

interface DeliveryRow extends SubscriptionRow {
  event_key: string;
  game_pk: number;
  kind: VerifiedNotificationEvent["kind"];
  subject: string;
  title: string;
  body: string;
  target_url: string;
  occurred_at: number;
  attempts: number;
}

export interface StoredGameState {
  exists: boolean;
  finalized: boolean;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function subscriptionId(endpoint: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return bytesToBase64Url(new Uint8Array(digest));
}

export class NotificationStore {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async saveSubscription(
    subscription: BrowserPushSubscription,
    preferences: NotificationPreferences,
    nowMs: number,
  ): Promise<void> {
    const id = await subscriptionId(subscription.endpoint);
    await this.#db
      .prepare(
        `INSERT INTO notification_subscriptions (
           id, endpoint, p256dh, auth, home_runs_since, mets_wins_since, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           endpoint = excluded.endpoint,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           home_runs_since = CASE
             WHEN excluded.home_runs_since IS NULL THEN NULL
             WHEN notification_subscriptions.home_runs_since IS NULL THEN excluded.home_runs_since
             ELSE notification_subscriptions.home_runs_since
           END,
           mets_wins_since = CASE
             WHEN excluded.mets_wins_since IS NULL THEN NULL
             WHEN notification_subscriptions.mets_wins_since IS NULL THEN excluded.mets_wins_since
             ELSE notification_subscriptions.mets_wins_since
           END,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        preferences.homeRuns ? nowMs : null,
        preferences.metsWins ? nowMs : null,
        nowMs,
        nowMs,
      )
      .run();
  }

  async preferences(endpoint: string): Promise<NotificationPreferences | undefined> {
    const id = await subscriptionId(endpoint);
    const row = await this.#db
      .prepare("SELECT home_runs_since, mets_wins_since FROM notification_subscriptions WHERE id = ?")
      .bind(id)
      .first<Pick<SubscriptionRow, "home_runs_since" | "mets_wins_since">>();
    return row ? { homeRuns: row.home_runs_since !== null, metsWins: row.mets_wins_since !== null } : undefined;
  }

  async removeSubscription(endpoint: string): Promise<void> {
    const id = await subscriptionId(endpoint);
    await this.#db.prepare("DELETE FROM notification_subscriptions WHERE id = ?").bind(id).run();
  }

  async gameState(gamePk: number): Promise<StoredGameState> {
    const row = await this.#db
      .prepare("SELECT game_pk, finalized_at FROM notification_games WHERE game_pk = ?")
      .bind(gamePk)
      .first<{ game_pk: number; finalized_at: number | null }>();
    return { exists: row !== null, finalized: row?.finalized_at !== null && row?.finalized_at !== undefined };
  }

  async knownEventKeys(gamePk: number): Promise<ReadonlySet<string>> {
    const rows = await this.#db
      .prepare("SELECT event_key FROM notification_events WHERE game_pk = ?")
      .bind(gamePk)
      .all<{ event_key: string }>();
    return new Set(rows.results.map(({ event_key }) => event_key));
  }

  async initializeGame(
    gamePk: number,
    baseline: readonly VerifiedNotificationEvent[],
    nowMs: number,
  ): Promise<boolean> {
    const statements = [
      this.#db
        .prepare("INSERT OR IGNORE INTO notification_games (game_pk, initialized_at) VALUES (?, ?)")
        .bind(gamePk, nowMs),
      ...baseline.map((event) => this.#eventInsert(event, nowMs, true)),
    ];
    const [gameResult] = await this.#db.batch(statements);
    return (gameResult.meta.changes ?? 0) > 0;
  }

  async markGameFinal(gamePk: number, nowMs: number): Promise<void> {
    await this.#db
      .prepare("UPDATE notification_games SET finalized_at = COALESCE(finalized_at, ?) WHERE game_pk = ?")
      .bind(nowMs, gamePk)
      .run();
  }

  async recordEvent(event: VerifiedNotificationEvent, nowMs: number): Promise<boolean> {
    const preferenceColumn = event.kind === "METS_WIN" ? "mets_wins_since" : "home_runs_since";
    const [eventResult] = await this.#db.batch([
      this.#eventInsert(event, nowMs, false),
      this.#db
        .prepare(
          `INSERT OR IGNORE INTO notification_deliveries (
             event_key, subscription_id, status, attempts, next_attempt_at
           )
           SELECT ?, id, 'PENDING', 0, ?
           FROM notification_subscriptions
           WHERE ${preferenceColumn} IS NOT NULL AND ${preferenceColumn} <= ?`,
        )
        .bind(event.eventKey, nowMs, event.occurredAt),
    ]);
    return (eventResult.meta.changes ?? 0) > 0;
  }

  async claimDueDeliveries(nowMs: number, limit = 32): Promise<readonly PendingDelivery[]> {
    await this.#db
      .prepare(
        `UPDATE notification_deliveries
         SET status = 'RETRY', lease_until = NULL
         WHERE status = 'SENDING' AND lease_until < ?`,
      )
      .bind(nowMs)
      .run();

    await this.#db
      .prepare(
        `UPDATE notification_deliveries
         SET status = 'EXPIRED', lease_until = NULL
         WHERE status IN ('PENDING', 'RETRY')
           AND event_key IN (SELECT event_key FROM notification_events WHERE occurred_at < ?)`,
      )
      .bind(nowMs - DELIVERY_MAX_AGE_MS)
      .run();

    const due = await this.#db
      .prepare(
        `SELECT
           d.event_key, d.attempts,
           e.game_pk, e.kind, e.subject, e.title, e.body, e.target_url, e.occurred_at,
           s.id, s.endpoint, s.p256dh, s.auth, s.home_runs_since, s.mets_wins_since
         FROM notification_deliveries d
         JOIN notification_events e ON e.event_key = d.event_key
         JOIN notification_subscriptions s ON s.id = d.subscription_id
         WHERE d.status IN ('PENDING', 'RETRY') AND d.next_attempt_at <= ?
         ORDER BY e.occurred_at, d.subscription_id
         LIMIT ?`,
      )
      .bind(nowMs, limit)
      .all<DeliveryRow>();

    const claimed: PendingDelivery[] = [];
    for (const row of due.results) {
      const result = await this.#db
        .prepare(
          `UPDATE notification_deliveries
           SET status = 'SENDING', lease_until = ?, attempts = attempts + 1
           WHERE event_key = ? AND subscription_id = ?
             AND status IN ('PENDING', 'RETRY') AND next_attempt_at <= ?`,
        )
        .bind(nowMs + DELIVERY_LEASE_MS, row.event_key, row.id, nowMs)
        .run();
      if ((result.meta.changes ?? 0) === 0) continue;
      claimed.push({
        attempts: row.attempts + 1,
        event: {
          eventKey: row.event_key,
          gamePk: row.game_pk,
          kind: row.kind,
          subject: row.subject,
          title: row.title,
          body: row.body,
          targetUrl: row.target_url,
          occurredAt: row.occurred_at,
        },
        subscription: {
          id: row.id,
          endpoint: row.endpoint,
          expirationTime: null,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
      });
    }
    return claimed;
  }

  async markDelivered(eventKey: string, subscriptionIdValue: string, nowMs: number, status: number): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE notification_deliveries
         SET status = 'SENT', sent_at = ?, lease_until = NULL, last_status = ?
         WHERE event_key = ? AND subscription_id = ?`,
      )
      .bind(nowMs, status, eventKey, subscriptionIdValue)
      .run();
  }

  async markDeliveryFailed(
    eventKey: string,
    subscriptionIdValue: string,
    nowMs: number,
    status: number,
    retryDelayMs: number,
  ): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE notification_deliveries
         SET status = 'RETRY', next_attempt_at = ?, lease_until = NULL, last_status = ?
         WHERE event_key = ? AND subscription_id = ?`,
      )
      .bind(nowMs + retryDelayMs, status, eventKey, subscriptionIdValue)
      .run();
  }

  async markDeliveryExpired(eventKey: string, subscriptionIdValue: string, status: number): Promise<void> {
    await this.#db
      .prepare(
        `UPDATE notification_deliveries
         SET status = 'EXPIRED', lease_until = NULL, last_status = ?
         WHERE event_key = ? AND subscription_id = ?`,
      )
      .bind(status, eventKey, subscriptionIdValue)
      .run();
  }

  async removeExpiredSubscription(subscriptionIdValue: string): Promise<void> {
    await this.#db.prepare("DELETE FROM notification_subscriptions WHERE id = ?").bind(subscriptionIdValue).run();
  }

  #eventInsert(event: VerifiedNotificationEvent, detectedAt: number, baseline: boolean) {
    return this.#db
      .prepare(
        `INSERT OR IGNORE INTO notification_events (
           event_key, game_pk, kind, subject, title, body, target_url, occurred_at, detected_at, baseline
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.eventKey,
        event.gamePk,
        event.kind,
        event.subject,
        event.title,
        event.body,
        event.targetUrl,
        event.occurredAt,
        detectedAt,
        baseline ? 1 : 0,
      );
  }
}
