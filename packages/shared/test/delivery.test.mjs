import test from "node:test";
import assert from "node:assert/strict";
import { quoteDelivery, DeliveryQuoteError } from "../dist/delivery.js";

const policy = Object.freeze({
  versionId: "v1",
  acceptingOrders: true,
  baseMeters: 2000,
  baseFeeVnd: 10000,
  extraStepMeters: 1000,
  extraStepFeeVnd: 5000,
  maxRoadMeters: 8000,
  minSubtotalVnd: 80000,
  freeDeliveryAtSubtotalVnd: null,
});

test("exact base road distance costs base fee", () => {
  assert.equal(quoteDelivery(80000, 2000, policy).feeVnd, 10000);
});
test("one meter above base charges one started step", () => {
  assert.equal(quoteDelivery(80000, 2001, policy).feeVnd, 15000);
});
test("distance 4.3km charges three steps and snapshots VND", () => {
  assert.deepEqual(quoteDelivery(100000, 4300, policy), {
    policyVersionId: "v1", routeDistanceMeters: 4300, subtotalVnd: 100000,
    feeVnd: 25000, extraSteps: 3, totalVnd: 125000, freeDeliveryApplied: false,
  });
});
test("max route distance included; beyond max rejected", () => {
  assert.equal(quoteDelivery(80000, 8000, policy).feeVnd, 40000);
  assert.throws(() => quoteDelivery(80000, 8001, policy), { code: "OUT_OF_RANGE" });
});
test("route outage and invalid meters fail closed", () => {
  for (const distance of [null, 0, -1, NaN, Infinity, 2.5]) {
    assert.throws(() => quoteDelivery(100000, distance, policy), {
      code: "ROUTE_UNAVAILABLE",
    });
  }
});
test("minimum cart and store open checks", () => {
  assert.throws(() => quoteDelivery(79999, 2000, policy), { code: "BELOW_MINIMUM" });
  assert.throws(() => quoteDelivery(80000, 2000, { ...policy, acceptingOrders: false }), {
    code: "STORE_CLOSED",
  });
});
test("free shipping only when threshold is explicitly configured", () => {
  assert.equal(quoteDelivery(200000, 3000, policy).feeVnd, 15000);
  const quote = quoteDelivery(200000, 3000, { ...policy, freeDeliveryAtSubtotalVnd: 200000 });
  assert.equal(quote.feeVnd, 0);
  assert.equal(quote.freeDeliveryApplied, true);
});
test("address update re-evaluates distance and fee", () => {
  const first = quoteDelivery(100000, 1500, policy);
  const next = quoteDelivery(100000, 3500, policy);
  assert.notEqual(first.feeVnd, next.feeVnd);
});
test("invalid policy, subtotal and unsafe integer totals are rejected", () => {
  assert.throws(() => quoteDelivery(100000, 2000, { ...policy, extraStepMeters: 0 }), {
    code: "INVALID_POLICY",
  });
  assert.throws(() => quoteDelivery(-1000, 2000, policy), { code: "INVALID_SUBTOTAL" });
  assert.throws(
    () => quoteDelivery(Number.MAX_SAFE_INTEGER, 2000, policy),
    { code: "INVALID_POLICY" },
  );
});
