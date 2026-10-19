import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const app = read("../App.tsx");
const dialog = read("../src/components/CustomerNotificationSettings.tsx");
const native = read("../src/push-client.native.ts");
const web = read("../src/push-client.web.ts");

test("Customer account opens notification popup rather than rendering diagnostics", () => {
  assert.match(app, /<CustomerNotificationSettings accessToken={accessToken}/);
  assert.doesNotMatch(app, /<NotificationTester accessToken={accessToken}/);
  assert.match(dialog, /<Modal visible={open}/);
  assert.match(dialog, /Bật thông báo/);
  assert.match(dialog, /onRequestClose={close}/);
  assert.match(dialog, /quán xác nhận hoặc hủy đơn, và khi đơn bắt đầu giao/);
  assert.doesNotMatch(dialog, /FCM token|Firebase|Test đầy đủ|WebSocket|Switch/);
});

test("Home bell navigates to orders; popup uses original enable action", () => {
  assert.match(app, /accessibilityLabel="Xem đơn hàng và cập nhật trạng thái"/);
  assert.doesNotMatch(app, /enableCustomerPush\(accessToken\)/);
  assert.match(dialog, /await enableCustomerPush\(accessToken\)/);
  assert.match(dialog, /disabled={busy}/);
});

test("Keep native and PWA push registration, receipt and logout unchanged", () => {
  assert.match(native, /await registerNative\(accessToken, true\)/);
  assert.match(native, /await registerNative\(accessToken, false\)/);
  assert.match(native, /export async function disableCustomerPush/);
  assert.match(web, /await registerWeb\(accessToken, true\)/);
  assert.match(web, /await registerWeb\(accessToken, false\)/);
  assert.match(web, /export async function disableCustomerPush/);
  assert.doesNotMatch(native + web, /mayRefreshCustomerPush|setCustomerPushEnabled|queueCustomerPushWork/);
});
