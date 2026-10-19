import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");

const app = read("../App.tsx");
const dialog = read("../src/components/CustomerNotificationSettings.tsx");
const pref = read("../src/push-preference.ts");
const native = read("../src/push-client.native.ts");
const web = read("../src/push-client.web.ts");

test("account notification settings opens on demand without customer diagnostics", () => {
  assert.match(app, /<CustomerNotificationSettings accessToken={accessToken}/);
  assert.doesNotMatch(app, /<NotificationTester accessToken={accessToken}/);
  assert.match(dialog, /<Modal visible={open}/);
  assert.match(dialog, /Nhận thông báo/);
  assert.match(dialog, /<Switch/);
  assert.match(dialog, /disabled={busy \|\| !settings\?\.available}/);
  assert.match(dialog, /quán xác nhận hoặc hủy đơn, và khi đơn bắt đầu giao/);
  assert.doesNotMatch(dialog, /FCM token|Firebase|Test đầy đủ|WebSocket/);
});

test("home bell only opens orders and does not silently request push permission", () => {
  assert.match(app, /accessibilityLabel="Xem đơn hàng và cập nhật trạng thái"/);
  assert.doesNotMatch(app, /enableCustomerPush\(accessToken\)/);
  assert.match(dialog, /setCustomerPushEnabled\(accessToken, enabled\)/);
});

test("Android opt-out persists through logout and background refresh is serialized", () => {
  assert.match(pref, /PUSH_CHOICE_KEY/);
  assert.match(pref, /"disabled"/);
  assert.match(pref, /pendingPushWork\.then\(action, action\)/);
  assert.match(native, /if \(await mayRefreshCustomerPush\(\)\) await registerNative\(accessToken, false\)/);
  assert.match(native, /await unregisterNative\(accessToken\);\s*await saveCustomerPushChoice\(false\)/);
  assert.match(native, /queueCustomerPushWork\(\(\) => unregisterNative\(accessToken\)\)/);
  assert.match(native, /await saveCustomerPushChoice\(true\)/);
});

test("iPhone PWA opt-out stops automatic re-subscription and the browser subscription is removed", () => {
  assert.match(web, /if \(await mayRefreshCustomerPush\(\)\) await registerWeb\(accessToken, false\)/);
  assert.match(web, /await unregisterWeb\(accessToken\);\s*await saveCustomerPushChoice\(false\)/);
  assert.match(web, /await subscription\.unsubscribe\(\)/);
  assert.match(web, /await queueCustomerPushWork\(\(\) => unregisterWeb\(accessToken\)\)/);
  assert.match(web, /webPushSupportError\(\)/);
});
