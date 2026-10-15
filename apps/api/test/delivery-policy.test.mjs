import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DeliveryPolicyService } = require("../dist/delivery-policy/delivery-policy.service.js");
const branchId = randomUUID();
const input = Object.freeze({
  acceptingOrders: true, baseMeters: 2000, baseFeeVnd: 10000,
  extraStepMeters: 1000, extraStepFeeVnd: 5000,
  maxRoadMeters: 8000, minSubtotalVnd: 80000, freeDeliveryAtSubtotalVnd: null,
});
function setup(role = "OWNER", previous = null) {
  const trace = [];
  const db = {
    branch: { findUnique: async () => ({ id: branchId }) },
    deliveryPolicyVersion: {
      findFirst: async () => previous && { version: previous },
      create: async ({ data }) => { trace.push(data); return { id: "new-policy", ...data }; },
    },
    $transaction: async (cb, options) => {
      trace.push(options);
      return cb(db);
    },
  };
  const auth = { principal: async () => ({ id: randomUUID(), role }) };
  return { service: new DeliveryPolicyService({ database: db }, auth), trace, db };
}
test("OWNER creates immutable policy v1 and every edit creates v2", async () => {
  const first = setup();
  const row = await first.service.create("Bearer owner", branchId, input);
  assert.equal(row.version, 1);
  assert.equal(row.branchId, branchId);
  assert.equal(row.baseFeeVnd, 10000);
  assert.ok(first.trace[0].isolationLevel);
  const second = setup("OWNER", 1);
  const changed = await second.service.create("Bearer owner", branchId, {
    ...input, baseFeeVnd: 15000, acceptingOrders: false,
  });
  assert.equal(changed.version, 2);
  assert.equal(changed.acceptingOrders, false);
  assert.equal(changed.baseFeeVnd, 15000);
});
test("staff/customer cannot read or mutate pricing", async () => {
  for (const role of ["CUSTOMER", "MANAGER", "KITCHEN", "DRIVER"]) {
    const { service, trace } = setup(role);
    await assert.rejects(service.current("Bearer other", branchId),
      error => error.getStatus?.() === 403);
    await assert.rejects(service.create("Bearer other", branchId, input),
      error => error.getStatus?.() === 403);
    assert.equal(trace.length, 0);
  }
});
test("invalid policy including negative fees, zero step, max below base fails closed", async () => {
  const { service, trace } = setup();
  for (const invalid of [
    { ...input, baseMeters: 9000 },
    { ...input, extraStepMeters: 0 },
    { ...input, baseFeeVnd: -1 },
    { ...input, maxRoadMeters: 0 },
    { ...input, freeDeliveryAtSubtotalVnd: -1 },
    { ...input, acceptingOrders: "yes" },
    { ...input, freeDeliveryAtSubtotalVnd: undefined },
  ]) {
    await assert.rejects(service.create("Bearer owner", branchId, invalid),
      error => error.getStatus?.() === 400);
  }
  assert.equal(trace.length, 0);
});
test("nonexistent branch does not create a pricing version", async () => {
  const f = setup();
  f.db.branch.findUnique = async () => null;
  await assert.rejects(f.service.create("Bearer owner", branchId, input),
    error => error.getStatus?.() === 404);
});
test("current policy displays latest persisted version without modifications", async () => {
  const f = setup("OWNER", 3);
  const row = await f.service.current("Bearer owner", branchId);
  assert.deepEqual(row, { version: 3 });
  assert.equal(f.trace.length, 0);
});

test("OWNER zone policy rejects overlapping ward and accepts immutable group rates", async () => {
  const f = setup();
  const zone = { name: "Trung tâm", provinceCode: "79", catalogVersion: "vn-2026-09-08",
    wardCodes: ["25747"], feeVnd: 15000, isActive: true };
  const valid = { pricingMode: "ZONE", acceptingOrders: true,
    minSubtotalVnd: 80000, freeDeliveryAtSubtotalVnd: null, zones: [zone] };
  const saved = await f.service.create("Bearer owner", branchId, valid);
  assert.equal(saved.pricingMode,"ZONE");
  assert.equal(saved.zones.create[0].feeVnd,15000);
  await assert.rejects(f.service.create("Bearer owner", branchId,
    {...valid,zones:[zone,{...zone,name:"Trùng",feeVnd:25000}]}),
    e=>e.getStatus?.()===400);
  await assert.rejects(f.service.create("Bearer owner", branchId,
    {...valid,zones:[{...zone,feeVnd:-1}]}),
    e=>e.getStatus?.()===400);
});
