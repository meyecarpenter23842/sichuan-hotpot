import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
test("customer app keeps FCM diagnostics internal, separate from the account settings", () => {
  const app = read("../App.tsx");
  const tester = read("../src/components/NotificationTester.tsx");
  const native = read("../src/push-client.native.ts");
  assert.match(app, /<CustomerNotificationSettings accessToken={accessToken}/);
  assert.doesNotMatch(app, /<NotificationTester accessToken={accessToken}/);
  assert.match(app, /disableCustomerPush\(token\)/);
  assert.match(tester, /customerTestRemotePush/);
  assert.match(tester, /customerTestLocalSound/);
  assert.match(tester, /CHƯA xác nhận/);
  assert.match(native, /scheduleNotificationAsync/);
  assert.match(native, /POST", accessToken, body: \{ token: deviceToken, delaySeconds \}/);
  assert.doesNotMatch(native, /\/orders\/create/);
});

test("Customer Android shows provider failure and polls server receipt on app resume", () => {
  const tester = read("../src/components/NotificationTester.tsx");
  const native = read("../src/push-client.native.ts");
  assert.match(tester, /customerPushRemoteTestStatus/);
  assert.match(tester, /AppState.addEventListener/);
  assert.match(tester, /result.status === "failed"/);
  assert.match(native, /"\/push\/test\/status"/);
});
