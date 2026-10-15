import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const fee = read("../src/DeliveryPolicyPanel.tsx");
const chime = read("../src/order-notifications.ts");
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
test("new double-ring chime lasts approximately three seconds; ws cleanup is safe", () => {
  assert.match(chime, /for \(const offset of \[0, 1\.5\]\)/);
  assert.match(chime, /oscillator\.stop\(start \+ offset \+ 1\.20\)/);
  assert.match(ws, /pending\.readyState === WebSocket\.CONNECTING/);
});
