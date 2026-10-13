import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { NestFactory } = require("@nestjs/core");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const supertest = require("supertest");
const { AppModule } = require("../dist/app.module.js");
const { configureApp } = require("../dist/bootstrap.js");
const { RoadRoutingService } = require("../dist/delivery/road-routing.service.js");
const secret = "checkout-ci-only-secret-1234567890-abcdefgh";
process.env.AUTH_JWT_SECRET = secret;
process.env.CORS_ALLOWED_ORIGINS = "http://localhost:8081";
process.env.VIETQR_BANK_BIN = "970415";
process.env.VIETQR_ACCOUNT_NO = "123456789012";
process.env.VIETQR_ACCOUNT_NAME = "Lau Tu Xuyen QA";
let app, db, client, token, branchId, addressId, productId, userId;
const key = randomUUID();
before(async () => {
  assert.ok(process.env.DATABASE_URL, "CI requires disposable Postgres");
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
  db = new PrismaClient();
  client = supertest(app.getHttpServer());
  app.get(RoadRoutingService).drivingMeters = async () => 2100;
  const user = await db.user.create({
    data: { role: "CUSTOMER", phoneE164: "+84912345678" }, select: { id: true },
  });
  userId = user.id;
  const branch = await db.branch.create({
    data: { code: "checkout-" + randomUUID(), name: "CI checkout",
      latitude: "10.77", longitude: "106.67" }, select: { id: true },
  });
  branchId = branch.id;
  await db.deliveryPolicyVersion.create({
    data: { branchId, version: 1, acceptingOrders: true,
      baseMeters: 2000, baseFeeVnd: 10000, extraStepMeters: 1000,
      extraStepFeeVnd: 5000, maxRoadMeters: 8000,
      minSubtotalVnd: 80000, freeDeliveryAtSubtotalVnd: null },
  });
  const address = await db.address.create({
    data: { userId, label: "Nhà", line1: "123 Đường thử nghiệm, Việt Nam",
      latitude: "10.8", longitude: "106.7" }, select: { id: true },
  });
  addressId = address.id;
  const category = await db.catalogCategory.create({
    data: { branchId, name: "Lẩu" }, select: { id: true },
  });
  const product = await db.product.create({
    data: { categoryId: category.id, name: "Lẩu thử nghiệm",
      priceVnd: 50000, isAvailable: true }, select: { id: true },
  });
  productId = product.id;
  const session = await db.authSession.create({
    data: { userId, refreshTokenHash: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 300000) }, select: { id: true },
  });
  token = jwt.sign({ sid: session.id }, secret, {
    algorithm: "HS256", issuer: "sichuan-hotpot", audience: "sichuan-hotpot-api",
    subject: userId, expiresIn: "5m",
  });
});
after(async () => { if (app) await app.close(); if (db) await db.$disconnect(); });
const orderBody = (idempotencyKey = key) => ({
  branchId, addressId, idempotencyKey, paymentMethod: "COD",
  items: [{ productId, variantId: null, modifierIds: [], quantity: 2 }],
});
const request = (payload) => client.post("/customer/orders")
  .set("Authorization", "Bearer " + token).send(payload);

test("six simultaneous checkout requests produce exactly one order/payment/history", async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => request(orderBody())));
  assert.ok(results.every(x => x.status === 201), JSON.stringify(results.map(x => x.body)));
  const ids = new Set(results.map(x => x.body.orderId));
  assert.equal(ids.size, 1);
  assert.equal(results.filter(x => x.body.replayed === false).length, 1);
  assert.equal(results[0].body.totalVnd, 115000);
  const orderId = results[0].body.orderId;
  const [orders, payments, history, row] = await Promise.all([
    db.order.count({ where: { customerId: userId, idempotencyKey: key } }),
    db.payment.count({ where: { orderId } }),
    db.orderStatusHistory.count({ where: { orderId, toStatus: "PENDING" } }),
    db.order.findUnique({ where: { id: orderId },
      select: { requestHash: true, phoneSnapshot: true, roadDistanceMeters: true,
        subtotalVnd: true, deliveryFeeVnd: true, deliveryPolicyVersionId: true } }),
  ]);
  assert.equal(orders, 1);
  assert.equal(payments, 1);
  assert.equal(history, 1);
  assert.equal(row?.phoneSnapshot, "+84912345678");
  assert.equal(row?.roadDistanceMeters, 2100);
  assert.equal(row?.subtotalVnd, 100000);
  assert.equal(row?.deliveryFeeVnd, 15000);
  assert.equal(row?.requestHash?.length, 64);
});
test("replay returns stable order, reuse of key with changed payload is 409", async () => {
  const result = await request(orderBody()).expect(201);
  assert.equal(result.body.replayed, true);
  await request({ ...orderBody(), paymentMethod: "QR" }).expect(409);
  await request({ ...orderBody(), items: [{ productId, variantId: null, modifierIds: [], quantity: 3 }] }).expect(409);
});
test("QR order stores payment PENDING and never claims money received", async () => {
  const qrKey = randomUUID();
  const result = await request({ ...orderBody(qrKey), paymentMethod: "QR" }).expect(201);
  assert.equal(result.body.paymentMethod, "QR");
  assert.equal(result.body.paymentStatus, "PENDING");
  assert.equal(result.body.qr?.accountNo, "123456789012");
  assert.equal(result.body.qr?.amountVnd, 115000);
  const saved = await db.payment.findUnique({
    where: { orderId: result.body.orderId },
    select: { qrBankBin: true, qrAccountNo: true, qrAccountName: true },
  });
  assert.equal(saved.qrAccountNo, "123456789012");
  assert.equal(saved.qrBankBin, "970415");
  const detail = await client.get("/customer/orders/" + result.body.orderId)
    .set("Authorization", "Bearer " + token).expect(200);
  assert.equal(detail.body.payment.qr.transferReference, result.body.qr.transferReference);
  const old = process.env.VIETQR_ACCOUNT_NO;
  process.env.VIETQR_ACCOUNT_NO = "9999999999";
  try {
    const replay = await request({ ...orderBody(qrKey), paymentMethod: "QR" }).expect(201);
    assert.equal(replay.body.qr?.accountNo, "123456789012");
    assert.equal(replay.body.orderId, result.body.orderId);
    const again = await client.get("/customer/orders/" + result.body.orderId)
      .set("Authorization", "Bearer " + token).expect(200);
    assert.equal(again.body.payment.qr.accountNo, "123456789012");
  } finally { process.env.VIETQR_ACCOUNT_NO = old; }
});
test("customer history/detail is scoped and includes immutable monetary snapshot", async () => {
  const list = await client.get("/customer/orders")
    .set("Authorization", "Bearer " + token).expect(200);
  assert.ok(list.body.some(x => x.totalVnd === 115000 && x.status === "PENDING"));
  const saved = list.body[0];
  const detail = await client.get("/customer/orders/" + saved.id)
    .set("Authorization", "Bearer " + token).expect(200);
  assert.equal(detail.body.items[0].productName, "Lẩu thử nghiệm");
  assert.equal(detail.body.statusHistory[0].toStatus, "PENDING");
  await client.get("/customer/orders/" + randomUUID())
    .set("Authorization", "Bearer " + token).expect(404);
});
test("malicious client-supplied prices and invalid address are rejected", async () => {
  await request({ ...orderBody(randomUUID()), totalVnd: 1 }).expect(400);
  await request({ ...orderBody(randomUUID()), addressId: randomUUID() }).expect(404);
});
test("routing failure creates no order", async () => {
  const route = app.get(RoadRoutingService);
  const original = route.drivingMeters;
  const { ServiceUnavailableException } = require("@nestjs/common");
  route.drivingMeters = async () => { throw new ServiceUnavailableException("ROUTE_UNAVAILABLE"); };
  const distinctKey = randomUUID();
  try {
    await request(orderBody(distinctKey)).expect(503);
    assert.equal(await db.order.count({ where: { customerId: userId, idempotencyKey: distinctKey } }), 0);
  } finally {
    route.drivingMeters = original;
  }
});

test("QR is refused when payee not configured, and COD remains available", async () => {
  const saved = process.env.VIETQR_BANK_BIN;
  delete process.env.VIETQR_BANK_BIN;
  try {
    const methods = await client.get("/customer/orders/payment-methods").expect(200);
    assert.equal(methods.body.qrAvailable, false);
    await request({ ...orderBody(randomUUID()), paymentMethod: "QR" }).expect(422);
    const cod = await request(orderBody(randomUUID())).expect(201);
    assert.equal(cod.body.paymentMethod, "COD");
  } finally { process.env.VIETQR_BANK_BIN = saved; }
});
