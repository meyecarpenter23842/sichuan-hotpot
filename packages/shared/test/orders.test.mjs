import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionOrder, assertOrderTransition,
  canReorderDeliveredOrder, historicalPurchaseKey } from "../dist/orders.js";

const allowed = (from, to, role, isAssignedDriver = false) =>
  canTransitionOrder({ from, to, role, isAssignedDriver });

test("shop manager may confirm and kitchen may prepare", () => {
  assert.equal(allowed("PENDING", "CONFIRMED", "MANAGER"), true);
  assert.equal(allowed("CONFIRMED", "PREPARING", "KITCHEN"), true);
  assert.equal(allowed("PREPARING", "READY", "KITCHEN"), true);
});
test("manager can operate store self-delivery while driver must be assigned", () => {
  assert.equal(allowed("READY", "DELIVERING", "OWNER"), true);
  assert.equal(allowed("READY", "DELIVERING", "MANAGER"), true);
  assert.equal(allowed("DELIVERING", "DELIVERED", "OWNER"), true);
  assert.equal(allowed("DELIVERING", "DELIVERY_FAILED", "MANAGER"), true);
  assert.equal(allowed("READY", "DELIVERING", "DRIVER"), false);
  assert.equal(allowed("READY", "DELIVERING", "DRIVER", true), true);
  assert.equal(allowed("DELIVERING", "DELIVERED", "DRIVER"), false);
  assert.equal(allowed("DELIVERING", "DELIVERED", "DRIVER", true), true);
  assert.equal(allowed("DELIVERING", "DELIVERY_FAILED", "DRIVER", true), true);
  assert.equal(allowed("READY", "DELIVERING", "CUSTOMER", true), false);
  assert.equal(allowed("READY", "DELIVERING", "KITCHEN"), false);
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

test("L03 reorder is allowed only after delivery across all eight statuses", () => {
  const statuses = ["PENDING", "CONFIRMED", "PREPARING", "READY", "DELIVERING",
    "DELIVERED", "CANCELED", "DELIVERY_FAILED"];
  assert.deepEqual(statuses.filter(canReorderDeliveredOrder), ["DELIVERED"]);
  for (const status of statuses.filter(s => s !== "DELIVERED")) {
    assert.equal(canReorderDeliveredOrder(status), false);
  }
  assert.equal(canReorderDeliveredOrder("UNKNOWN"), false);
});

test("L03 historical purchases distinguish combo options, sizes and repeated modifiers", () => {
  const product = {
    productId: "combo-a", variantName: "Lớn",
    modifiers: [{name: "Nấm", priceVnd: 10000}],
    comboItems: [{
      kind: "CHOICE", groupName: "Chọn nước",
      productId: "soup-a", variantId: "size-a", modifierOptionId: null,
      productName: "Nước lẩu A", variantName: "Lớn",
      quantity: 1, priceDeltaVnd: 5000,
    }],
  };
  const key = historicalPurchaseKey("branch-1", product);
  assert.equal(key, historicalPurchaseKey("branch-1", structuredClone(product)));
  assert.notEqual(key, historicalPurchaseKey("branch-2", product));
  assert.notEqual(key, historicalPurchaseKey("branch-1", {...product, variantName: "Nhỏ"}));
  assert.notEqual(key, historicalPurchaseKey("branch-1", {...product,
    comboItems: [{...product.comboItems[0], productId: "soup-b"}]}));
  assert.notEqual(key, historicalPurchaseKey("branch-1", {...product,
    modifiers: [...product.modifiers, {...product.modifiers[0]}]}));
  assert.notEqual(key, historicalPurchaseKey("branch-1", {...product,
    comboItems: [{...product.comboItems[0], modifierOptionId: "topping-1"}]}));
  assert.equal(key, historicalPurchaseKey("branch-1", {...product,
    modifiers: [...product.modifiers].reverse()}));
});
