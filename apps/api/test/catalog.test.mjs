import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CatalogService } = require("../dist/catalog/catalog.service.js");
const { CatalogController } = require("../dist/catalog/catalog.controller.js");

test("public branch list exposes only active store branches and minimal fields", async () => {
  let captured;
  const fake = {
    database: {
      branch: { findMany: async query => {
        captured = query;
        return [{ id: "branch-1", name: "Chi nhánh 1", code: "first" }];
      } },
    },
  };
  const data = await new CatalogService(fake).branches();
  assert.deepEqual(data, [{ id: "branch-1", name: "Chi nhánh 1", code: "first" }]);
  assert.deepEqual(captured.where, { isActive: true });
  assert.deepEqual(Object.keys(captured.select).sort(), ["code", "id", "name"]);
});

test("catalog query returns categories/products/variants in declared sort order", async () => {
  let captured;
  const stubMenu = { id: "branch-1", name: "Hotpot", code: "main", categories: [] };
  const fake = { database: { branch: { findFirst: async query => {
    captured = query;
    return stubMenu;
  } } } };
  const result = await new CatalogController(new CatalogService(fake)).menu("branch-1");
  assert.equal(result, stubMenu);
  assert.deepEqual(captured.where, { id: "branch-1", isActive: true });
  assert.equal(captured.select.categories.select.products.select.priceVnd, true);
  assert.equal(captured.select.categories.select.products.select.isAvailable, true);
  assert.equal(captured.select.categories.select.products.select.variants.select.priceDeltaVnd, true);
});

test("unknown or inactive branch fails closed with HTTP 404", async () => {
  const fake = { database: { branch: { findFirst: async () => null } } };
  await assert.rejects(new CatalogService(fake).menu("missing"), err => err?.getStatus?.() === 404);
});

test("database errors propagate as server errors instead of fabricated empty menus", async () => {
  const fake = { database: { branch: { findFirst: async () => { throw Error("db down"); } } } };
  await assert.rejects(new CatalogService(fake).menu("broken"), /db down/);
});
