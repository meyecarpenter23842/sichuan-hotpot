self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = typeof payload.title === "string" ? payload.title : "Sichuan Hotpot";
  const body = typeof payload.body === "string" ? payload.body : "Có cập nhật đơn hàng.";
  const orderId = typeof payload.orderId === "string" ? payload.orderId : "";
  const kind = typeof payload.kind === "string" ? payload.kind : "ORDER";
  const url = typeof payload.url === "string" && payload.url.startsWith("/")
    ? payload.url : "/";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/icon-192-v20261016d.png",
    badge: "/icon-192-v20261016d.png",
    tag: "hotpot-" + kind + "-" + orderId,
    renotify: false,
    data: { url, orderId, kind },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url : "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if ("focus" in client) {
        if ("navigate" in client) await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
