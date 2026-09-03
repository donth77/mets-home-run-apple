DROP INDEX notification_events_detected_idx;

CREATE INDEX notification_events_game_idx
  ON notification_events(game_pk);

CREATE INDEX notification_events_occurred_idx
  ON notification_events(occurred_at);
