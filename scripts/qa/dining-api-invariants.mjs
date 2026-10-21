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
  assert.equal(Object.hasOwn(qr, "sessionId"), false, "public locator does not expose session");
  const granted = await service.issueGrant(nonce);
  assert.equal(granted.sessionId, session.id);
  assert.equal(granted.credential.length > 40, true);
  const guestAuth = "Dining " + granted.credential;
  const qrInput = input("guest-" + nonce, [line(beef.id, 2)]);
  const qrTicket = await service.guestTicket(guestAuth, qrInput);
  assert.equal(qrTicket.status, "PENDING_APPROVAL");
  assert.equal((await service.guestTicket(guestAuth, qrInput)).replayed, true);
  await rejectsCode(service.guestTicket(guestAuth,
    input(qrInput.idempotencyKey, [line(beef.id, 3)])), "DINING_IDEMPOTENCY_REUSED");
  assert.equal((await service.approvals("waiter", branch.id)).length, 1);
  assert.equal((await service.kitchen("kitchen", branch.id)).length, 1,
    "pending QR must not create kitchen work item");
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
  await service.review("waiter", branch.id, more.ticketId, "REJECTED", "Khách đổi ý");
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
  assert.equal((await prisma.order.count({ where: { branchId: branch.id } })), 0,
    "dine-in must not create delivery orders");
  console.log("PASS L02 dining branch auth, concurrent open/approve, idempotent staff/QR, pricing, bill, kitchen, stock, close/revoke");
} finally {
  await prisma.$disconnect();
}
