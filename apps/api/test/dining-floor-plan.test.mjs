import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { DiningService } = require("../dist/dining/dining.service.js");
const { Prisma } = require("@prisma/client");
const branchId = randomUUID(), otherBranch = randomUUID();
const areaId = randomUUID(), tableId = randomUUID();

const move = (row, column, expectedRow = null, expectedColumn = null) =>
  ({ floorRow: row, floorColumn: column, expectedRow, expectedColumn });

function setup(role = "OWNER", opts = {}) {
  const calls = [];
  const tx = {
    diningTable: {
      findFirst: async ({ where }) => {
        calls.push(["findFirst", where]);
        return opts.noTable ? null : { id: tableId };
      },
      updateMany: async ({ where, data }) => {
        calls.push(["update", where, data]);
        if (opts.error) throw opts.error;
        return { count: opts.stale ? 0 : 1 };
      },
      findUniqueOrThrow: async () => ({ id: tableId, areaId, floorRow: opts.row ?? 2, floorColumn: opts.column ?? 3 }),
    },
  };
  const db = {
    branch: { findUnique: async ({ where }) => where.id === otherBranch ? null : { id: branchId } },
    branchMember: { findUnique: async () => role === "MANAGER" || role === "WAITER" ? { role } : null },
    $transaction: async (fn) => fn(tx),
  };
  const service = new DiningService({ database: db }, { principal: async () => ({
    id: randomUUID(), role,
  }) }, {}, {});
  return { service, calls };
}

test("only OWNER/MANAGER can persist layout, scoped by branch/area/UUID", async () => {
  for (const role of ["OWNER", "MANAGER"]) {
    const { service, calls } = setup(role);
    const result = await service.moveFloorPosition("Bearer test", branchId, areaId, tableId, move(2, 3));
    assert.equal(result.id, tableId);
    assert.deepEqual(calls[1][1], {
      id: tableId, branchId, areaId, floorRow: null, floorColumn: null,
    });
    assert.deepEqual(calls[1][2], { floorRow: 2, floorColumn: 3 });
  }
  for (const role of ["WAITER", "CASHIER", "KITCHEN", "DRIVER", "CUSTOMER"]) {
    const { service, calls } = setup(role);
    await assert.rejects(service.moveFloorPosition("Bearer test", branchId, areaId, tableId,
      move(2, 3)), err => err.getStatus?.() === 403);
    assert.deepEqual(calls, []);
  }
});

test("stale position and wrong table/branch fail without overwriting layouts", async () => {
  const stale = setup("OWNER", { stale: true });
  await assert.rejects(stale.service.moveFloorPosition("Bearer test", branchId, areaId, tableId,
    move(1, 1)), e => e.getStatus?.() === 409 && e.message === "DINING_FLOOR_STALE");
  const missing = setup("OWNER", { noTable: true });
  await assert.rejects(missing.service.moveFloorPosition("Bearer test", branchId, areaId, tableId,
    move(1, 1)), e => e.getStatus?.() === 404);
  assert.equal(missing.calls.some(entry => entry[0] === "update"), false);
  await assert.rejects(setup("OWNER").service.moveFloorPosition("Bearer test", otherBranch, areaId,
    tableId, move(1, 1)), e => e.getStatus?.() === 404);
});

test("incomplete, out of bounds or missing optimistic position is invalid", async () => {
  const { service, calls } = setup();
  for (const input of [
    { floorRow: 2, floorColumn: null, expectedRow: null, expectedColumn: null },
    { floorRow: 2, floorColumn: 6, expectedRow: null, expectedColumn: null },
    { floorRow: -1, floorColumn: 0, expectedRow: null, expectedColumn: null },
    { floorRow: 20, floorColumn: 0, expectedRow: null, expectedColumn: null },
    { floorRow: 1, floorColumn: 1, expectedRow: 1 },
    { floorRow: 1, floorColumn: 1, expectedRow: "1", expectedColumn: 1 },
  ]) {
    await assert.rejects(service.moveFloorPosition("Bearer test", branchId, areaId, tableId, input),
      e => e.getStatus?.() === 400);
  }
  assert.deepEqual(calls, []);
  await service.moveFloorPosition("Bearer test", branchId, areaId, tableId, move(null, null, 2, 3));
  assert.deepEqual(calls.at(-2)[2], { floorRow: null, floorColumn: null });
});

test("DB uniqueness collision is an explicit conflict, not a synthetic 0 or retry", async () => {
  const clash = new Prisma.PrismaClientKnownRequestError("Occupied slot", {
    code: "P2002", clientVersion: Prisma.prismaVersion.client,
  });
  const { service, calls } = setup("MANAGER", { error: clash });
  await assert.rejects(service.moveFloorPosition("Bearer test", branchId, areaId, tableId, move(0, 0)),
    e => e.getStatus?.() === 409 && e.message === "DINING_FLOOR_OCCUPIED");
  assert.equal(calls.filter(x => x[0] === "update").length, 1);
});

test("additive migration protects paired coordinates & unique slots without altering sessions", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20261024020000_dinein_l04_floor_positions/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN "floorRow" INTEGER/);
  assert.match(sql, /ADD COLUMN "floorColumn" INTEGER/);
  assert.match(sql, /DiningTable_floor_pair_and_bounds_check/);
  assert.match(sql, /CREATE UNIQUE INDEX "DiningTable_floor_slot_unique_idx"/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|UPDATE "DiningSession"|SET NOT NULL/);
  assert.match(readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    /floorRow Int\?/);
});
