import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const fee = read("../src/DeliveryPolicyPanel.tsx");
const nativePush = read("../src/push-client.native.ts");
const soundPlugin = read("../plugins/with-order-sound.cjs");
const ws = read("../src/order-realtime.ts");

test("owner zone pricing is editable inside the delivery settings overlay", () => {
  assert.match(fee, /Phí giao theo khu vực/);
  assert.match(fee, /pricingMode: "ZONE"/);
  assert.match(fee, /catalogVersion/);
  assert.match(fee, /wardCodes/);
  assert.match(fee, /ZONE/);
  assert.match(fee, /setZones/);
  assert.match(fee, /normalize\(current\)/);
  assert.doesNotMatch(fee, /Phụ thu theo quãng đường/);
});

test("Android Admin uses approved packaged long-sound channel; websocket cleanup remains safe", () => {
  assert.match(nativePush, /setNotificationChannelAsync\("new-orders-v2"/);
  assert.match(nativePush, /sound: "new_order_alert\.mp3"/);
  assert.match(nativePush, /AndroidImportance\.MAX/);
  assert.match(soundPlugin, /sound-native-android\.mp3/);
  assert.match(soundPlugin, /new_order_alert\.mp3/);
  assert.match(ws, /pending\.readyState === WebSocket\.CONNECTING/);
});
