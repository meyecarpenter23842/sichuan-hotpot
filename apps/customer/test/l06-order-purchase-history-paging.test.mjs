import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const controller = read("../../api/src/orders/orders.controller.ts");
const service = read("../../api/src/orders/orders.service.ts");
const orders = read("../src/screens/OrdersScreen.tsx");
const purchases = read("../src/screens/PurchasedProductsScreen.tsx");

test("L06 customer page endpoint is additive, validated and owns scoped cursor", () => {
  assert.match(controller, /@Get\("pages"\)/);
  assert.ok(controller.indexOf('@Get("pages")') < controller.indexOf('@Get(":orderId")'));
  assert.match(service, /async listPage\(/);
  assert.match(service, /where: \{ \.\.\.scope, id: cursorId \}/);
  assert.match(service, /INVALID_ORDER_PAGE_CURSOR/);
  assert.match(service, /createdAt: \{ lt: cursor\.createdAt \}/);
  assert.match(controller, /limit > 50/);
});

test("L06 order history supports older pages and dedupes websocket refreshes", () => {
  assert.match(orders, /\/customer\/orders\/pages\?limit=25/);
  assert.match(orders, /function|const loadMore = useCallback/);
  assert.match(orders, /Xem thêm đơn hàng cũ/);
  assert.match(orders, /new Set\(previous\.map\(order => order\.id\)\)/);
  assert.match(orders, /\.\.\.previous\.filter\(item => !page\.items\.some/);
  assert.match(orders, /activeToken\.current !== accessToken/);
});

test("L06 purchased products paginate delivered-only orders with bounded requests", () => {
  assert.match(purchases, /\/customer\/orders\/pages\?delivered=1&limit=20/);
  assert.match(purchases, /offset \+= 3/);
  assert.match(purchases, /Xem thêm món đã mua/);
  assert.match(purchases, /uniquePurchases\(combined\)/);
  assert.match(purchases, /canReorderDeliveredOrder/);
  assert.doesNotMatch(purchases, /\.filter\(order => order\.status === "DELIVERED"\)\.slice\(0, 20\)/);
});
