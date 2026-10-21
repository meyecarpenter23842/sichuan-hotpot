// L02 backend integration acceptance: NEVER run against production.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
const require = createRequire(import.meta.url);
const { DiningService } = require("../../apps/api/dist/dining/dining.service.js");
const allowed = "postgresql://hotpot_ci:hotpot_ci_only@127.0.0.1:5432/hotpot_ci?schema=public";
if (process.env.GITHUB_ACTIONS !== "true" || process.env.DATABASE_URL !== allowed) {
  throw new Error("L02 acceptance requires isolated CI localhost PostgreSQL");
}
const prisma = new PrismaClient();
const keys = new Map();
const auth = { principal: async key => {
  const row = keys.get(key);
  if (!row) throw new Error("TEST_AUTH_DENIED");
  return row;
}};
const service = new DiningService({ get database() { return prisma; } }, auth);
const nonce = randomUUID().replaceAll("-", "");
const line = (productId, quantity=1, variantId=null, modifierIds=[], comboOptionIds=[]) =>
  ({ productId, variantId, modifierIds, comboOptionIds, quantity });
const input = (idempotencyKey, items) => ({ idempotencyKey, items });
async function rejectsCode(promise, code) {
  await assert.rejects(promise, err => err?.message === code || JSON.stringify(err).includes(code), code);
}
try {
  const [owner, waiter, cashier, kitchen, outsider] = await Promise.all([
    prisma.user.create({ data: { role: "OWNER" } }),
    prisma.user.create({ data: { role: "WAITER" } }),
    prisma.user.create({ data: { role: "CASHIER" } }),
    prisma.user.create({ data: { role: "KITCHEN" } }),
    prisma.user.create({ data: { role: "DRIVER" } }),
  ]);
  keys.set("owner", { id: owner.id, role: "OWNER" });
  keys.set("waiter", { id: waiter.id, role: "WAITER" });
  keys.set("cashier", { id: cashier.id, role: "CASHIER" });
  keys.set("kitchen", { id: kitchen.id, role: "KITCHEN" });
  keys.set("outsider", { id: outsider.id, role: "DRIVER" });
  const branch = await prisma.branch.create({ data: {
    code: "L02-" + nonce.slice(0, 12), name: "L02 " + nonce,
    latitude: 10, longitude: 106,
  } });
  const foreign = await prisma.branch.create({ data: {
    code: "L02-" + nonce.slice(12, 24), name: "Foreign L02",
    latitude: 10, longitude: 106,
  } });
  for (const [user, role] of [[waiter,"WAITER"],[cashier,"CASHIER"],[kitchen,"KITCHEN"]]) {
    await prisma.branchMember.create({ data: { branchId: branch.id, userId: user.id, role } });
  }
  const area = await prisma.diningArea.create({ data: { branchId: branch.id, name: "Tầng 1" } });
  const table = await prisma.diningTable.create({ data: {
    branchId: branch.id, areaId: area.id, code: "A1", name: "Bàn A1", qrHandle: nonce,
  } });
  const category = await prisma.catalogCategory.create({ data: {
    branchId: branch.id, name: "Lẩu L02",
  } });
  const hotpot = await prisma.product.create({ data: {
    categoryId: category.id, name: "Lẩu Tứ Xuyên", priceVnd: 250_000,
  } });
  const variant = await prisma.productVariant.create({ data: {
    productId: hotpot.id, name: "Lớn", priceDeltaVnd: 120_000,
  } });
  const group = await prisma.modifierGroup.create({ data: {
    branchId: branch.id, name: "Topping", minSelect: 0, maxSelect: 2,
  } });
  const topping = await prisma.modifierOption.create({ data: {
    groupId: group.id, name: "Nấm bào ngư", priceDeltaVnd: 30_000,
  } });
  await prisma.productModifierGroupAssignment.create({ data: {
    productId: hotpot.id, groupId: group.id,
  } });
  const beef = await prisma.product.create({ data: {
    categoryId: category.id, name: "Bò Mỹ", priceVnd: 80_000,
  } });
  const combo = await prisma.product.create({ data: {
    categoryId: category.id, name: "Combo", kind: "COMBO", priceVnd: 185_000,
  } });
  await prisma.productComboFixedItem.create({ data: {
    comboProductId: combo.id, childProductId: beef.id,
  } });
  await rejectsCode(service.tables("outsider", branch.id), "DINING_BRANCH_FORBIDDEN");
  await rejectsCode(service.open("waiter", foreign.id, table.id), "DINING_BRANCH_FORBIDDEN");
  assert.equal((await service.areas("waiter", branch.id)).length, 1);
  const attempts = await Promise.allSettled([
    service.open("waiter", branch.id, table.id, 4),
    service.open("waiter", branch.id, table.id, 4),
  ]);
  assert.equal(attempts.filter(x => x.status === "fulfilled").length, 1, "only one active session");
  const session = attempts.find(x => x.status === "fulfilled").value;
  const staffInput = input("staff-" + nonce,
    [line(hotpot.id, 1, variant.id, [topping.id]), line(combo.id)]);
  const staff = await service.staffTicket("waiter", branch.id, session.id, staffInput);
  assert.equal(staff.status, "APPROVED");
  assert.equal((await service.staffTicket("waiter", branch.id, session.id, staffInput)).replayed, true);
  await rejectsCode(service.staffTicket("waiter", branch.id, session.id,
    input(staffInput.idempotencyKey, [line(beef.id)])), "DINING_IDEMPOTENCY_REUSED");
  await rejectsCode(service.staffTicket("kitchen", branch.id, session.id,
    input("kitchen-" + nonce, [line(beef.id)])), "DINING_BRANCH_FORBIDDEN");
  const startingBill = await service.staffBill("cashier", branch.id, session.id);
  assert.equal(startingBill.subtotalVnd, 585_000, "variant + topping + combo priced at server");
  assert.equal(startingBill.tickets[0].items[0].unitPriceVnd, 400_000);
  const qr = await service.locator(nonce);
  assert.equal(qr.code, "A1");
  assert.equal(qr.branchId, branch.id, "guest menu uses authoritative public branch locator");
  assert.equal(Object.hasOwn(qr, "tableId"), false, "public locator does not expose internal table ID");
  assert.equal(Object.hasOwn(qr, "sessionId"), false, "public locator does not expose session");
  const granted = await service.issueGrant(nonce);
  assert.equal(granted.sessionId, session.id);
  assert.equal(granted.credential.length > 40, true);
  const guestAuth = "Dining " + granted.credential;
  const extended = await service.renewGuestGrant(guestAuth);
  assert.ok(new Date(extended.expiresAt).getTime() >= new Date(granted.expiresAt).getTime() - 2000);
  const isolatedGrant = await service.issueGrant(nonce);
  assert.deepEqual(await service.guestTickets("Dining " + isolatedGrant.credential), [],
    "a separate guest cannot read the first guest's tickets");
  const qrInput = input("guest-" + nonce, [line(beef.id, 2)]);
  const qrTicket = await service.guestTicket(guestAuth, qrInput);
  assert.equal(qrTicket.status, "PENDING_APPROVAL");
  assert.equal((await service.guestTicket(guestAuth, qrInput)).replayed, true);
  await rejectsCode(service.guestTicket(guestAuth,
    input(qrInput.idempotencyKey, [line(beef.id, 3)])), "DINING_IDEMPOTENCY_REUSED");
  assert.equal((await service.approvals("waiter", branch.id)).length, 1);
  assert.equal((await service.kitchen("kitchen", branch.id)).length, 1,
    "pending QR must not create kitchen work item");
  const kitchenBefore = await service.kitchen("kitchen", branch.id);
  assert.equal(Object.hasOwn(kitchenBefore[0].items[0], "unitPriceVnd"), false,
    "kitchen must not receive unit price");
  assert.equal(JSON.stringify(kitchenBefore).includes("priceVnd"), false,
    "kitchen must not receive modifier price details");
  await rejectsCode(service.staffBill("kitchen", branch.id, session.id),
    "DINING_BRANCH_FORBIDDEN");
  const privateBill = await service.guestBill(guestAuth);
  assert.equal(Object.hasOwn(privateBill, "paidVnd"), false, "guest must not read cash collection");
  assert.equal(Object.hasOwn(privateBill, "dueVnd"), false, "guest must not read cashier balance");
  assert.equal(Object.hasOwn(privateBill, "sessionId"), false, "guest must not read internal session ID");
  assert.equal((await service.guestBill(guestAuth)).subtotalVnd, 585_000,
    "pending QR cannot enter bill");
  const approvals = await Promise.all([
    service.review("waiter", branch.id, qrTicket.ticketId, "APPROVED"),
    service.review("owner", branch.id, qrTicket.ticketId, "APPROVED"),
  ]);
  assert.equal(approvals.filter(x => !x.replayed).length, 1, "one winner on concurrent approvals");
  assert.equal((await service.kitchen("kitchen", branch.id)).filter(x => x.id === qrTicket.ticketId).length, 1,
    "exactly one durable kitchen item");
  assert.equal((await service.staffBill("cashier", branch.id, session.id)).subtotalVnd, 745_000);
  await rejectsCode(service.review("waiter", branch.id, qrTicket.ticketId, "REJECTED", "No"),
    "DINING_REJECTION_REASON_REQUIRED");
  await rejectsCode(service.review("waiter", branch.id, qrTicket.ticketId, "REJECTED", "Hết hàng"),
    "DINING_TICKET_ALREADY_REVIEWED");
  const more = await service.guestTicket(guestAuth, input("extra-" + nonce, [line(beef.id)]));
  assert.equal(more.status, "PENDING_APPROVAL");
  const pending = await prisma.diningTicket.findUniqueOrThrow({ where: { id: more.ticketId } });
  await service.editPending("waiter", branch.id, more.ticketId, {
    expectedUpdatedAt: pending.updatedAt.toISOString(),
    customerNote: "Đổi sang lẩu",
    items: [line(hotpot.id, 1, variant.id)],
  });
  const edited = await prisma.diningTicketItem.findMany({ where: { ticketId: more.ticketId } });
  assert.equal(edited[0].lineTotalVnd, 370_000, "staff edits pending QR with server pricing");
  await rejectsCode(service.editPending("waiter", branch.id, more.ticketId, {
    expectedUpdatedAt: pending.updatedAt.toISOString(),
    items: [line(beef.id)],
  }), "DINING_TICKET_STALE");
  assert.equal((await service.staffBill("cashier", branch.id, session.id)).subtotalVnd, 745_000,
    "pending QR edit never changes bill before approval");
  await service.review("waiter", branch.id, more.ticketId, "REJECTED", "Khách đổi ý");
  await rejectsCode(service.editPending("waiter", branch.id, more.ticketId, {
    expectedUpdatedAt: pending.updatedAt.toISOString(), items: [line(beef.id)],
  }), "DINING_TICKET_ALREADY_REVIEWED");
  assert.equal((await service.staffBill("cashier", branch.id, session.id)).subtotalVnd, 745_000);
  const available = await prisma.product.update({
    where: { id: beef.id }, data: { isAvailable: false },
  });
  assert.equal(available.isAvailable, false);
  await rejectsCode(service.guestTicket(guestAuth,
    input("no-stock-" + nonce, [line(beef.id)])), "PRODUCT_UNAVAILABLE");
  await rejectsCode(service.close("cashier", branch.id, session.id), "DINING_BILL_UNPAID");
  await prisma.diningPayment.create({ data: {
    sessionId: session.id, branchId: branch.id, method: "CASH", amountVnd: 745_000,
    idempotencyKey: "paid-" + nonce, recordedById: cashier.id,
    confirmedById: cashier.id, confirmedAt: new Date(), status: "CONFIRMED",
  } });
  await service.close("cashier", branch.id, session.id);
  await rejectsCode(service.guestBill(guestAuth), "DINING_GUEST_EXPIRED");
  await rejectsCode(service.issueGrant("unknown-handle"), "DINING_QR_NOT_FOUND");
  const newSession = await service.open("waiter", branch.id, table.id, 2);
  assert.notEqual(newSession.id, session.id);
  const secondGrant = await service.issueGrant(nonce);
  const stale = await Promise.allSettled([
    service.guestTicket("Dining " + secondGrant.credential,
      input("close-race-" + nonce, [line(hotpot.id)])),
    service.close("owner", branch.id, newSession.id),
  ]);
  const current = await prisma.diningSession.findUnique({ where: { id: newSession.id } });
  assert.equal(stale.length, 2);
  assert.equal(current.status, "CLOSED", "session close wins after pending ticket or before it");
  assert.equal((await prisma.diningGuestGrant.count({
    where: { sessionId: newSession.id, revokedAt: null },
  })), 0, "all credentials revoked at close");
  const moving = await service.open("waiter", branch.id, table.id, 2);
  const oldGrant = await service.issueGrant(nonce);
  const target = await prisma.diningTable.create({ data: {
    branchId: branch.id, areaId: area.id, code: "B1", name: "Bàn B1",
    qrHandle: "B" + nonce,
  } });
  const occupied = await service.open("waiter", branch.id, target.id);
  await rejectsCode(service.transfer("waiter", branch.id, moving.id, table.id, target.id),
    "DINING_TABLE_OCCUPIED");
  await service.close("cashier", branch.id, occupied.id);
  await service.transfer("waiter", branch.id, moving.id, table.id, target.id);
  await rejectsCode(service.transfer("waiter", branch.id, moving.id, table.id, target.id),
    "DINING_TABLE_MOVED");
  await rejectsCode(service.guestBill("Dining " + oldGrant.credential), "DINING_GUEST_EXPIRED");
  await rejectsCode(service.issueGrant(nonce), "DINING_TABLE_NOT_OPEN");
  const newGrant = await service.issueGrant("B" + nonce);
  assert.equal(newGrant.sessionId, moving.id);
  await service.close("cashier", branch.id, moving.id);
  await rejectsCode(service.guestBill("Dining " + newGrant.credential), "DINING_GUEST_EXPIRED");
  // L03: Admin tables and QR operations are scoped, not permitted to WAITER/KITCHEN.
  await rejectsCode(service.configuration("waiter", branch.id), "DINING_BRANCH_FORBIDDEN");
  await rejectsCode(service.createArea("waiter", branch.id, { name: "Sân vườn", sortOrder: 10 }),
    "DINING_BRANCH_FORBIDDEN");
  const garden = await service.createArea("owner", branch.id, {
    name: " Sân   vườn ", sortOrder: 10,
  });
  assert.equal(garden.name, "Sân vườn");
  const config = await service.configuration("owner", branch.id);
  assert.equal(config.areas.some(a => a.id === garden.id), true);
  const table2 = await service.createTable("owner", branch.id, {
    areaId: garden.id, code: "C1", name: "Bàn C1", sortOrder: 20,
  });
  assert.ok(table2.qrHandle.length >= 16);
  assert.notEqual(table2.qrHandle, nonce);
  assert.equal((await service.locator(table2.qrHandle)).code, "C1");
  await rejectsCode(service.createTable("owner", branch.id, {
    areaId: area.id, code: "C1", name: "Trùng mã", sortOrder: 0,
  }), "DINING_TABLE_CODE_EXISTS");
  await rejectsCode(service.createTable("waiter", foreign.id, {
    areaId: area.id, code: "C2", name: "Sai khu vực", sortOrder: 0,
  }), "DINING_BRANCH_FORBIDDEN");
  await rejectsCode(service.editTable("owner", foreign.id, table2.id, { name: "Hack" }),
    "DINING_TABLE_NOT_FOUND");
  // Opening a table pins its physical identity until cashier closes it.
  const dine = await service.open("waiter", branch.id, table2.id);
  await rejectsCode(service.editTable("owner", branch.id, table2.id, { isActive: false }),
    "DINING_TABLE_HAS_OPEN_SESSION");
  await rejectsCode(service.editArea("owner", branch.id, garden.id, { isActive: false }),
    "DINING_AREA_HAS_OPEN_TABLES");
  const grant3 = await service.issueGrant(table2.qrHandle);
  const guest3 = await service.guestTicket("Dining " + grant3.credential,
    input("qr-rotate-" + nonce, [line(hotpot.id)]));
  assert.equal(guest3.status, "PENDING_APPROVAL");
  const changed = await service.rotateQr("owner", branch.id, table2.id);
  assert.notEqual(changed.qrHandle, table2.qrHandle);
  await rejectsCode(service.locator(table2.qrHandle), "DINING_QR_NOT_FOUND");
  await rejectsCode(service.guestBill("Dining " + grant3.credential), "DINING_GUEST_EXPIRED");
  const canceled = await prisma.diningTicket.findUnique({ where: { id: guest3.ticketId } });
  assert.equal(canceled.status, "REJECTED", "rotating QR revokes pending QR requests");
  const grant4 = await service.issueGrant(changed.qrHandle);
  assert.equal(grant4.sessionId, dine.id);
  await service.close("cashier", branch.id, dine.id);
  await service.editTable("owner", branch.id, table2.id, { isActive: false });
  await service.editArea("owner", branch.id, garden.id, { isActive: false });
  await rejectsCode(service.locator(changed.qrHandle), "DINING_QR_NOT_FOUND");
  const savedArea = await service.editArea("owner", branch.id, garden.id,
    { isActive: true, name: "Sân vườn 2", sortOrder: 5 });
  assert.equal(savedArea.name, "Sân vườn 2");
  const savedTable = await service.editTable("owner", branch.id, table2.id,
    { isActive: true, code: "C8", name: "Bàn C8", sortOrder: 7 });
  assert.equal(savedTable.code, "C8");
  assert.equal(savedTable.qrHandle, changed.qrHandle, "QR remains stable across ordinary edits");
  assert.equal((await prisma.order.count({ where: { branchId: branch.id } })), 0,
    "dine-in must not create delivery orders");
  console.log("PASS L02 dining branch auth, concurrent open/approve, idempotent staff/QR, pricing, bill, kitchen, stock, close/revoke, transfer, pending edits");
} finally {
  await prisma.$disconnect();
}
