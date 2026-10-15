import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { CustomerAddressesController } =
  require("../dist/customer-addresses/customer-addresses.controller.js");

const payload = { label: "  Văn phòng  ", phone: "0912345678",
  line1: "  414/7 Ấp 03A Đạo Thạnh  ", latitude: "10.1234567", longitude: "106.1234567" };
function fixture(role = "CUSTOMER") {
  const rows = [
    { id: "addr1", userId: "owner1", label: "Nhà", line1: "10 Nguyễn Huệ",
      latitude: "10.1", longitude: "106.1" },
    { id: "addr2", userId: "other", label: "Khác", line1: "20 Nguyễn Trãi",
      latitude: "10.2", longitude: "106.2" },
  ];
  const userChanges = [];
  const addresses = {
    updateMany: async ({ where, data }) => {
      const row = rows.find(item => item.id === where.id && item.userId === where.userId);
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    findFirstOrThrow: async ({ where }) => {
      const row = rows.find(item => item.id === where.id && item.userId === where.userId);
      if (!row) throw new Error("Not found");
      return row;
    },
  };
  const db = { address: addresses, user: { update: async input => {
    userChanges.push(input); return { id: input.where.id };
  } } };
  const prisma = { database: { $transaction: fn => fn(db) } };
  const auth = { principal: async () => ({ id: "owner1", role }) };
  return { controller: new CustomerAddressesController(auth, prisma), rows, userChanges };
}

test("PATCH changes an existing customer's record and updates profile phone atomically", async () => {
  const { controller, rows, userChanges } = fixture();
  const updated = await controller.update("Bearer test", "addr1", payload);
  assert.equal(updated.id, "addr1");
  assert.equal(updated.label, "Văn phòng");
  assert.equal(updated.line1, "414/7 Ấp 03A Đạo Thạnh");
  assert.equal(updated.latitude, payload.latitude);
  assert.equal(rows.length, 2, "Editing must not insert another saved address");
  assert.deepEqual(userChanges, [{ where: { id: "owner1" },
    data: { phoneE164: "+84912345678" } }]);
});

test("PATCH cannot overwrite another user's saved address or phone", async () => {
  const { controller, rows, userChanges } = fixture();
  await assert.rejects(controller.update("Bearer test", "addr2", payload),
    error => error.getStatus?.() === 404);
  assert.equal(rows[1].line1, "20 Nguyễn Trãi");
  assert.deepEqual(userChanges, []);
});

test("PATCH rejects invalid GPS coordinates and non-customer roles", async () => {
  const { controller } = fixture();
  await assert.rejects(controller.update("Bearer test", "addr1",
    { ...payload, longitude: "181" }), error => error.getStatus?.() === 400);
  const { controller: owner } = fixture("OWNER");
  await assert.rejects(owner.update("Bearer test", "addr1", payload),
    error => error.getStatus?.() === 403);
});

test("server rejects forged, version-stale and cross-province address codes", async () => {
  const { controller } = fixture();
  for (const area of [
    {catalogVersion:"vn-2026-09-08",provinceCode:"01",wardCode:"25747"},
    {catalogVersion:"old",provinceCode:"79",wardCode:"25747"},
    {catalogVersion:"vn-2026-09-08",provinceCode:"79",wardCode:"99999"},
  ]) {
    await assert.rejects(controller.update("Bearer test", "addr1", {...payload,...area}),
      error => error.getStatus?.()===400);
  }
  const value=await controller.update("Bearer test","addr1",{...payload,
    catalogVersion:"vn-2026-09-08",provinceCode:"79",wardCode:"25747"});
  assert.equal(value.wardCode,"25747");
});
