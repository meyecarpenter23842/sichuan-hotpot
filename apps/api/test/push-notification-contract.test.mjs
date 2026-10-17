import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("new orders alert staff while customer push waits for CONFIRMED", () => {
  const customerOrders = read("../src/orders/orders.service.ts");
  const adminOrders = read("../src/orders/admin-orders.service.ts");
  assert.match(customerOrders, /notifyStaffNewOrder\(input\.branchId, created\.orderId\)/);
  assert.match(adminOrders, /if \(changed\.status === "CONFIRMED"\)[\s\S]*notifyCustomerConfirmed/);
  assert.doesNotMatch(customerOrders, /notifyCustomerConfirmed/);
});

test("PWA uses system notification banner and Android Admin uses approved custom sound", () => {
  const adminPush = read("../../admin/src/push-client.native.ts");
  const customerPush = read("../../customer/src/push-client.native.ts");
  const adminWorker = read("../../admin/public/hotpot-sw.js");
  const customerWorker = read("../../customer/public/hotpot-sw.js");
  assert.match(adminPush, /new-orders-v1/);
  assert.match(adminPush, /sound: "new_order_alert\.mp3"/);
  assert.match(customerPush, /customer-orders-v1/);
  assert.match(customerPush, /sound: "default"/);
  for (const worker of [adminWorker, customerWorker]) {
    assert.match(worker, /showNotification/);
    assert.doesNotMatch(worker, /sound\s*:/);
  }
});

test("customer cart badge and navigation icons are vector-based", () => {
  const app = read("../../customer/App.tsx");
  const icons = read("../../customer/src/components/HotpotNavIcon.tsx");
  assert.match(app, /cartItemCount = useMemo/);
  assert.match(app, /testID="cart-count-badge"/);
  assert.match(icons, /MaterialCommunityIcons/);
  assert.doesNotMatch(icons, /sheet-navigation\.png/);
});
