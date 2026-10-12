import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionOrder, assertOrderTransition } from "../dist/orders.js";

const allowed = (from, to, role, isAssignedDriver = false) =>
  canTransitionOrder({ from, to, role, isAssignedDriver });

test("shop manager may confirm and kitchen may prepare", () => {
  assert.equal(allowed("PENDING", "CONFIRMED", "MANAGER"), true);
  assert.equal(allowed("CONFIRMED", "PREPARING", "KITCHEN"), true);
  assert.equal(allowed("PREPARING", "READY", "KITCHEN"), true);
});
test("driver must be assigned and cannot alter unrelated orders", () => {
  assert.equal(allowed("READY", "DELIVERING", "DRIVER"), false);
  assert.equal(allowed("READY", "DELIVERING", "DRIVER", true), true);
  assert.equal(allowed("DELIVERING", "DELIVERED", "DRIVER"), false);
  assert.equal(allowed("DELIVERING", "DELIVERED", "DRIVER", true), true);
  assert.equal(allowed("DELIVERING", "DELIVERY_FAILED", "DRIVER", true), true);
  assert.equal(allowed("READY", "DELIVERING", "CUSTOMER", true), false);
});
test("invalid jumps and terminal orders fail closed", () => {
  assert.equal(allowed("PENDING", "DELIVERED", "OWNER"), false);
  assert.equal(allowed("DELIVERED", "PENDING", "OWNER"), false);
  assert.equal(allowed("CANCELED", "CONFIRMED", "MANAGER"), false);
  assert.equal(allowed("READY", "READY", "MANAGER"), false);
});
test("customer cancel only on pending order", () => {
  assert.equal(allowed("PENDING", "CANCELED", "CUSTOMER"), true);
  assert.equal(allowed("CONFIRMED", "CANCELED", "CUSTOMER"), false);
});
test("assert throws for forbidden transition", () => {
  assert.throws(() => assertOrderTransition({
    from: "PENDING", to: "READY", role: "CUSTOMER", isAssignedDriver: false,
  }), { message: "INVALID_ORDER_TRANSITION" });
});
