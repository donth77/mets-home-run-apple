CREATE TABLE notification_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  home_runs_since INTEGER,
  mets_wins_since INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE notification_games (
  game_pk INTEGER PRIMARY KEY,
  initialized_at INTEGER NOT NULL,
  finalized_at INTEGER
);

CREATE TABLE notification_events (
  event_key TEXT PRIMARY KEY,
  game_pk INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('HOME_RUN', 'GRAND_SLAM', 'METS_WIN')),
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_url TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  detected_at INTEGER NOT NULL,
  baseline INTEGER NOT NULL DEFAULT 0 CHECK (baseline IN (0, 1))
);

CREATE TABLE notification_deliveries (
  event_key TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'RETRY', 'SENT', 'EXPIRED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER,
  sent_at INTEGER,
  last_status INTEGER,
  PRIMARY KEY (event_key, subscription_id),
  FOREIGN KEY (event_key) REFERENCES notification_events(event_key) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES notification_subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX notification_deliveries_due_idx
  ON notification_deliveries(status, next_attempt_at);

CREATE INDEX notification_events_detected_idx
  ON notification_events(detected_at);
