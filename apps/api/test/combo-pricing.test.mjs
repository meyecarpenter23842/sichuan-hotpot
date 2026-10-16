import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { priceCart } = require("../dist/delivery/pricing.js");

const comboId = randomUUID();
const fixedId = randomUUID();
const choiceId = randomUUID();
const optionId = randomUUID();
const fixedVariantId = randomUUID();
const choiceVariantId = randomUUID();
const toppingChoiceId = randomUUID();
const modifierOptionId = randomUUID();

function combo(overrides = {}) {
  return {
    id: comboId, name: "Combo 2 người", kind: "COMBO", isAvailable: true, priceVnd: 100000,
    variants: [], modifierGroups: [], modifierAssignments: [],
    comboFixedItems: [{
      quantity: 1, sortOrder: 0,
      variant: { id: fixedVariantId, productId: fixedId, name: "Lớn", isAvailable: true },
      childProduct: { id: fixedId, name: "Mì tươi", kind: "STANDARD", isAvailable: true },
    }],
    comboGroups: [{
      id: randomUUID(), name: "Chọn topping", minSelect: 2, maxSelect: 2, sortOrder: 1,
      options: [{
        id: optionId, quantity: 1, priceDeltaVnd: 10000, sortOrder: 0,
        variant: { id: choiceVariantId, productId: choiceId, name: "200g", isAvailable: true },
        childProduct: { id: choiceId, name: "Ba chỉ bò", kind: "STANDARD", isAvailable: true },
      }],
    }],
    ...overrides,
  };
}

const line = (comboOptionIds = [optionId, optionId]) => ({
  productId: comboId, variantId: null, modifierIds: [], comboOptionIds,
  quantity: 2, pricingMode: "SEPARATE",
});

test("combo pricing is authoritative and snapshots fixed/choice composition", () => {
  const priced = priceCart([line()], [combo()]);
  assert.equal(priced.subtotalVnd, 240000);
  assert.equal(priced.lines[0].unitPriceVnd, 120000);
  assert.equal(priced.lines[0].lineTotalVnd, 240000);
  assert.deepEqual(priced.lines[0].comboItems.map(item => ({
    kind: item.kind, productName: item.productName, variantId: item.variantId,
    variantName: item.variantName, quantity: item.quantity,
    priceDeltaVnd: item.priceDeltaVnd,
  })), [
    { kind: "FIXED", productName: "Mì tươi", variantId: fixedVariantId,
      variantName: "Lớn", quantity: 1, priceDeltaVnd: 0 },
    { kind: "CHOICE", productName: "Ba chỉ bò", variantId: choiceVariantId,
      variantName: "200g", quantity: 2, priceDeltaVnd: 20000 },
  ]);
});

test("combo rejects missing/unknown choices and unavailable or nested children", () => {
  for (const selected of [[], [optionId], [randomUUID(), optionId]]) {
    assert.throws(() => priceCart([line(selected)], [combo()]),
      error => error.getStatus?.() === 422);
  }
  assert.throws(() => priceCart([line()], [combo({
    comboFixedItems: [{
      quantity: 1, sortOrder: 0,
      childProduct: { id: fixedId, name: "Mì tươi", kind: "STANDARD", isAvailable: false },
    }],
  })]), error => error.getStatus?.() === 422);

  assert.throws(() => priceCart([line()], [combo({
    comboFixedItems: [{
      quantity: 1, sortOrder: 0,
      childProduct: { id: fixedId, name: "Combo con", kind: "COMBO", isAvailable: true },
    }],
  })]), error => error.getStatus?.() === 422);
});

test("standard product rejects combo choice IDs while old non-combo callers remain valid", () => {
  const standard = {
    id: comboId, name: "Món thường", kind: "STANDARD", isAvailable: true, priceVnd: 50000,
    variants: [], modifierGroups: [], modifierAssignments: [],
    comboFixedItems: [], comboGroups: [],
  };
  assert.throws(() => priceCart([line([optionId])], [standard]),
    error => error.getStatus?.() === 422);
  const legacy = priceCart([{
    productId: comboId, variantId: null, modifierIds: [], quantity: 1, pricingMode: "SEPARATE",
  }], [standard]);
  assert.equal(legacy.subtotalVnd, 50000);
});


test("combo rejects configured child size that is unavailable or belongs to another child", () => {
  assert.throws(() => priceCart([line()], [combo({
    comboFixedItems: [{
      quantity: 1, sortOrder: 0,
      variant: { id: fixedVariantId, productId: fixedId, name: "Lớn", isAvailable: false },
      childProduct: { id: fixedId, name: "Mì tươi", kind: "STANDARD", isAvailable: true },
    }],
  })]), error => error.getStatus?.() === 422);

  assert.throws(() => priceCart([line()], [combo({
    comboGroups: [{
      id: randomUUID(), name: "Chọn topping", minSelect: 2, maxSelect: 2, sortOrder: 1,
      options: [{
        id: optionId, quantity: 1, priceDeltaVnd: 10000, sortOrder: 0,
        variant: { id: choiceVariantId, productId: fixedId, name: "Sai món", isAvailable: true },
        childProduct: { id: choiceId, name: "Ba chỉ bò", kind: "STANDARD", isAvailable: true },
      }],
    }],
  })]), error => error.getStatus?.() === 422);
});


test("shared topping combo choice is priced authoritatively and snapshotted by modifier ID", () => {
  const toppingCombo = combo({
    comboGroups: [{
      id: randomUUID(), name: "Chọn topping", minSelect: 1, maxSelect: 1, sortOrder: 1,
      options: [],
      modifierOptions: [{
        id: toppingChoiceId, quantity: 2, priceDeltaVnd: 7000, sortOrder: 0,
        modifierOption: {
          id: modifierOptionId, name: "Bò cuộn", isAvailable: true,
          group: { isAvailable: true },
        },
      }],
    }],
  });
  const priced = priceCart([line([toppingChoiceId])], [toppingCombo]);
  assert.equal(priced.subtotalVnd, 214000);
  assert.equal(priced.lines[0].unitPriceVnd, 107000);
  assert.deepEqual(priced.lines[0].comboItems.map(item => ({
    kind: item.kind, productId: item.productId, modifierOptionId: item.modifierOptionId,
    productName: item.productName, quantity: item.quantity, priceDeltaVnd: item.priceDeltaVnd,
  })), [
    {
      kind: "FIXED", productId: fixedId, modifierOptionId: null,
      productName: "Mì tươi", quantity: 1, priceDeltaVnd: 0,
    },
    {
      kind: "CHOICE", productId: null, modifierOptionId,
      productName: "Bò cuộn", quantity: 2, priceDeltaVnd: 7000,
    },
  ]);
});

test("shared topping combo choice is rejected when topping or source group is unavailable", () => {
  const make = (optionAvailable, groupAvailable) => combo({
    comboGroups: [{
      id: randomUUID(), name: "Chọn topping", minSelect: 1, maxSelect: 1, sortOrder: 1,
      options: [],
      modifierOptions: [{
        id: toppingChoiceId, quantity: 1, priceDeltaVnd: 0, sortOrder: 0,
        modifierOption: {
          id: modifierOptionId, name: "Bò cuộn", isAvailable: optionAvailable,
          group: { isAvailable: groupAvailable },
        },
      }],
    }],
  });
  assert.throws(() => priceCart([line([toppingChoiceId])], [make(false, true)]),
    error => error.getStatus?.() === 422);
  assert.throws(() => priceCart([line([toppingChoiceId])], [make(true, false)]),
    error => error.getStatus?.() === 422);
  assert.throws(() => priceCart([line([randomUUID()])], [make(true, true)]),
    error => error.getStatus?.() === 422);
});
