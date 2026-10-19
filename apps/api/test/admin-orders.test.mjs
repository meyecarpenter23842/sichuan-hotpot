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
let owner, manager, kitchen, driver, outsider;
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
  const ciUrl = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
  assert.ok(ciUrl.protocol === "postgresql:" &&
    ["localhost", "127.0.0.1"].includes(ciUrl.hostname) &&
    ["/hotpot_ci", "/hotpot_api_release_check"].includes(ciUrl.pathname),
  "disposable CI Postgres only");
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
  [owner, manager, kitchen, driver] = await Promise.all([
    user("OWNER"), user("CUSTOMER", "MANAGER"), user("CUSTOMER", "KITCHEN"),
    user("CUSTOMER", "DRIVER"),
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
  const kitchenList = await client.get(branchBase()).set(headers(kitchen.token)).expect(200);
  assert.equal(kitchenList.body[0].totalVnd, undefined);
  assert.equal(kitchenList.body[0].payment, undefined);
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
  assert.equal(kitchenResponse.body.latitudeSnapshot, undefined);
  assert.equal(kitchenResponse.body.longitudeSnapshot, undefined);
  assert.equal(kitchenResponse.body.totalVnd, undefined);
  assert.equal(kitchenResponse.body.payment, undefined);
  assert.equal(kitchenResponse.body.items[0].lineTotalVnd, undefined);
  assert.equal(kitchenResponse.body.items[0].productName, "Lẩu thử");
  const ownerResponse = await client.get(branchBase() + "/" + kitchenId)
    .set(headers(owner.token)).expect(200);
  assert.equal(ownerResponse.body.phoneSnapshot, "+84901111222");
  assert.equal(ownerResponse.body.addressLineSnapshot, "12 Đường bí mật");
  assert.equal(ownerResponse.body.latitudeSnapshot, "10.7731");
  assert.equal(ownerResponse.body.longitudeSnapshot, "106.7032");
  const managerResponse = await client.get(branchBase() + "/" + kitchenId)
    .set(headers(manager.token)).expect(200);
  assert.equal(managerResponse.body.latitudeSnapshot, "10.7731");
  assert.equal(managerResponse.body.longitudeSnapshot, "106.7032");
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
    .send({ expectedStatus: "READY", toStatus: "DELIVERING" }).expect(409);
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


test("OWNER/MANAGER can finish store self-delivery and COD settles atomically", async () => {
  const ready = await order("READY");
  await db.payment.create({
    data: { orderId: ready.id, method: "COD", status: "PENDING", amountVnd: 140000 },
  });
  const url = branchBase() + "/" + ready.id + "/status";
  await client.patch(url).set(headers(manager.token))
    .send({ expectedStatus: "READY", toStatus: "DELIVERING" }).expect(200);
  await client.patch(url).set(headers(manager.token))
    .send({ expectedStatus: "DELIVERING", toStatus: "DELIVERED" }).expect(200);

  const finished = await db.order.findUniqueOrThrow({
    where: { id: ready.id }, include: { payment: true },
  });
  assert.equal(finished.status, "DELIVERED");
  assert.equal(finished.payment.status, "CONFIRMED");
  const history = await db.orderStatusHistory.findMany({
    where: { orderId: ready.id }, orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(history.slice(-2).map(row => row.toStatus), ["DELIVERING", "DELIVERED"]);

  await client.patch(url).set(headers(owner.token))
    .send({ expectedStatus: "DELIVERED", toStatus: "DELIVERING" }).expect(409);
});

test("QR is never auto-confirmed by delivery completion and failed delivery requires reason", async () => {
  const delivering = await order("DELIVERING");
  await db.payment.create({
    data: { orderId: delivering.id, method: "QR", status: "PENDING", amountVnd: 140000 },
  });
  const url = branchBase() + "/" + delivering.id + "/status";
  await client.patch(url).set(headers(owner.token))
    .send({ expectedStatus: "DELIVERING", toStatus: "DELIVERY_FAILED" }).expect(400);
  await client.patch(url).set(headers(owner.token))
    .send({
      expectedStatus: "DELIVERING", toStatus: "DELIVERY_FAILED",
      reason: "Khách không nghe máy",
    }).expect(200);
  await client.patch(url).set(headers(manager.token))
    .send({ expectedStatus: "DELIVERY_FAILED", toStatus: "DELIVERING" }).expect(200);
  await client.patch(url).set(headers(manager.token))
    .send({ expectedStatus: "DELIVERING", toStatus: "DELIVERED" }).expect(200);

  const payment = await db.payment.findUniqueOrThrow({ where: { orderId: delivering.id } });
  assert.equal(payment.status, "PENDING");
});

test("manager edits pending/confirmed order with authoritative catalog pricing and immutable audit", async () => {
  const category = await db.catalogCategory.create({
    data: { branchId, name: "Món sửa " + randomUUID(), sortOrder: 99 },
  });
  const product = await db.product.create({
    data: {
      categoryId: category.id, name: "Lẩu thay thế", priceVnd: 100000,
      variants: { create: [{ name: "Lớn", priceDeltaVnd: 20000 }] },
      modifierGroups: { create: [{
        name: "Topping sửa", minSelect: 0, maxSelect: 2,
        options: { create: [{ name: "Bò thêm", priceDeltaVnd: 10000 }] },
      }] },
    },
    include: { variants: true, modifierGroups: { include: { options: true } } },
  });
  const variant = product.variants[0];
  const option = product.modifierGroups[0].options[0];

  const editable = await order("CONFIRMED");
  await db.payment.create({
    data: { orderId: editable.id, method: "COD", status: "PENDING", amountVnd: 140000 },
  });
  const detail = await client.get(branchBase() + "/" + editable.id)
    .set(headers(manager.token)).expect(200);

  const url = branchBase() + "/" + editable.id + "/items";
  const payload = {
    expectedStatus: "CONFIRMED",
    expectedUpdatedAt: detail.body.updatedAt,
    reason: "Món cũ hết, khách đồng ý đổi",
    items: [{
      productId: product.id, variantId: variant.id,
      modifierIds: [option.id, option.id], quantity: 1, pricingMode: "SEPARATE",
    }],
  };
  await client.put(url).set(headers(manager.token)).send(payload).expect(200);

  const changed = await db.order.findUniqueOrThrow({
    where: { id: editable.id },
    include: { items: { include: { modifiers: true } }, payment: true, edits: true },
  });
  assert.equal(changed.subtotalVnd, 140000);
  assert.equal(changed.deliveryFeeVnd, 15000);
  assert.equal(changed.totalVnd, 155000);
  assert.equal(changed.payment.amountVnd, 155000);
  assert.equal(changed.items.length, 1);
  assert.equal(changed.items[0].productId, product.id);
  assert.equal(changed.items[0].variantId, variant.id);
  assert.equal(changed.items[0].pricingMode, "SEPARATE");
  assert.equal(changed.items[0].modifiers.length, 2);
  assert.ok(changed.items[0].modifiers.every(row => row.optionId === option.id));
  assert.equal(changed.edits.length, 1);
  assert.equal(changed.edits[0].reason, "Món cũ hết, khách đồng ý đổi");
  assert.equal(changed.edits[0].beforeTotalVnd, 140000);
  assert.equal(changed.edits[0].afterTotalVnd, 155000);

  await client.put(url).set(headers(manager.token)).send(payload).expect(409);
  await client.put(url).set(headers(kitchen.token)).send({
    ...payload, expectedUpdatedAt: changed.updatedAt.toISOString(),
  }).expect(403);
});

test("order edit rejects unavailable catalog data and settled payments without mutating items", async () => {
  const category = await db.catalogCategory.create({
    data: { branchId, name: "Hết hàng " + randomUUID(), sortOrder: 100 },
  });
  const unavailable = await db.product.create({
    data: { categoryId: category.id, name: "Món hết", priceVnd: 90000, isAvailable: false },
  });
  const editable = await order("PENDING");
  await db.payment.create({
    data: { orderId: editable.id, method: "QR", status: "CONFIRMED", amountVnd: 140000 },
  });
  const detail = await client.get(branchBase() + "/" + editable.id)
    .set(headers(owner.token)).expect(200);
  await client.put(branchBase() + "/" + editable.id + "/items")
    .set(headers(owner.token)).send({
      expectedStatus: "PENDING", expectedUpdatedAt: detail.body.updatedAt,
      reason: "Thử thay món đã hết",
      items: [{ productId: unavailable.id, variantId: null, modifierIds: [], quantity: 1 }],
    }).expect(409);
  assert.equal(await db.orderItem.count({ where: { orderId: editable.id } }), 1);
  assert.equal(await db.orderEditAudit.count({ where: { orderId: editable.id } }), 0);
});

test("L04 driver sees ONLY assigned orders and their delivery/COD data, never another order", async () => {
  const assigned = await order("READY");
  const unassigned = await order("READY");
  await db.payment.create({ data: { orderId: assigned.id, method: "COD",
    status: "PENDING", amountVnd: 140000 } });
  const url = branchBase() + "/" + assigned.id;
  const roster = await client.get(branchBase() + "/drivers")
    .set(headers(manager.token)).expect(200);
  assert.ok(roster.body.some(d => d.userId === driver.id));
  await client.get(branchBase() + "/drivers").set(headers(driver.token)).expect(403);
  await client.put(url + "/driver").set(headers(driver.token))
    .send({ driverId: driver.id }).expect(403);
  await client.put(url + "/driver").set(headers(manager.token))
    .send({ driverId: outsider.id }).expect(400);
  await client.put(url + "/driver").set(headers(kitchen.token))
    .send({ driverId: driver.id }).expect(403);
  await client.put(url + "/driver").set(headers(owner.token))
    .send({ driverId: driver.id }).expect(200);
  const assignment = await db.deliveryAssignment.findUniqueOrThrow({
    where: { orderId: assigned.id },
  });
  assert.equal(assignment.driverId, driver.id);
  const list = await client.get(branchBase()).set(headers(driver.token)).expect(200);
  assert.ok(list.body.some(o => o.id === assigned.id));
  assert.ok(!list.body.some(o => o.id === unassigned.id));
  assert.equal(list.body.find(o => o.id === assigned.id).payment.method, "COD");
  assert.equal(list.body.find(o => o.id === assigned.id).subtotalVnd, undefined);
  assert.equal(list.body.find(o => o.id === assigned.id).phoneSnapshot, undefined);
  const detail = await client.get(url).set(headers(driver.token)).expect(200);
  assert.equal(detail.body.phoneSnapshot, "+84901111222");
  assert.equal(detail.body.addressLineSnapshot, "12 Đường bí mật");
  assert.equal(detail.body.latitudeSnapshot, "10.7731");
  assert.equal(detail.body.longitudeSnapshot, "106.7032");
  assert.equal(detail.body.totalVnd, 140000);
  assert.equal(detail.body.edits, undefined);
  assert.equal(detail.body.subtotalVnd, undefined);
  await client.get(branchBase() + "/" + unassigned.id)
    .set(headers(driver.token)).expect(404);
  await client.patch(branchBase() + "/" + unassigned.id + "/status")
    .set(headers(driver.token))
    .send({ expectedStatus: "READY", toStatus: "DELIVERING" }).expect(404);
  await client.patch(url + "/status").set(headers(driver.token))
    .send({ expectedStatus: "READY", toStatus: "DELIVERED" }).expect(409);
  await client.patch(url + "/status").set(headers(driver.token))
    .send({ expectedStatus: "READY", toStatus: "DELIVERING" }).expect(200);
  await client.put(url + "/driver").set(headers(manager.token))
    .send({ driverId: driver.id }).expect(409);
  await client.patch(url + "/status").set(headers(driver.token))
    .send({ expectedStatus: "DELIVERING", toStatus: "DELIVERED" }).expect(200);
  const finished = await db.order.findUniqueOrThrow({
    where: { id: assigned.id }, include: { payment: true },
  });
  assert.equal(finished.payment.status, "CONFIRMED");
  assert.equal(finished.status, "DELIVERED");
  const history = await db.orderStatusHistory.findMany({ where: { orderId: assigned.id },
    orderBy: { createdAt: "asc" } });
  assert.deepEqual(history.slice(-2).map(h => h.toStatus), ["DELIVERING", "DELIVERED"]);
  assert.deepEqual(history.slice(-2).map(h => h.actorId), [driver.id, driver.id]);
  await client.patch(url + "/status").set(headers(driver.token))
    .send({ expectedStatus: "DELIVERED", toStatus: "DELIVERING" }).expect(409);
});

test("L04 failed delivery can be reassigned, but an unassigned driver has no authority", async () => {
  const failed = await order("DELIVERY_FAILED");
  const url = branchBase() + "/" + failed.id;
  await client.put(url + "/driver").set(headers(manager.token))
    .send({ driverId: driver.id }).expect(200);
  await client.patch(url + "/status").set(headers(driver.token))
    .send({ expectedStatus: "DELIVERY_FAILED", toStatus: "DELIVERING" }).expect(200);
  await client.patch(url + "/status").set(headers(driver.token))
    .send({ expectedStatus: "DELIVERING", toStatus: "DELIVERY_FAILED",
      reason: "Không liên hệ được khách" }).expect(200);
  await client.put(url + "/driver").set(headers(manager.token))
    .send({ driverId: driver.id }).expect(200);
  await client.patch(url + "/status").set(headers(kitchen.token))
    .send({ expectedStatus: "DELIVERY_FAILED", toStatus: "DELIVERING" }).expect(409);
});


test("L06 order lanes show history despite >100 newer orders and paginate same-timestamp ties", async () => {
  const policy = (await db.deliveryPolicyVersion.findFirstOrThrow({ where: { branchId } })).id;
  const timestamp = new Date("2024-01-01T12:00:00.000Z");
  const pending = Array.from({ length: 112 }, () => ({
    id: randomUUID(), branchId, customerId: outsider.id,
    deliveryPolicyVersionId: policy, idempotencyKey: randomUUID(),
    status: "PENDING", roadDistanceMeters: 2100,
    subtotalVnd: 100000, deliveryFeeVnd: 10000,
    totalVnd: 110000, latitudeSnapshot: "10.7731", longitudeSnapshot: "106.7032",
    addressLineSnapshot: "Nhiều đơn trên cùng timestamp", createdAt: timestamp,
  }));
  await db.order.createMany({ data: pending });
  const first = await client.get(branchBase() + "/pages?group=new&limit=25")
    .set(headers(manager.token)).expect(200);
  assert.ok(first.body.total >= 112);
  assert.equal(first.body.items.length, 25);
  assert.ok(first.body.nextCursor);
  const ids = new Set(first.body.items.map(o => o.id));
  let next = first.body.nextCursor;
  let rounds = 0;
  while (next && rounds++ < 12) {
    const response = await client.get(branchBase() + "/pages?group=new&limit=25&cursor=" + next)
      .set(headers(owner.token)).expect(200);
    for (const row of response.body.items) {
      assert.ok(!ids.has(row.id), "cursor must never duplicate a row");
      ids.add(row.id);
    }
    next = response.body.nextCursor;
  }
  assert.equal(next, null, "history must eventually finish");
  assert.ok(pending.every(item => ids.has(item.id)));
  const historical = await order("DELIVERED");
  const history = await client.get(branchBase() + "/pages?group=history")
    .set(headers(manager.token)).expect(200);
  assert.ok(history.body.items.some(row => row.id === historical.id),
    "completed orders must not disappear behind the 100-order cap");
  const kitchenPage = await client.get(branchBase() + "/pages?group=kitchen")
    .set(headers(kitchen.token)).expect(200);
  assert.ok(kitchenPage.body.items.every(row => row.phoneSnapshot === undefined
    && row.payment === undefined && row.totalVnd === undefined));
  await client.get(branchBase() + "/pages?group=history").set(headers(kitchen.token)).expect(403);
  await client.get(branchBase() + "/pages?group=new").set(headers(driver.token)).expect(403);
  const driverPage = await client.get(branchBase() + "/pages?group=delivery")
    .set(headers(driver.token)).expect(200);
  assert.ok(driverPage.body.items.every(row => row.phoneSnapshot === undefined));
  const foreign = await order("PENDING", randomUUID(), otherBranchId);
  await client.get(branchBase() + "/pages?group=new&cursor=" + foreign.id)
    .set(headers(owner.token)).expect(400);
  await client.get(branchBase() + "/pages?group=new&cursor=" + randomUUID())
    .set(headers(owner.token)).expect(400);
  await client.get(branchBase() + "/pages?group=wrong")
    .set(headers(owner.token)).expect(400);
  await client.get(branchBase() + "/pages?group=new&limit=51")
    .set(headers(owner.token)).expect(400);
  await client.get(branchBase() + "/pages?group=new")
    .set(headers(outsider.token)).expect(403);
});


test("daily overview is complete, branch-scoped and uses delivery history rather than updatedAt", async () => {
  const url = branchBase() + "/summary";
  const old = (await client.get(url).set(headers(owner.token)).expect(200)).body;
  const day = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
    - 7 * 60 * 60 * 1000);
  assert.equal(old.date, day.toISOString().slice(0, 10));

  const deliveredCases = [
    ["COD", "CONFIRMED"],
    ["QR", "CONFIRMED"],
    ["QR", "PENDING"],
    ["QR", "REFUNDED"],
  ];
  for (const [method, status] of deliveredCases) {
    const delivered = await order("DELIVERED");
    await db.payment.create({ data: {
      orderId: delivered.id, method, status, amountVnd: 140000,
    } });
  }
  const duplicate = await order("DELIVERED");
  await db.payment.create({ data: {
    orderId: duplicate.id, method: "COD", status: "CONFIRMED", amountVnd: 140000,
  } });
  await db.orderStatusHistory.create({ data: {
    orderId: duplicate.id, toStatus: "DELIVERED", actorId: owner.id,
  } });

  const yesterday = await order("DELIVERED");
  await db.orderStatusHistory.updateMany({ where: { orderId: yesterday.id },
    data: { createdAt: new Date(start.getTime() - 1000) } });
  await db.order.update({ where: { id: yesterday.id },
    data: { customerNote: "Đơn cũ cập nhật hôm nay" } });
  const foreign = await order("DELIVERED", randomUUID(), otherBranchId);
  await db.payment.create({ data: {
    orderId: foreign.id, method: "COD", status: "CONFIRMED", amountVnd: 140000,
  } });
  await order("PENDING");
  await order("CONFIRMED");
  await order("PREPARING");
  await order("READY");
  const current = (await client.get(url).set(headers(manager.token)).expect(200)).body;

  assert.equal(current.deliveredCount, old.deliveredCount + 5);
  assert.equal(current.deliveredValueVnd, old.deliveredValueVnd + 700000);
  assert.equal(current.confirmedPaymentVnd, old.confirmedPaymentVnd + 420000);
  assert.equal(current.pending, old.pending + 1);
  assert.equal(current.preparing, old.preparing + 2);
  assert.equal(current.ready, old.ready + 1);

  // An operator sees full counts even if the alert endpoint is capped at 100.
  const latest = (await client.get(branchBase()).set(headers(owner.token)).expect(200)).body;
  assert.ok(latest.length <= 100);
  assert.ok(current.pending >= latest.filter(row => row.status === "PENDING").length);

  await client.get(url).expect(401);
  await client.get(url).set(headers(outsider.token)).expect(403);
  await client.get(url).set(headers(kitchen.token)).expect(403);
  await client.get(url).set(headers(driver.token)).expect(403);
  await client.get("/admin/orders/" + otherBranchId + "/summary")
    .set(headers(manager.token)).expect(403);
  await client.get("/admin/orders/not-an-id/summary").set(headers(owner.token)).expect(400);
});
