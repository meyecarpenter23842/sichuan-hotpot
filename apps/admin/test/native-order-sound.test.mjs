import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

const app = JSON.parse(read("../app.json"));
const pushClient = read("../src/push-client.native.ts");
const soundPlugin = read("../plugins/with-order-sound.cjs");
const pushService = read("../../../apps/api/src/push/push.service.ts");
const approvedSound = readFileSync(new URL("../../../sound-native-android.mp3", import.meta.url));

test("Admin Android keeps Firebase credentials out of tracked Expo config", () => {
  assert.equal(app.expo.android.package, "vn.sichuanhotpot.admin");
  assert.equal(app.expo.android.googleServicesFile, undefined);
  assert.ok(app.expo.plugins.includes("./plugins/with-order-sound.cjs"));
});

test("approved long order sound is wired through native channel and FCM payload", () => {
  assert.ok(approvedSound.length > 100_000, "approved order sound must not collapse to a tiny placeholder");
  assert.match(soundPlugin, /sound-native-android\.mp3/);
  assert.match(soundPlugin, /new_order_alert\.mp3/);
  assert.match(pushClient, /ORDER_CHANNEL_ID = "new-orders-v3"/);
  assert.match(pushService, /ADMIN_ORDER_CHANNEL_ID = "new-orders-v3"/);
  assert.match(pushService, /ADMIN_ORDER_SOUND_FILE = "new_order_alert\.mp3"/);
  const config = app.expo.plugins.find(p => Array.isArray(p) && p[0] === "expo-notifications");
  assert.equal(config[1].defaultChannel, undefined,
    "a default channel could steal the custom channel ID before its sound is configured");
  assert.match(pushClient, /setNotificationChannelAsync\(ORDER_CHANNEL_ID/);
  assert.match(pushClient, /ORDER_SOUND_FILE = "new_order_alert\.mp3"/);
  assert.match(pushClient, /AndroidImportance\.MAX/);
  assert.match(pushService, /channel_id: admin \? ADMIN_ORDER_CHANNEL_ID : "customer-orders-v1"/);
  assert.match(pushService, /sound: admin \? ADMIN_ORDER_SOUND_FILE : "default"/);
});

test("foreground notification presentation still delegates sound to the notification channel", () => {
  assert.match(pushClient, /setNotificationHandler/);
  assert.match(pushClient, /shouldPlaySound: true/);
});
