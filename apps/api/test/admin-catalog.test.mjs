import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { AdminCatalogService } = require("../dist/admin-catalog/admin-catalog.service.js");
const { R2ProductImagesService, signedR2Url } =
  require("../dist/admin-catalog/r2-product-images.service.js");
const branchId = randomUUID(), categoryId = randomUUID(), productId = randomUUID();

function stub(role = "OWNER") {
  const writes = [];
  const db = {
    branch: {
      findUnique: async () => ({ id: branchId }),
      findMany: async data => { writes.push(["branches", data]); return []; },
      findUniqueOrThrow: async data => { writes.push(["menu", data]); return { categories: [] }; },
    },
    catalogCategory: {
      findFirst: async data => {
        writes.push(["category-check", data]); return { id: categoryId };
      },
    },
    product: {
      findFirst: async data => { writes.push(["product-check", data]); return { id: productId }; },
      create: async data => { writes.push(["product-create", data]); return data.data; },
      update: async data => { writes.push(["product-update", data]); return data.data; },
    },
    branchOpeningHour: {
      deleteMany: async data => { writes.push(["hours-delete", data]); },
      createMany: async data => { writes.push(["hours-create", data]); },
      findMany: async () => [],
    },
  };
  db.$transaction = async callback => callback(db);
  const auth = {
    principal: async () => ({ id: "staff", role }),
    adminAccess: async () => {
      if (!["OWNER", "MANAGER"].includes(role)) {
        const e = new Error("forbidden"); e.getStatus = () => 403; throw e;
      }
      return { status: "ok" };
    },
  };
  return { service: new AdminCatalogService({ database: db }, auth), db, auth, writes };
}

test("OWNER sees branches, MANAGER sees only explicit manager memberships", async () => {
  const owner = stub();
  await owner.service.branches("Bearer valid");
  assert.equal(owner.writes[0][1].where, undefined);
  const manager = stub("MANAGER");
  await manager.service.branches("Bearer valid");
  assert.deepEqual(manager.writes[0][1].where.memberships.some.role.in, ["OWNER", "MANAGER"]);
});

test("CUSTOMER/KITCHEN/DRIVER cannot read or alter products", async () => {
  for (const role of ["CUSTOMER", "KITCHEN", "DRIVER"]) {
    const { service, writes } = stub(role);
    await assert.rejects(service.catalogue("Bearer x", branchId), /forbidden/);
    await assert.rejects(service.createProduct("Bearer x", branchId, {
      categoryId, name: "Lẩu", priceVnd: 150000, isAvailable: true,
    }), /forbidden/);
    assert.deepEqual(writes, []);
  }
});

test("product creation and updates enforce branch ownership and integer prices", async () => {
  const { service, writes } = stub();
  const result = await service.createProduct("Bearer x", branchId, {
    categoryId, name: "  Lẩu Tứ Xuyên  ", priceVnd: 199000, isAvailable: true,
  });
  assert.equal(result.name, "Lẩu Tứ Xuyên");
  assert.equal(result.priceVnd, 199000);
  assert.deepEqual(writes.find(x => x[0] === "category-check")[1].where,
    { id: categoryId, branchId });
  await service.updateProduct("Bearer x", branchId, productId, { isAvailable: false });
  assert.deepEqual(writes.find(x => x[0] === "product-update")[1].data, {
    isAvailable: false,
  });
});

test("seven-day hours update is one database transaction; invalid weeks rejected", async () => {
  const { service, writes } = stub();
  const days = Array.from({ length: 7 }, (_, weekday) => ({
    weekday, opensAt: "09:00", closesAt: "22:00", isClosed: false,
  }));
  await service.openingHours("Bearer x", branchId, days);
  assert.ok(writes.some(x => x[0] === "hours-delete"));
  assert.equal(writes.find(x => x[0] === "hours-create")[1].data.length, 7);
  await assert.rejects(service.openingHours("Bearer x", branchId,
    days.map(x => ({ ...x, weekday: 1 }))), err => err.getStatus?.() === 400);
  await assert.rejects(service.openingHours("Bearer x", branchId,
    days.map(x => ({ ...x, closesAt: "08:00" }))), err => err.getStatus?.() === 400);
});

test("R2 signer generates short-lived scoped PUT only, no public write credentials", async () => {
  const saved = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  };
  process.env.R2_ACCOUNT_ID = "a".repeat(32);
  process.env.R2_ACCESS_KEY_ID = "TESTACCESSKEYPLACEHOLDER";
  process.env.R2_SECRET_ACCESS_KEY = "CI_dummy_long_private_key_not_real";
  const key = "products-image/" + branchId + "/" + productId + "/" + randomUUID() + ".webp";
  try {
    const url = new URL(signedR2Url("PUT", key, new Date("2026-10-14T06:00:00.000Z")));
    assert.equal(url.protocol, "https:");
    assert.ok(url.hostname.endsWith(".r2.cloudflarestorage.com"));
    assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
    assert.ok(/^[a-f0-9]{64}$/.test(url.searchParams.get("X-Amz-Signature")));
    assert.equal(url.pathname.includes("products-image"), true);
    assert.equal(url.href.includes(process.env.R2_SECRET_ACCESS_KEY), false);
    const { auth, db } = stub("CUSTOMER");
    const service = new R2ProductImagesService(auth, { database: db });
    await assert.rejects(service.ticket("Bearer x", branchId, productId, {
      contentType: "image/webp", byteSize: 500,
    }), /forbidden/);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
