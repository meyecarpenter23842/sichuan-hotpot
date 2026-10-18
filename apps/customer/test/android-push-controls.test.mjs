import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
test("customer account has device-only FCM and audio tests without creating orders", () => {
  const app = read("../App.tsx");
  const tester = read("../src/components/NotificationTester.tsx");
  const native = read("../src/push-client.native.ts");
  assert.match(app, /<NotificationTester accessToken={accessToken}/);
  assert.match(app, /disableCustomerPush\(token\)/);
  assert.match(tester, /customerTestRemotePush/);
  assert.match(tester, /customerTestLocalSound/);
  assert.match(tester, /CHƯA xác nhận/);
  assert.match(native, /scheduleNotificationAsync/);
  assert.match(native, /POST", accessToken, body: \{ token: deviceToken, delaySeconds \}/);
  assert.doesNotMatch(native, /\/orders\/create/);
});
