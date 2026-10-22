/* Scoped Retail PWA push: only generic safe staff hints; never display private ticket content. */
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { return; }
  if (data.kind !== "DINING_PENDING") return;
  event.waitUntil(self.registration.showNotification("Yêu cầu gọi món QR", {
    body: "Có yêu cầu tại bàn đang chờ nhân viên duyệt.",
    tag: "hotpot-retail-qr", renotify: true,
    data: { url: typeof data.url === "string" && /^\/\?notification=dining&ticket=[0-9a-f-]{36}$/i.test(data.url)
      ? data.url : "/?notification=dining" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = event.notification.data?.url || "/?notification=dining";
    const dest = new URL(url, self.registration.scope).href;
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const page of pages) {
      if (new URL(page.url).origin === new URL(dest).origin) {
        await page.navigate(dest); await page.focus(); return;
      }
    }
    await self.clients.openWindow(dest);
  })());
});
