import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { AdminBranchSetupService } = require("../dist/admin-catalog/admin-branch-setup.service.js");

function setup(role = "OWNER") {
  const writes = [];
  let count = 0, policy = null, exists = true;
  const db = {
    branch: {
      create: async input => { writes.push(["create", input]); return input.data; },
      findUnique: async () => exists ? { id: "branch-id" } : null,
      update: async input => { writes.push(["update", input]); return input.data; },
    },
    branchOpeningHour: { count: async () => count },
    deliveryPolicyVersion: { findFirst: async () => policy },
  };
  const service = new AdminBranchSetupService({ database: db },
    { principal: async () => ({ id: "owner-id", role }) });
  return { service, writes, db, configured: () => { count = 7; policy = { id: "policy" }; },
    missing: () => { exists = false; } };
}
const details = { code: "quan-1", name: "  Sichuan Hotpot Q1  ",
  address: "  12 Đường Nguyễn Huệ, TP HCM  ", latitude: 10.7731, longitude: 106.7032 };

test("only real global OWNER may bootstrap branches", async () => {
  for (const role of ["CUSTOMER", "KITCHEN", "DRIVER", "MANAGER"]) {
    const { service, writes } = setup(role);
    await assert.rejects(service.create("Bearer x", details), e => e.getStatus?.() === 403);
    assert.deepEqual(writes, []);
  }
});

test("first branch is stored inactive with real GPS, address and OWNER membership", async () => {
  const { service, writes } = setup();
  const branch = await service.create("Bearer x", details);
  assert.equal(branch.isActive, false);
  assert.equal(branch.address, "12 Đường Nguyễn Huệ, TP HCM");
  assert.equal(branch.name, "Sichuan Hotpot Q1");
  assert.deepEqual(writes[0][1].data.memberships.create, { userId: "owner-id", role: "OWNER" });
  assert.equal(writes[0][1].data.latitude, details.latitude);
});

test("activation fails closed until seven real day rules and delivery policy exist", async () => {
  const { service, writes, configured } = setup();
  await assert.rejects(service.update("Bearer x", "branch-id", { isActive: true }),
    e => e.getStatus?.() === 409);
  assert.equal(writes.length, 0);
  configured();
  const enabled = await service.update("Bearer x", "branch-id", { isActive: true });
  assert.equal(enabled.isActive, true);
  const disabled = await service.update("Bearer x", "branch-id", { isActive: false });
  assert.equal(disabled.isActive, false);
});

test("rejects blank branch names and addresses after trimming", async () => {
  const { service, writes } = setup();
  await assert.rejects(service.create("Bearer x",
    { ...details, name: "    " }), e => e.getStatus?.() === 400);
  await assert.rejects(service.create("Bearer x",
    { ...details, address: "          " }), e => e.getStatus?.() === 400);
  assert.deepEqual(writes, []);
});
