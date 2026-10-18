import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
test("Admin settings exposes FCM push and local notification audio tests", () => {
  const settings = read("../src/SettingsHub.tsx");
  const tester = read("../src/NotificationTester.tsx");
  const native = read("../src/push-client.native.ts");
  const app = read("../App.tsx");
  assert.match(settings, /<NotificationTester token={token} branchId={branch.id}/);
  assert.match(tester, /adminTestLocalSound/);
  assert.match(tester, /adminTestRemotePush/);
  assert.match(tester, /Date.now\(\) - lastPush.current < 30000/);
  assert.match(native, /sound: "new_order_alert.mp3"/);
  assert.match(native, /scheduleNotificationAsync/);
  assert.match(native, /kind === "TEST"/);
  assert.match(app, /disableAdminPush\(old\)/);
});
