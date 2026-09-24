const FALLBACK_NOTIFICATION = {
  title: "Virtual Apple",
  body: "There is a new Mets update.",
  eventKey: "virtual-apple-update",
  url: "/",
};

self.addEventListener("push", (event) => {
  let notification = FALLBACK_NOTIFICATION;
  try {
    if (event.data) notification = { ...FALLBACK_NOTIFICATION, ...event.data.json() };
  } catch {
    notification = FALLBACK_NOTIFICATION;
  }

  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      icon: "/pwa-icon-192.png",
      badge: "/pwa-icon-192.png",
      data: { url: notification.url },
      tag: notification.eventKey,
      timestamp: notification.timestamp,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requested = new URL(event.notification.data?.url || "/", self.location.origin);
  const target = requested.origin === self.location.origin ? requested.href : self.location.origin;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const ours = clients.filter((client) => new URL(client.url).origin === self.location.origin);
      // A tab already on the page is live, so bring it forward as it is:
      // reloading it would cut off a celebration and close the Mini Apple.
      const showing = ours.find((client) => new URL(client.url).pathname === new URL(target).pathname);
      if (showing) return showing.focus();
      const existing = ours[0];
      if (existing) {
        if ("navigate" in existing) await existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
