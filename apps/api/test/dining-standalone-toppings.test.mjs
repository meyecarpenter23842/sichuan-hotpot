import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { priceDiningItems } = require("../dist/dining/dining-pricing.js");
const branchId = randomUUID();
const optionId = randomUUID();
const groupId = randomUUID();
const productId = randomUUID();
const addon = (quantity = 2) => ({
  productId: optionId, standaloneTopping: true,
  variantId: null, modifierIds: [], comboOptionIds: [], quantity,
});
const dish = (quantity = 1) => ({
  productId, variantId: null, modifierIds: [], comboOptionIds: [], quantity,
});
function tx({ published = true, available = true, optionPrice = 30_000 } = {}) {
  const calls = [];
  return {
    calls,
    modifierOption: { findMany: async args => {
      calls.push(args);
      return published && available ? [{
        id: optionId, name: "Nấm bào ngư", priceDeltaVnd: optionPrice,
      }] : [];
    } },
    product: { findMany: async () => [{
      id: productId, name: "Lẩu Tứ Xuyên", kind: "STANDARD",
      isAvailable: true, priceVnd: 250_000,
      variants: [], modifierGroups: [], modifierAssignments: [],
      comboFixedItems: [], comboGroups: [],
    }] },
  };
}
test("library option itself sells as distinct nullable-FK ticket line; server alone sets VND", async () => {
  const db = tx();
  const result = await priceDiningItems(db, branchId, [addon(2)]);
  assert.equal(result.subtotalVnd, 60_000);
  assert.deepEqual(result.lines.map(l => [l.productId, l.standaloneToppingOptionId, l.quantity,
    l.unitPriceVnd, l.lineTotalVnd]), [[null, optionId, 2, 30_000, 60_000]]);
  const filter = db.calls[0].where;
  assert.equal(filter.group.branchId, branchId);
  assert.equal(filter.group.allowStandalone, true);
  assert.equal(filter.group.isAvailable, true);
  assert.equal(filter.isAvailable, true);
});
test("mixed dish and standalone topping keep correct order, no second Product", async () => {
  const result = await priceDiningItems(tx(), branchId, [addon(2), dish(), addon(1)]);
  assert.deepEqual(result.lines.map(l => l.productName),
    ["Nấm bào ngư", "Lẩu Tứ Xuyên", "Nấm bào ngư"]);
  assert.equal(result.subtotalVnd, 340_000);
  assert.deepEqual(result.lines.map(l => l.productId), [null, productId, null]);
});
test("not opted in, wrong branch, sold out or no image cannot enter ticket", async () => {
  for (const state of [{ published: false }, { available: false }]) {
    await assert.rejects(priceDiningItems(tx(state), branchId, [addon()]),
      e => e?.message === "STANDALONE_TOPPING_UNAVAILABLE");
  }
  await assert.rejects(priceDiningItems(tx(), branchId, [
    { ...addon(), modifierIds: [randomUUID()] },
  ]), e => e?.message === "INVALID_STANDALONE_TOPPING");
  await assert.rejects(priceDiningItems(tx(), branchId, [
    { ...addon(), variantId: randomUUID() },
  ]), e => e?.message === "INVALID_STANDALONE_TOPPING");
  await assert.rejects(priceDiningItems(tx(), branchId, [addon(100)]),
    e => e?.message === "INVALID_STANDALONE_TOPPING");
});
test("prices are safe integers and amount caps apply to entire ticket", async () => {
  await assert.rejects(priceDiningItems(tx({ optionPrice: Number.MAX_SAFE_INTEGER }),
    branchId, [addon()]), e => e?.message === "INVALID_CATALOG_PRICE");
  await assert.rejects(priceDiningItems(tx({ optionPrice: 2_000_000_000 }),
    branchId, [addon(2)]), e => e?.message === "INVALID_CATALOG_PRICE");
});
