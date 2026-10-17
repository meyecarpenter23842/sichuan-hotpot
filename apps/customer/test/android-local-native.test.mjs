import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appJson = readFileSync(new URL("../app.json", import.meta.url), "utf8");
const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
const prebuild = readFileSync(new URL("../scripts/prebuild-android.mjs", import.meta.url), "utf8");
const nativePush = readFileSync(new URL("../src/push-client.native.ts", import.meta.url), "utf8");

test("local Android prebuild does not require Firebase or Google Maps config", () => {
  assert.doesNotMatch(appJson, /googleServicesFile/);
  assert.doesNotMatch(appJson, /googleMaps|GOOGLE_MAPS_ANDROID_KEY|mapsApiKey/i);
  assert.match(
    packageJson,
    /"android:prebuild": "npm run icons:generate && node scripts\/prebuild-android\.mjs"/,
  );
});

test("prebuild enables FCM only when the gitignored descriptor exists", () => {
  assert.match(prebuild, /existsSync\(googleServicesPath\)/);
  assert.match(prebuild, /buildConfig\.expo\.android\.googleServicesFile = "\.\/google-services\.json"/);
  assert.match(prebuild, /writeFileSync\(appJsonPath, originalText\)/);
  assert.match(prebuild, /spawnSync\(\s*process\.execPath/);
  assert.match(prebuild, /node_modules", "expo", "bin", "cli"/);
  assert.doesNotMatch(prebuild, /npx\.cmd|process\.platform === "win32"/);
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
