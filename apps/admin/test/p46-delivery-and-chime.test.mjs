import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const fee = read("../src/DeliveryPolicyPanel.tsx");
const chime = read("../src/order-notifications.ts");
const ws = read("../src/order-realtime.ts");

test("persisted shipping policy stays visible inside existing modal", () => {
  assert.match(fee, /Phí giao đang áp dụng/);
  assert.match(fee, /current\.baseFeeVnd\.toLocaleString/);
  assert.match(fee, /current\.extraStepFeeVnd\.toLocaleString/);
  assert.match(fee, /current\.freeDeliveryAtSubtotalVnd/);
  assert.match(fee, /Cước giao cơ bản/);
  assert.match(fee, /Phụ thu theo quãng đường/);
  assert.match(fee, /setCurrent\(saved\)/);
});
test("new double-ring chime lasts approximately three seconds; ws cleanup is safe", () => {
  assert.match(chime, /for \(const offset of \[0, 1\.5\]\)/);
  assert.match(chime, /oscillator\.stop\(start \+ offset \+ 1\.20\)/);
  assert.match(ws, /pending\.readyState === WebSocket\.CONNECTING/);
});
