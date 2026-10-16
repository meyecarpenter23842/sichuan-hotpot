import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../App.tsx");
const checkout = read("../src/screens/CheckoutPanel.tsx");
const api = read("../src/api.ts");
const realtime = read("../src/order-realtime.ts");

test("closed store remains browseable; checkout popup preserves cart", () => {
  assert.match(api, /isActive: boolean/);
  assert.match(app, /branchActive=\{menu\?\.isActive \?\? false\}/);
  assert.match(checkout, /if \(!branchActive\) \{ setClosedPopup\(true\); return; \}/);
  assert.match(checkout, /Quán hiện đã nghỉ/);
  assert.match(checkout, /giỏ hàng/);
});
test("adding a product continues shopping in menu instead of forcing checkout", () => {
  const start = app.indexOf("function addSelectedProduct()");
  const end = app.indexOf("const products =", start);
  assert.ok(start > -1 && end > start);
  const action = app.slice(start,end);
  assert.match(action, /setScreen\("menu"\)/);
  assert.doesNotMatch(action, /setScreen\("cart"\)/);
});
test("websocket teardown does not close a pending handshake", () => {
  assert.match(realtime, /pending\.readyState === WebSocket\.CONNECTING/);
  assert.match(realtime, /pending\.onopen = \(\) => pending\.close\(\)/);
  assert.doesNotMatch(realtime, /socket\.onerror = \(\) => socket\?\.close\(\)/);
});

test("size is a single horizontal strip, mandatory groups come before optional toppings",()=>{
  assert.match(app,/contentContainerStyle=\{styles\.sizeStrip\}/);
  assert.match(app,/horizontal showsHorizontalScrollIndicator=\{false\}/);
  assert.match(app,/Number\(b\.minSelect>0\)-Number\(a\.minSelect>0\)/);
  assert.match(app,/styles\.choiceWrap/);
  assert.match(app,/styles\.requiredTile/);
});
test("cart exposes each real topping with per-portion quantity and server-repriced subtotal",()=>{
  assert.match(app,/function changeCartTopping\(/);
  assert.match(app,/replaceCartLineSelection\(cart,line\.key/);
  assert.match(app,/cartModifierCount\(line\.selection,option\.id\)/);
  assert.match(app,/accessibilityLabel=\{"Thêm topping "\+option\.name\}/);
  assert.match(app,/accessibilityLabel=\{"Bớt topping "\+option\.name\}/);
  assert.match(app,/unit\*line\.quantity/);
  assert.match(checkout,/checkoutCartItems\(cart\)/);
  assert.doesNotMatch(checkout,/modifierPriceVnd\s*:/);
});
