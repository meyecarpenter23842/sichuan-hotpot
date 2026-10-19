import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const screen = readFileSync(new URL("../src/screens/OrdersScreen.tsx", import.meta.url), "utf8");
const orderPolicy = readFileSync(new URL("../../../packages/shared/src/orders.ts", import.meta.url), "utf8");
const controller = readFileSync(new URL("../../api/src/orders/orders.controller.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../../api/src/orders/orders.service.ts", import.meta.url), "utf8");
const push = readFileSync(new URL("../../api/src/push/push.service.ts", import.meta.url), "utf8");

test("customer contact works without login and uses exactly the verified shop number", () => {
  assert.match(screen, /SHOP_PHONE = "0902964685"/);
  assert.match(screen, /Linking\.openURL\("tel:" \+ SHOP_PHONE\)/);
  assert.ok(screen.indexOf('accessibilityLabel="Gọi quán 0902964685"') <
    screen.indexOf('!accessToken ?'));
});

test("cancel CTA is only shown in pending detail and requires confirmed user reason", () => {
  assert.match(screen, /detail\.status === "PENDING"/);
  assert.match(screen, /setCancelOpen\(true\)/);
  assert.match(screen, /Lý do hủy đơn/);
  assert.match(screen, /setCancelReason/);
  assert.match(screen, /cancelReason\.trim\(\)\.length < 5/);
  assert.match(screen, /"\/cancel"/);
  assert.match(screen, /"POST", accessToken/);
  assert.match(screen, /if \(!order \|\| order\.status !== "PENDING"/);
  assert.match(screen, /cancelInFlight\.current/);
  assert.match(screen, /await Promise\.all\(\[openOrder\(order\.id, true\), load\(true\)\]\)/);
  assert.match(screen, /paymentReviewRequired/);
  assert.match(screen, /onRequestClose=\{\(\) => \{ if \(!cancelBusy\)/);
});

test("backend cancellation owns record and atomically records a single customer audit", () => {
  assert.match(controller, /@Post\(":orderId\/cancel"\)/);
  assert.match(service, /const customerId = await this\.customerId\(authorization\)/);
  assert.match(service, /where: \{ id: orderId, customerId, status: "PENDING" \}/);
  assert.match(service, /orderStatusHistory\.create\(/);
  assert.match(service, /actorId: customerId, fromStatus: "PENDING"/);
  assert.match(service, /if \(row\.status === "CANCELED"\)/);
  assert.match(service, /ORDER_ALREADY_ACCEPTED_CONTACT_SHOP/);
  assert.match(service, /paymentReviewRequired/);
  assert.match(service, /this\.push\.notifyStaffCustomerCanceled\(branchId, orderId\)/);
  assert.match(push, /title: "Khách vừa hủy đơn"/);
  assert.match(push, /kind: "ORDER_STATUS"/);
  assert.match(orderPolicy, /if \(to === "CANCELED"\) return managers\.includes\(role\) \|\| role === "CUSTOMER"/);
  assert.doesNotMatch(orderPolicy, /case "PREPARING":[\s\S]*to === "CANCELED"/);
});
