import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import supertest from "supertest";

const require = createRequire(import.meta.url);
const { NestFactory } = require("@nestjs/core");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const { AppModule } = require("../dist/app.module.js");
const { configureApp } = require("../dist/bootstrap.js");
const secret = "p4-order-queue-ci-only-secret-1234567890";
process.env.AUTH_JWT_SECRET = secret;
process.env.CORS_ALLOWED_ORIGINS = "http://localhost:8081";

let app, client, db, branchId, otherBranchId, pendingId, kitchenId;
let owner, manager, kitchen, outsider;
const headers = auth => ({ Authorization: "Bearer " + auth });
const branchBase = () => "/admin/orders/" + branchId;

async function user(role, membershipRole) {
  const record = await db.user.create({ data: { role }, select: { id: true } });
  if (membershipRole) await db.branchMember.create({
    data: { userId: record.id, branchId, role: membershipRole },
  });
  const session = await db.authSession.create({
    data: { userId: record.id, refreshTokenHash: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 300000) }, select: { id: true },
  });
  const token = jwt.sign({ sid: session.id }, secret, {
    algorithm: "HS256", issuer: "sichuan-hotpot", audience: "sichuan-hotpot-api",
    subject: record.id, expiresIn: "5m",
  });
  return { id: record.id, token };
}
async function order(status, key = randomUUID(), branch = branchId) {
  return db.order.create({ data: {
    branchId: branch, customerId: outsider.id, deliveryPolicyVersionId:
      (await db.deliveryPolicyVersion.findFirstOrThrow({ where: { branchId: branch } })).id,
    idempotencyKey: key, status,
    subtotalVnd: 125000, deliveryFeeVnd: 15000, totalVnd: 140000,
    roadDistanceMeters: 2100, addressLineSnapshot: "12 Đường bí mật",
    phoneSnapshot: "+84901111222", latitudeSnapshot: "10.7731", longitudeSnapshot: "106.7032",
    items: { create: [{ productName: "Lẩu thử", quantity: 2,
      unitPriceVnd: 62500, lineTotalVnd: 125000 }] },
    statusHistory: { create: { toStatus: status, actorId: outsider.id } },
  }, select: { id: true } });
}
before(async () => {
  assert.ok(process.env.DATABASE_URL?.includes("hotpot_ci"), "disposable CI Postgres only");
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
  client = supertest(app.getHttpServer());
  db = new PrismaClient();
  const branch = await db.branch.create({
    data: { code: "queue-" + randomUUID(), name: "Bếp một",
      latitude: "10.77", longitude: "106.70" },
  });
  branchId = branch.id;
  const other = await db.branch.create({
    data: { code: "queue-" + randomUUID(), name: "Bếp hai",
      latitude: "10.78", longitude: "106.71" },
  });
  otherBranchId = other.id;
  for (const id of [branchId, otherBranchId]) {
    await db.deliveryPolicyVersion.create({ data: {
      branchId: id, version: 1, acceptingOrders: true,
      baseMeters: 2000, baseFeeVnd: 10000, extraStepMeters: 1000,
      extraStepFeeVnd: 5000, maxRoadMeters: 12000, minSubtotalVnd: 50000,
    } });
  }
  outsider = await user("CUSTOMER");
  [owner, manager, kitchen] = await Promise.all([
    user("OWNER"), user("CUSTOMER", "MANAGER"), user("CUSTOMER", "KITCHEN"),
  ]);
  pendingId = (await order("PENDING")).id;
  kitchenId = (await order("CONFIRMED")).id;
});
after(async () => { if (app) await app.close(); if (db) await db.$disconnect(); });

test("branch queue is staff scoped and never accessible to unrelated CUSTOMER", async () => {
  const listed = await client.get("/admin/orders/branches")
    .set(headers(kitchen.token)).expect(200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].staffRole, "KITCHEN");
  assert.equal(listed.body[0].id, branchId);
  const all = await client.get("/admin/orders/branches")
    .set(headers(owner.token)).expect(200);
  assert.ok(all.body.some(b => b.id === otherBranchId));
  await client.get(branchBase()).set(headers(outsider.token)).expect(403);
  await client.get("/admin/orders/" + otherBranchId)
    .set(headers(kitchen.token)).expect(403);
  await client.get(branchBase()).expect(401);
  await client.get(branchBase()).set(headers(manager.token)).expect(200);
});

test("kitchen detail excludes phone/address while OWNER detail keeps delivery snapshot", async () => {
  const kitchenResponse = await client.get(branchBase() + "/" + kitchenId)
    .set(headers(kitchen.token)).expect(200);
  assert.equal(kitchenResponse.body.addressLineSnapshot, undefined);
  assert.equal(kitchenResponse.body.phoneSnapshot, undefined);
  assert.equal(kitchenResponse.body.items[0].productName, "Lẩu thử");
  const ownerResponse = await client.get(branchBase() + "/" + kitchenId)
    .set(headers(owner.token)).expect(200);
  assert.equal(ownerResponse.body.phoneSnapshot, "+84901111222");
  assert.equal(ownerResponse.body.addressLineSnapshot, "12 Đường bí mật");
  await client.get(branchBase() + "/" + randomUUID())
    .set(headers(manager.token)).expect(404);
  await client.get("/admin/orders/" + otherBranchId + "/" + kitchenId)
    .set(headers(owner.token)).expect(404);
});

test("two concurrent staff actions may accept pending only once and append one audit history", async () => {
  const url = branchBase() + "/" + pendingId + "/status";
  const body = { expectedStatus: "PENDING", toStatus: "CONFIRMED" };
  const results = await Promise.all([
    client.patch(url).set(headers(owner.token)).send(body),
    client.patch(url).set(headers(manager.token)).send(body),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: pendingId } })).status, "CONFIRMED");
  const audit = await db.orderStatusHistory.findMany({
    where: { orderId: pendingId, fromStatus: "PENDING", toStatus: "CONFIRMED" },
  });
  assert.equal(audit.length, 1);
  assert.ok([owner.id, manager.id].includes(audit[0].actorId));
  await client.patch(url).set(headers(owner.token)).send(body).expect(409);
});

test("kitchen can prepare and mark ready, but cannot confirm or reject customer orders", async () => {
  const reject = await order("PENDING");
  const target = branchBase() + "/" + reject.id + "/status";
  await client.patch(target).set(headers(kitchen.token))
    .send({ expectedStatus: "PENDING", toStatus: "CONFIRMED" }).expect(409);
  await client.patch(target).set(headers(kitchen.token))
    .send({ expectedStatus: "PENDING", toStatus: "CANCELED", reason: "Không nhận được" }).expect(409);

  const url = branchBase() + "/" + kitchenId + "/status";
  await client.patch(url).set(headers(kitchen.token))
    .send({ expectedStatus: "CONFIRMED", toStatus: "PREPARING" }).expect(200);
  await client.patch(url).set(headers(kitchen.token))
    .send({ expectedStatus: "PREPARING", toStatus: "READY" }).expect(200);
  await client.patch(url).set(headers(kitchen.token))
    .send({ expectedStatus: "READY", toStatus: "DELIVERING" }).expect(400);
  const row = await db.order.findUniqueOrThrow({ where: { id: kitchenId } });
  assert.equal(row.status, "READY");
  assert.equal(await db.orderStatusHistory.count({ where: { orderId: kitchenId } }), 3);
});

test("rejection requires reason and reason is retained in history; no status mutation on invalid", async () => {
  const pending = await order("PENDING");
  const url = branchBase() + "/" + pending.id + "/status";
  await client.patch(url).set(headers(manager.token))
    .send({ expectedStatus: "PENDING", toStatus: "CANCELED" }).expect(400);
  await client.patch(url).set(headers(manager.token))
    .send({ expectedStatus: "PENDING", toStatus: "CANCELED", reason: "abc" }).expect(400);
  await client.patch(url).set(headers(manager.token))
    .send({ expectedStatus: "PENDING", toStatus: "CANCELED", reason: "Khách đổi ý" }).expect(200);
  const history = await db.orderStatusHistory.findFirstOrThrow({
    where: { orderId: pending.id, toStatus: "CANCELED" },
  });
  assert.equal(history.reason, "Khách đổi ý");
  assert.equal(history.actorId, manager.id);
  await client.patch(url).set(headers(manager.token))
    .send({ expectedStatus: "CANCELED", toStatus: "CONFIRMED" }).expect(409);
  const other = await order("PENDING", randomUUID(), otherBranchId);
  await client.patch("/admin/orders/" + otherBranchId + "/" + other.id + "/status")
    .set(headers(manager.token)).send({
      expectedStatus: "PENDING", toStatus: "CONFIRMED",
    }).expect(403);
});
