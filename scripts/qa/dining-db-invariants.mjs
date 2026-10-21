// L01 database-only acceptance test. Refuses remote/prod connections, and
// never resets/deletes any database. CI uses a disposable localhost database.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const expected = "postgresql://hotpot_ci:hotpot_ci_only@127.0.0.1:5432/hotpot_ci?schema=public";
if (process.env.DATABASE_URL !== expected || process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("Dining database test may run only on disposable CI Postgres");
}
const prisma = new PrismaClient();
const hash = value => createHash("sha256").update(value).digest("hex");
const nonce = randomUUID().replaceAll("-", "");
try {
  const employee = await prisma.user.create({ data: { role: "WAITER" } });
  const branch1 = await prisma.branch.create({
    data: { code: "L01-" + nonce.slice(0, 12), name: "L01 isolated branch A", latitude: 10, longitude: 106 },
  });
  const branch2 = await prisma.branch.create({
    data: { code: "L01-" + nonce.slice(12, 24), name: "L01 isolated branch B", latitude: 10, longitude: 106 },
  });
  await prisma.branchMember.create({ data: { userId: employee.id, branchId: branch1.id, role: "WAITER" } });
  const area1 = await prisma.diningArea.create({ data: { branchId: branch1.id, name: "Tầng 1" } });
  const area2 = await prisma.diningArea.create({ data: { branchId: branch2.id, name: "VIP" } });
  const table = await prisma.diningTable.create({
    data: { branchId: branch1.id, areaId: area1.id, code: "A1", name: "Bàn A1", qrHandle: nonce },
  });

  await assert.rejects(
    prisma.diningTable.create({
      data: { branchId: branch1.id, areaId: area2.id, code: "CROSS", name: "Cross-branch", qrHandle: randomUUID() },
    }),
    /foreign key|constraint|P2003/i,
    "Area and table may not cross branches",
  );
  await assert.rejects(
    prisma.diningSession.create({
      data: { branchId: branch2.id, tableId: table.id, openedById: employee.id },
    }),
    /foreign key|constraint|P2003/i,
    "Session may not impersonate a foreign branch",
  );

  // Independent concurrent requests cannot create two active table sessions.
  const opens = await Promise.allSettled([
    prisma.diningSession.create({ data: { branchId: branch1.id, tableId: table.id, openedById: employee.id } }),
    prisma.diningSession.create({ data: { branchId: branch1.id, tableId: table.id, openedById: employee.id } }),
  ]);
  const opened = opens.filter(x => x.status === "fulfilled");
  assert.equal(opened.length, 1, "Exactly one concurrent open must win");
  assert.equal(opens.filter(x => x.status === "rejected").length, 1);
  const session = opened[0].value;

  const grant = await prisma.diningGuestGrant.create({
    data: { branchId: branch1.id, sessionId: session.id, tokenHash: hash(nonce), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const data = {
    branchId: branch1.id, sessionId: session.id, guestGrantId: grant.id,
    source: "QR", idempotencyKey: "qr-" + nonce, requestHash: hash("ticket-" + nonce),
  };
  const ticket = await prisma.diningTicket.create({ data });
  assert.equal(ticket.status, "PENDING_APPROVAL");
  await assert.rejects(prisma.diningTicket.create({ data }), /unique|P2002/i, "Repeated QR requests must be idempotent");
  await assert.rejects(
    prisma.diningTicket.create({ data: { ...data, guestGrantId: null, idempotencyKey: "invalid-" + nonce } }),
    /constraint|check|P2004|P2010/i,
    "QR ticket must have a guest grant",
  );
  await prisma.diningTicketItem.create({
    data: { ticketId: ticket.id, productName: "Test", selectionSnapshot: {}, quantity: 2,
      unitPriceVnd: 10_000, lineTotalVnd: 20_000 },
  });
  await assert.rejects(
    prisma.diningTicketItem.create({
      data: { ticketId: ticket.id, productName: "Tampered price", selectionSnapshot: {}, quantity: 2,
        unitPriceVnd: 10_000, lineTotalVnd: 1 },
    }),
    /constraint|check|P2004|P2010/i,
    "Mismatched line item price must be rejected by the database",
  );
  await prisma.diningAuditEvent.create({
    data: { branchId: branch1.id, sessionId: session.id, action: "L01_CONTRACT_TEST", details: { actor: "CI" } },
  });

  await prisma.diningSession.update({
    where: { id: session.id },
    data: { status: "CLOSED", closedAt: new Date(), closedById: employee.id },
  });
  const next = await prisma.diningSession.create({
    data: { branchId: branch1.id, tableId: table.id, openedById: employee.id },
  });
  await assert.rejects(
    prisma.diningTicket.create({
      data: { ...data, sessionId: next.id, idempotencyKey: "session-swap-" + nonce },
    }),
    /foreign key|constraint|P2003/i,
    "Guest grants are bound to the original session",
  );
  await assert.rejects(
    prisma.diningPayment.create({ data: {
      branchId: branch1.id, sessionId: next.id, method: "QR", amountVnd: -1,
      idempotencyKey: "invalid-pay-" + nonce, recordedById: employee.id,
    } }),
    /constraint|check|P2004|P2010/i,
    "Negative payments must not be recorded",
  );
  const pay = await prisma.diningPayment.create({ data: {
    branchId: branch1.id, sessionId: next.id, method: "QR", amountVnd: 50_000,
    idempotencyKey: "pending-pay-" + nonce, recordedById: employee.id,
  } });
  assert.equal(pay.status, "PENDING", "Displaying QR is not proof of payment");
  console.log("PASS dine-in L01 unique active session, branch isolation, QR grant scope, idempotency, VND constraints");
} finally {
  await prisma.$disconnect();
}
