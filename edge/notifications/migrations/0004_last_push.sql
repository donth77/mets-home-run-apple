-- What the dispatcher last did for each device, so the app can show it and a
-- missing notification can be traced without the dashboard.
ALTER TABLE notification_subscriptions ADD COLUMN last_push_at INTEGER;
ALTER TABLE notification_subscriptions ADD COLUMN last_push_key TEXT;
ALTER TABLE notification_subscriptions ADD COLUMN last_push_outcome TEXT;
ALTER TABLE notification_subscriptions ADD COLUMN last_push_status INTEGER;
