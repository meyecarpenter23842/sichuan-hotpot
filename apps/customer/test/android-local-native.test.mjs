import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appConfig = readFileSync(new URL("../app.config.js", import.meta.url), "utf8");
const nativePush = readFileSync(new URL("../src/push-client.native.ts", import.meta.url), "utf8");

test("local Android config makes Firebase descriptor optional", () => {
  assert.match(appConfig, /existsSync\(firebaseDescriptor\)/);
  assert.match(appConfig, /delete android\.googleServicesFile/);
  assert.match(appConfig, /android\.googleServicesFile = "\.\/google-services\.json"/);
  assert.doesNotMatch(appConfig, /GOOGLE_MAPS_ANDROID_KEY/);
  assert.match(appConfig, /Do not reintroduce Google Maps config/);
});

test("stale native push module cannot crash customer app during module import", () => {
  assert.doesNotMatch(nativePush, /^import \* as Notifications from "expo-notifications";/m);
  assert.match(nativePush, /import\("expo-notifications"\)\.catch\(\(\) => null\)/);
  assert.match(nativePush, /const Notifications = await loadNotifications\(false\);/);
  assert.match(nativePush, /if \(!Notifications\) return \(\) => undefined;/);
});

test("explicit push opt-in still fails visibly when native module is unavailable", () => {
  assert.match(nativePush, /loadNotifications\(askPermission\)/);
  assert.match(nativePush, /if \(!Notifications && required\)/);
  assert.match(nativePush, /Hãy rebuild ứng dụng Android rồi thử lại/);
});
