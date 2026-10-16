import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { AdminCatalogService } = require("../dist/admin-catalog/admin-catalog.service.js");

const branchId = randomUUID();
const comboId = randomUUID();
const childA = randomUUID();
const childB = randomUUID();
const variantA = randomUUID();
const variantB = randomUUID();

function fixture(children = [
  { id: childA, kind: "STANDARD" },
  { id: childB, kind: "STANDARD" },
], variants = []) {
  const writes = [];
  const db = {
    branch: {
      findUnique: async () => ({ id: branchId }),
      update: async input => { writes.push(["branch-update", input]); return input.data; },
    },
    product: {
      findFirst: async input => {
        writes.push(["product-find", input]);
        if (input.where.id === comboId) return { id: comboId, kind: "COMBO" };
        return null;
      },
      findMany: async input => {
        writes.push(["children", input]); return children;
      },
    },
    productVariant: {
      findMany: async input => { writes.push(["variants", input]); return variants; },
    },
    productComboFixedItem: {
      deleteMany: async input => { writes.push(["fixed-delete", input]); },
      createMany: async input => { writes.push(["fixed-create", input]); return { count: input.data.length }; },
    },
    productComboGroup: {
      deleteMany: async input => { writes.push(["group-delete", input]); },
      create: async input => {
        writes.push(["group-create", input]);
        return { id: randomUUID() };
      },
    },
    productComboOption: {
      deleteMany: async input => { writes.push(["option-delete", input]); },
      createMany: async input => { writes.push(["option-create", input]); return { count: input.data.length }; },
    },
  };
  db.$transaction = async callback => callback(db);
  const auth = { adminAccess: async () => ({ status: "ok" }) };
  return { service: new AdminCatalogService({ database: db }, auth), writes };
}

test("admin saves whole combo atomically with only STANDARD children from its branch", async () => {
  const { service, writes } = fixture();
  const result = await service.saveCombo("Bearer owner", branchId, comboId, {
    fixedItems: [{ productId: childA, quantity: 1, sortOrder: 0 }],
    groups: [{
      name: "Chọn nước", minSelect: 1, maxSelect: 2, sortOrder: 1,
      options: [{ productId: childB, quantity: 1, priceDeltaVnd: 5000, sortOrder: 0 }],
    }],
  });
  assert.equal(result.status, "saved");
  assert.equal(result.fixedCount, 1);
  assert.equal(result.groupCount, 1);
  assert.ok(writes.some(row => row[0] === "fixed-create"));
  assert.ok(writes.some(row => row[0] === "group-create"));
  assert.ok(writes.some(row => row[0] === "option-create"));
  const query = writes.find(row => row[0] === "children")[1];
  assert.deepEqual(query.where.category, { branchId });
});

test("admin combo contract blocks self-reference, nesting and cross-branch/missing children", async () => {
  const base = {
    fixedItems: [{ productId: childA, quantity: 1, sortOrder: 0 }],
    groups: [],
  };
  await assert.rejects(fixture().service.saveCombo("Bearer owner", branchId, comboId, {
    fixedItems: [{ productId: comboId, quantity: 1, sortOrder: 0 }], groups: [],
  }), error => error.getStatus?.() === 400);

  await assert.rejects(fixture([{ id: childA, kind: "COMBO" }]).service
    .saveCombo("Bearer owner", branchId, comboId, base),
    error => error.getStatus?.() === 400);

  await assert.rejects(fixture([]).service.saveCombo("Bearer owner", branchId, comboId, base),
    error => error.getStatus?.() === 400);
});


test("admin persists child size and rejects a size from the wrong product", async () => {
  const { service, writes } = fixture(undefined, [
    { id: variantA, productId: childA, isAvailable: true },
    { id: variantB, productId: childB, isAvailable: true },
  ]);
  await service.saveCombo("Bearer owner", branchId, comboId, {
    fixedItems: [{ productId: childA, variantId: variantA, quantity: 1, sortOrder: 0 }],
    groups: [{
      name: "Chọn nước", minSelect: 1, maxSelect: 1, sortOrder: 1,
      options: [{
        productId: childB, variantId: variantB, quantity: 1,
        priceDeltaVnd: 0, sortOrder: 0,
      }],
    }],
  });
  const fixedWrite = writes.find(row => row[0] === "fixed-create")[1].data[0];
  const optionWrite = writes.find(row => row[0] === "option-create")[1].data[0];
  assert.equal(fixedWrite.variantId, variantA);
  assert.equal(optionWrite.variantId, variantB);

  await assert.rejects(fixture(undefined, [
    { id: variantA, productId: childB, isAvailable: true },
  ]).service.saveCombo("Bearer owner", branchId, comboId, {
    fixedItems: [{ productId: childA, variantId: variantA, quantity: 1, sortOrder: 0 }],
    groups: [],
  }), error => error.getStatus?.() === 400);
});
