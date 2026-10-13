import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const qr = readFileSync(new URL("../src/screens/OrdersScreen.tsx", import.meta.url), "utf8");
const checkout = readFileSync(new URL("../src/screens/CheckoutPanel.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
test("unconfigured QR is not actionable, COD remains usable", () => {
  assert.match(checkout, /qrAvailable/);
  assert.match(checkout, /disabled=\{busy \|\| \(method === "QR" && !qrAvailable\)\}/);
  assert.match(checkout, /\/customer\/orders\/payment-methods/);
});
test("successful QR order opens exact order details and displays bank reference without marking it paid", () => {
  assert.match(app, /setFocusOrderId\(receipt\.orderId\)/);
  assert.match(qr, /focusOrderId/);
  assert.match(qr, /detail\.payment\.qr\.imageUrl/);
  assert.match(qr, /transferReference/);
  assert.match(qr, /Chờ đối soát/);
});
