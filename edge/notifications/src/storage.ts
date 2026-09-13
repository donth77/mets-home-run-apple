import type { IdRange } from "./shards";
import type {
  BrowserPushSubscription,
  NotificationPreferences,
  StoredSubscription,
  VerifiedNotificationEvent,
} from "./types";

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  home_runs_since: number | null;
  mets_wins_since: number | null;
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
    const result = await this.#eventInsert(event, nowMs, false).run();
    return (result.meta.changes ?? 0) > 0;
  }

  /**
   * Subscriptions that opted into `kind` before the event, within one id
   * range, after a cursor, in id order. The dispatcher pages through these.
   */
  async subscriptionsInRange(
    kind: VerifiedNotificationEvent["kind"],
    occurredAt: number,
    range: IdRange,
    afterId: string,
    limit: number,
  ): Promise<readonly StoredSubscription[]> {
    const preferenceColumn = kind === "METS_WIN" ? "mets_wins_since" : "home_runs_since";
    const rows = await this.#db
      .prepare(
        `SELECT id, endpoint, p256dh, auth
         FROM notification_subscriptions
         WHERE id >= ? AND id < ? AND id > ?
           AND ${preferenceColumn} IS NOT NULL AND ${preferenceColumn} <= ?
         ORDER BY id
         LIMIT ?`,
      )
      .bind(range.from, range.to, afterId, occurredAt, limit)
      .all<Pick<SubscriptionRow, "id" | "endpoint" | "p256dh" | "auth">>();
    return rows.results.map((row) => ({
      id: row.id,
      endpoint: row.endpoint,
      expirationTime: null,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }));
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
