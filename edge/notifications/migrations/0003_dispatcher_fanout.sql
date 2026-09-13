-- Fan-out moved to the dispatcher Durable Objects, which walk subscriptions
-- with a cursor instead of a row per delivery.
DROP TABLE notification_deliveries;
