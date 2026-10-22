import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const src = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
test("Android-only FCM adapter uses native channel/token, never a ServiceWorker", () => {
  const native = src("src/dining-push.native.ts");
  assert.match(native, /Notifications\.getDevicePushTokenAsync/);
  assert.match(native, /transport: "FCM"/);
  assert.match(native, /scope: "STAFF"/);
  assert.match(native, /setNotificationChannelAsync/);
  assert.match(native, /scheduleNotificationAsync/);
  assert.match(native, /subscriptions\/remove/);
  assert.doesNotMatch(native, /serviceWorker|PushManager|AudioContext/);
});
test("Native QR test uses local device sound, independent of orders", () => {
  const audio = src("src/dining-alert.native.ts");
  const notification = src("src/dining-push.native.ts");
  assert.match(audio, /testRetailNativeSound/);
  assert.match(notification, /kind: "RETAIL_SOUND_TEST"/);
  assert.match(notification, /new_order_alert\.mp3/);
  assert.match(notification, /CHANNEL_ID = "new-orders-v3"/);
});
test("Native receipt supports Android share without web window.print", () => {
  const native = src("src/dining-receipt.native.ts");
  assert.match(native, /Share\.share/);
  assert.doesNotMatch(native, /window\.|document\.|print\(/);
  assert.match(src("src/RetailSettlementPanel.tsx"), /Chia sẻ hóa đơn/);
});
