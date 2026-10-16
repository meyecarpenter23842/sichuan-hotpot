import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DeliveryQuoteService } = require("../dist/delivery/delivery-quote.service.js");
const branchId = randomUUID(), addressId = randomUUID(), customerId = randomUUID();
const productId = randomUUID(), variantId = randomUUID(), modifierId = randomUUID();
const item = () => ({
  productId, variantId, modifierIds: [modifierId], quantity: 2,
});
const decimals = (v) => ({ toString: () => String(v) });
function fixture(meters = 2100) {
  const captured = [];
  const db = {
    branch: { findFirst: async q => {
      captured.push(["branch", q]);
      return { id: branchId, isActive: true, latitude: decimals(10.77), longitude: decimals(106.67) };
    } },
    address: { findFirst: async q => {
      captured.push(["address", q]);
      return { id: addressId, latitude: decimals(10.8), longitude: decimals(106.7) };
    } },
    deliveryPolicyVersion: { findFirst: async q => {
      captured.push(["policy", q]);
      return { id: "v1", acceptingOrders: true,
        baseMeters: 2000, baseFeeVnd: 10000, extraStepMeters: 1000,
        extraStepFeeVnd: 5000, maxRoadMeters: 8000,
        minSubtotalVnd: 80000, freeDeliveryAtSubtotalVnd: null };
    } },
    product: { findMany: async q => {
      captured.push(["products", q]);
      return [{ id: productId, name: "Lẩu", isAvailable: true, priceVnd: 50000,
        variants: [{ id: variantId, name: "Lớn", isAvailable: true, priceDeltaVnd: 10000 }],
        modifierGroups: [{ name: "Topping", minSelect: 1, maxSelect: 1,
          options: [{ id: modifierId, name: "Nấm", isAvailable: true, priceDeltaVnd: 5000 }] }] }];
    } },
  };
  const route = { drivingMeters: async (...points) => {
    captured.push(["routing", points]);
    return meters;
  } };
  const auth = { principal: async () => ({ id: customerId, role: "CUSTOMER" }) };
  const service = new DeliveryQuoteService({ database: db }, auth, route);
  const input = { branchId, addressId, items: [item()] };
  return { service, input, db, auth, route, captured };
}
test("route quote uses actual provider meters and DB prices, never frontend totals", async () => {
  const f = fixture(2100);
  const value = await f.service.calculate("Bearer valid", { ...f.input, subtotalVnd: 1 });
  assert.equal(value.subtotalVnd, 130000);
  assert.equal(value.routeDistanceMeters, 2100);
  assert.equal(value.feeVnd, 15000);
  assert.equal(value.totalVnd, 145000);
  assert.equal(value.policyVersionId, "v1");
  assert.ok(Date.parse(value.quoteExpiresAt) > Date.now());
  assert.deepEqual(f.captured.find(x => x[0] === "address")[1].where,
    { id: addressId, userId: customerId });
  assert.deepEqual(f.captured.find(x => x[0] === "products")[1].where.category,
    { is: { branchId } });
  assert.equal(f.captured.filter(x => x[0] === "routing").length, 1);
});
test("a topping counted twice is priced twice by the server and checked against maxSelect",async()=>{
 const f=fixture(2100);
 const original=f.db.product.findMany;
 f.db.product.findMany=async query=>{
   const rows=await original(query);
   rows[0].modifierGroups[0].maxSelect=2;
   return rows;
 };
 const input={...f.input,items:[{...item(),modifierIds:[modifierId,modifierId]}]};
 const quote=await f.service.calculate("Bearer valid",input);
 assert.equal(quote.subtotalVnd,140000,"2 portions x (50000 base + 10000 size + 2 x 5000 toppings)");
 assert.equal(quote.totalVnd,155000);
 await assert.rejects(f.service.calculate("Bearer valid",{
   ...f.input,items:[{...item(),modifierIds:[modifierId,modifierId,modifierId]}],
 }),e=>e.getStatus?.()===422,"server must reject qty beyond maxSelect");
});
test("all boundary routes are evaluated with road meters (not crow-flies)", async () => {
  for (const [meters, expected] of [[2000, 10000], [2100, 15000], [4300, 25000], [8000, 40000]]) {
    const f = fixture(meters);
    assert.equal((await f.service.calculate("Bearer valid", f.input)).feeVnd, expected);
  }
  const f = fixture(8100);
  await assert.rejects(f.service.calculate("Bearer valid", f.input),
    e => e.getStatus?.() === 422 && e.getResponse?.().code === "OUT_OF_RANGE");
});
test("provider failures block checkout quote instead of assuming zero fee", async () => {
  const f = fixture();
  f.route.drivingMeters = async () => { throw new Error("provider down"); };
  await assert.rejects(f.service.calculate("Bearer valid", f.input), /provider down/);
});
test("unknown address or staff session fails without leaking private data", async () => {
  const f = fixture();
  f.db.address.findFirst = async () => null;
  await assert.rejects(f.service.calculate("Bearer valid", f.input),
    e => e.getStatus?.() === 404);
  f.auth.principal = async () => ({ id: customerId, role: "DRIVER" });
  await assert.rejects(f.service.calculate("Bearer valid", f.input),
    e => e.getStatus?.() === 403);
});
test("invalid variants/modifiers, unavailable products and unsafe prices fail closed", async () => {
  const f = fixture();
  for (const changed of [
    { ...item(), variantId: randomUUID() },
    { ...item(), modifierIds: [] },
    { ...item(), modifierIds: [randomUUID()] },
    { ...item(), modifierIds: [modifierId, modifierId] },
    { ...item(), quantity: 100 },
  ]) {
    await assert.rejects(f.service.calculate("Bearer valid", { ...f.input, items: [changed] }),
      e => [400, 422].includes(e.getStatus?.()));
  }
  f.db.product.findMany = async () => [];
  await assert.rejects(f.service.calculate("Bearer valid", f.input),
    e => e.getStatus?.() === 422);
});
test("P4.6 closed branch denies new quote before routing but retains a public menu", async () => {
  const f = fixture();
  f.db.branch.findFirst = async () => ({
    id: branchId, isActive: false, latitude: decimals(10.77), longitude: decimals(106.67),
  });
  await assert.rejects(f.service.calculate("Bearer valid", f.input),
    e => e.getStatus?.() === 422 && e.getResponse?.().code === "STORE_CLOSED");
  assert.equal(f.captured.filter(x => x[0] === "routing").length, 0);
});
test("P4.6 acceptingOrders off denies quote before expensive routing", async () => {
  const f = fixture();
  f.db.deliveryPolicyVersion.findFirst = async () => ({
    id: "v1", acceptingOrders: false,
  });
  await assert.rejects(f.service.calculate("Bearer valid", f.input),
    e => e.getStatus?.() === 422 && e.getResponse?.().code === "STORE_CLOSED");
  assert.equal(f.captured.filter(x => x[0] === "routing").length, 0);
});

test("independent toppings stay fixed when increasing soup portions",async()=>{
  const f=fixture(2100);
  // Isolate quantity pricing from the store's 80k minimum order policy.
  const policy=f.db.deliveryPolicyVersion.findFirst;
  f.db.deliveryPolicyVersion.findFirst=async query=>({
    ...(await policy(query)),minSubtotalVnd:0,
  });
  // Fixture's default modifier is mandatory; model an actual optional topping
  // for this test. Mandatory selections are correctly applied per dish.
  const readProducts=f.db.product.findMany;
  f.db.product.findMany=async query=>{
    const products=await readProducts(query);
    products[0].modifierGroups[0].minSelect=0;
    return products;
  };
  const separate={...item(),pricingMode:"SEPARATE"};
  const one=await f.service.calculate("Bearer valid",{
    ...f.input,items:[{...separate,quantity:1}],
  });
  const two=await f.service.calculate("Bearer valid",{
    ...f.input,items:[{...separate,quantity:2}],
  });
  assert.equal(one.subtotalVnd,65000);
  assert.equal(two.subtotalVnd,125000);
  assert.equal(two.subtotalVnd-one.subtotalVnd,60000,
    "another Lẩu Lớn must add only soup price, not another topping");
  const original=f.db.product.findMany;
  f.db.product.findMany=async query=>{
    const rows=await original(query);
    rows[0].modifierGroups[0].maxSelect=2;
    return rows;
  };
  const twice=await f.service.calculate("Bearer valid",{
    ...f.input,items:[{...separate,modifierIds:[modifierId,modifierId],quantity:2}],
  });
  assert.equal(twice.subtotalVnd,130000);
});
