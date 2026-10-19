import test from "node:test";
import assert from "node:assert/strict";
import { quoteDelivery, quoteZoneDelivery, DeliveryQuoteError } from "../dist/delivery.js";

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

const zonePolicy = { versionId: "zone-v2", acceptingOrders: true, minSubtotalVnd: 80000,
  freeDeliveryAtSubtotalVnd: null };
const zoneAddress = { provinceCode: "79", wardCode: "26734", catalogVersion: "vn-2025-07" };
const zoneRates = [
  { id: "fallback", name: "HCM", provinceCode: "79", catalogVersion: "vn-2025-07",
    wardCodes: [], feeVnd: 25000, isActive: true },
  { id: "district", name: "Vùng trung tâm", provinceCode: "79", catalogVersion: "vn-2025-07",
    wardCodes: ["26734", "26737"], feeVnd: 12000, isActive: true },
];
test("zone fee is authoritative: ward precedence, immutable snapshot, no road distance", () => {
  assert.deepEqual(quoteZoneDelivery(100000, zoneAddress, zoneRates, zonePolicy), {
    pricingMode: "ZONE", policyVersionId: "zone-v2", routeDistanceMeters: null, extraSteps: null,
    zoneId: "district", zoneName: "Vùng trung tâm", provinceCode: "79",
    wardCode: "26734", catalogVersion: "vn-2025-07", subtotalVnd: 100000,
    feeVnd: 12000, totalVnd: 112000, freeDeliveryApplied: false,
  });
  assert.equal(quoteZoneDelivery(100000, { ...zoneAddress, wardCode: "00001" },
    zoneRates, zonePolicy).feeVnd, 25000);
});
test("zone mismatches, legacy addresses, duplicate overlapping ward and no configured rate fail closed", () => {
  for (const address of [{...zoneAddress, provinceCode: "01"},
    {...zoneAddress, catalogVersion: "vn-2024"}, {...zoneAddress, wardCode: "11111"}]) {
    assert.throws(() => quoteZoneDelivery(100000, address, zoneRates.slice(1), zonePolicy),
      { code: "ZONE_NOT_SERVED" });
  }
  assert.throws(() => quoteZoneDelivery(100000,
    { ...zoneAddress, wardCode: null }, zoneRates, zonePolicy),
  { code: "ADDRESS_REGION_UNCONFIRMED" });
  assert.throws(() => quoteZoneDelivery(100000, zoneAddress,
    [zoneRates[1], { ...zoneRates[1], id: "overlap" }], zonePolicy),
  { code: "INVALID_POLICY" });
  assert.throws(() => quoteZoneDelivery(100000, zoneAddress,
    [{...zoneRates[1], feeVnd: -1}], zonePolicy), { code: "ZONE_RATE_MISSING" });
});
test("zone minimum, explicit free delivery and store closed are enforced", () => {
  assert.throws(() => quoteZoneDelivery(70000, zoneAddress, zoneRates, zonePolicy),
    { code: "BELOW_MINIMUM" });
  assert.throws(() => quoteZoneDelivery(100000, zoneAddress, zoneRates,
    {...zonePolicy, acceptingOrders: false}), { code: "STORE_CLOSED" });
  assert.equal(quoteZoneDelivery(100000, zoneAddress, zoneRates,
    {...zonePolicy, freeDeliveryAtSubtotalVnd: 100000}).feeVnd, 0);
  assert.equal(quoteZoneDelivery(100000, zoneAddress, zoneRates,
    {...zonePolicy, freeDeliveryAtSubtotalVnd: null}).feeVnd, 12000);
});

test("L02: former Đồng Tháp ward is denied even by province-wide fallback and free-shipping", () => {
  const provinceFallback = [{ id: "dt-fallback", name: "Đồng Tháp",
    provinceCode: "82", catalogVersion: "vn-2026-09-08",
    wardCodes: [], feeVnd: 24000, isActive: true }];
  const approved = { provinceCode: "82", wardCode: "28261",
    catalogVersion: "vn-2026-09-08" };
  const excluded = { ...approved, wardCode: "29944" };
  assert.equal(quoteZoneDelivery(100000, approved, provinceFallback, zonePolicy).feeVnd, 24000);
  for (const rates of [provinceFallback,
    [{...provinceFallback[0], id: "all", wardCodes: ["28261", "29944"]}]]
  ) {
    assert.throws(() => quoteZoneDelivery(100000, excluded, rates,
      {...zonePolicy, freeDeliveryAtSubtotalVnd: 0}), {code: "ZONE_NOT_SERVED"});
  }
  assert.throws(() => quoteZoneDelivery(100000, {...approved, wardCode: null},
    provinceFallback, zonePolicy), {code: "ADDRESS_REGION_UNCONFIRMED"});
});

test("excluded ward is denied even by province-wide fallback pricing", () => {
  const rates = [{ id: "fallback82", name: "Zone", provinceCode: "82",
    catalogVersion: "vn-2026-09-08", wardCodes: [], feeVnd: 15000, isActive: true }];
  const accepted = { provinceCode: "82", wardCode: "28261", catalogVersion: "vn-2026-09-08" };
  assert.equal(quoteZoneDelivery(100000, accepted, rates, zonePolicy).feeVnd, 15000);
  for (const wardCode of ["29944", "30001", "29869"]) {
    assert.throws(() => quoteZoneDelivery(100000, { ...accepted, wardCode }, rates,
      { ...zonePolicy, freeDeliveryAtSubtotalVnd: 0 }), { code: "ZONE_NOT_SERVED" });
  }
});
