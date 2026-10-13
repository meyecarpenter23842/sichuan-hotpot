import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const checkout = readFileSync(new URL("../src/screens/CheckoutPanel.tsx", import.meta.url), "utf8");
const orders = readFileSync(new URL("../src/screens/OrdersScreen.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("server quote and checkout must use selected persisted address, server amounts and retry key", () => {
  assert.match(checkout, /\/customer\/delivery\/quote/);
  assert.match(checkout, /\/customer\/orders/);
  assert.match(checkout, /checkoutCartItems/);
  assert.match(checkout, /quote\.totalVnd/);
  assert.match(checkout, /pending\.idempotencyKey/);
  assert.match(checkout, /lock\.current = true/);
  assert.match(checkout, /AsyncStorage\.setItem\(PENDING_KEY/);
  assert.match(app, /setSelectedAddressId\(created\.id\)/);
  assert.doesNotMatch(app, /Đặt hàng \(chưa khả dụng\)/);
});
test("orders have live history, timeline and safe reorder without silently substituting modifiers", () => {
  assert.match(orders, /\/customer\/orders\//);
  assert.match(orders, /statusHistory/);
  assert.match(orders, /onReorder\(detail\)/);
  assert.match(app, /matches\.length !== 1/);
  assert.match(app, /optionSelectionError\(product\.modifierGroups, modifierIds\)/);
});
