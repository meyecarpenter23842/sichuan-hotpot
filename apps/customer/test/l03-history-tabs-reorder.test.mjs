import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const app = read("../App.tsx");
const orders = read("../src/screens/OrdersScreen.tsx");
const purchases = read("../src/screens/PurchasedProductsScreen.tsx");

test("L03 two persistent order sub-tabs sit outside content ScrollView", () => {
  const tabs = app.indexOf('styles.orderTabs} accessibilityRole="tablist"');
  const scroll = app.indexOf('<KeyboardAvoidingView style={[styles.body');
  assert.ok(tabs > 0 && tabs < scroll, "sticky tabs must precede scroll container");
  assert.match(app, /\["orders", "Đơn hàng"\]/);
  assert.match(app, /\["purchased", "Món đã mua"\]/);
  assert.match(app, /historyScrollHidden/);
  assert.match(app, /historyScrollActive/);
  assert.match(app, /accessibilityState=\{\{ selected: screen === tab \}\}/);
  assert.match(app, /target === "orders" && screen === "purchased"/);
});

test("L03 order buttons are absent for non-delivered status AND handler blocks all other orders", () => {
  assert.match(orders, /canReorderDeliveredOrder\(detail.status\)/);
  assert.match(app, /if \(!canReorderDeliveredOrder\(order.status\)\)/);
  assert.match(purchases, /if \(!canReorderDeliveredOrder\(purchase.order.status\)\)/);
  assert.match(purchases, /if \(!canReorderDeliveredOrder\(order.status\)\) continue/);
});

test("L03 historical combo options are rendered and never grouped by modifier names only", () => {
  assert.match(purchases, /historicalPurchaseKey\(order.branchId, item\)/);
  assert.match(purchases, /purchase.item.comboItems.map/);
  assert.match(purchases, /component.variantName/);
  assert.match(purchases, /purchase.item.lineTotalVnd/);
  assert.match(purchases, /!purchase.item.productId/);
  assert.match(purchases, /Ngừng bán/);
  assert.match(app, /onOrderEvent=\{notifyPurchaseRevision\}/);
  assert.match(app, /refreshSignal=\{purchaseRevision\}/);
  assert.match(orders, /watchCustomerOrderEvents\(accessToken/);
  assert.match(orders, /onOrderEvent\?\.\(\)/);
});

test("L03 reorder uses current menu prices instead of historical modifier prices", () => {
  const reorder = app.slice(app.indexOf("function reorder(order: CustomerOrderDetail)"),
    app.indexOf("function reorder(order: CustomerOrderDetail)") + 8000);
  assert.match(reorder, /setCart\(updated\)/);
  assert.match(reorder, /optionSelectionError/);
  assert.match(reorder, /comboSelectionError/);
  assert.doesNotMatch(reorder, /priceDeltaVnd === modifier.priceVnd/);
  assert.match(reorder, /v.name === modifier.name && v.isAvailable/);
});
