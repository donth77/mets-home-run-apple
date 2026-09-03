import { handleNotificationApi, type NotificationApiContext } from "@apple/notification-worker/api";

export function onRequest(context: NotificationApiContext) {
  return handleNotificationApi(context);
}
