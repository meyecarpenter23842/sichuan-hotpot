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
test("customer order note is normalized, immutable and part of idempotency", async () => {
  const noteKey = randomUUID();
  const first = await request({
    ...orderBody(noteKey),
    customerNote: "  Gọi trước khi giao\r\nKhông bấm chuông  ",
  }).expect(201);
  const saved = await db.order.findUniqueOrThrow({
    where: { id: first.body.orderId }, select: { customerNote: true },
  });
  assert.equal(saved.customerNote, "Gọi trước khi giao\nKhông bấm chuông");

  const detail = await client.get("/customer/orders/" + first.body.orderId)
    .set("Authorization", "Bearer " + token).expect(200);
  assert.equal(detail.body.customerNote, "Gọi trước khi giao\nKhông bấm chuông");

  const replay = await request({
    ...orderBody(noteKey),
    customerNote: "Gọi trước khi giao\nKhông bấm chuông",
  }).expect(201);
  assert.equal(replay.body.orderId, first.body.orderId);
  assert.equal(replay.body.replayed, true);

  await request({
    ...orderBody(noteKey), customerNote: "Đổi ghi chú sau khi gửi",
  }).expect(409);
  await request({
    ...orderBody(randomUUID()), customerNote: "x".repeat(501),
  }).expect(400);
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

test("L08 rejects unavailable products and reprices new orders without changing history", async () => {
  const original = await db.order.findFirstOrThrow({
    where: { customerId: userId, idempotencyKey: key },
    include: { items: true },
  });
  assert.equal(original.subtotalVnd, 100000);
  assert.equal(original.items[0].unitPriceVnd, 50000);
  await db.product.update({ where: { id: productId }, data: {
    isAvailable: false, priceVnd: 65000,
  } });
  const refusedKey = randomUUID();
  try {
    await request(orderBody(refusedKey)).expect(422);
    assert.equal(await db.order.count({ where: { idempotencyKey: refusedKey } }), 0);
    await db.product.update({ where: { id: productId }, data: { isAvailable: true } });
    const newKey = randomUUID();
    const updated = await request(orderBody(newKey)).expect(201);
    assert.equal(updated.body.totalVnd, 145000, "New server price 2 x 65000 plus 15000 road fee");
    const newer = await db.order.findFirstOrThrow({
      where: { customerId: userId, idempotencyKey: newKey },
      include: { items: true },
    });
    assert.equal(newer.subtotalVnd, 130000);
    assert.equal(newer.items[0].unitPriceVnd, 65000);
    const historical = await db.order.findUniqueOrThrow({
      where: { id: original.id }, include: { items: true },
    });
    assert.equal(historical.totalVnd, original.totalVnd);
    assert.equal(historical.subtotalVnd, 100000);
    assert.equal(historical.items[0].unitPriceVnd, 50000);
  } finally {
    await db.product.update({ where: { id: productId }, data: {
      isAvailable: true, priceVnd: 50000,
    } });
  }
});

test("L08 rejects an option or size turned off before checkout, without inserting an order", async () => {
  const variant = await db.productVariant.create({ data: {
    productId, name: "L08 large portion", priceDeltaVnd: 15000, isAvailable: true,
  } });
  const group = await db.modifierGroup.create({ data: {
    productId, name: "L08 toppings", minSelect: 0, maxSelect: 1,
  } });
  const option = await db.modifierOption.create({ data: {
    groupId: group.id, name: "L08 mushroom", priceDeltaVnd: 8000, isAvailable: true,
  } });
  const cart = (idempotencyKey, modifierIds = [option.id], variantId = variant.id) => ({
    ...orderBody(idempotencyKey),
    items: [{ productId, variantId, modifierIds, quantity: 2 }],
  });
  const accepted = await request(cart(randomUUID())).expect(201);
  assert.equal(accepted.body.totalVnd, 161000, "2 x (50000 + 15000 + 8000) + 15000");
  await db.modifierGroup.update({ where:{id:group.id},data:{maxSelect:2} });
  const repeatKey=randomUUID();
  const duplicate=await request(cart(repeatKey,[option.id,option.id])).expect(201);
  assert.equal(duplicate.body.totalVnd,177000,
    "2 portions x (50000 base + 15000 size + 2 x 8000 topping) + 15000 delivery");
  const repeated=await db.order.findUniqueOrThrow({
    where:{customerId_idempotencyKey:{customerId:userId,idempotencyKey:repeatKey}},
    include:{items:{include:{modifiers:true}}},
  });
  assert.equal(repeated.items[0].modifiers.length,2,
    "Both topping units must survive in immutable order snapshots");
  // New cart semantics: increasing the dish must not purchase more mushrooms.
  const separateCart=(quantity,idempotencyKey)=>({
    ...cart(idempotencyKey,[option.id,option.id]),
    items:[{productId,variantId:variant.id,modifierIds:[option.id,option.id],
      quantity,pricingMode:"SEPARATE"}],
  });
  const two=await request(separateCart(2,randomUUID())).expect(201);
  const threeKey=randomUUID();
  const three=await request(separateCart(3,threeKey)).expect(201);
  assert.equal(two.body.totalVnd,161000,
    "2 dishes 130000 + only two toppings 16000 + ship 15000");
  assert.equal(three.body.totalVnd,226000,
    "3 dishes 195000 + unchanged toppings 16000 + ship 15000");
  assert.equal(three.body.totalVnd-two.body.totalVnd,65000,
    "dish +1 cannot silently duplicate topping");
  const exact=await db.order.findUniqueOrThrow({
    where:{customerId_idempotencyKey:{customerId:userId,idempotencyKey:threeKey}},
    include:{items:{include:{modifiers:true}}},
  });
  assert.equal(exact.items[0].unitPriceVnd,65000);
  assert.equal(exact.items[0].lineTotalVnd,211000);
  assert.equal(exact.items[0].modifiers.length,2);
  assert.equal(exact.items[0].modifiers.reduce((t,o)=>t+o.priceVnd,0),16000);
  await request(cart(randomUUID(),[option.id,option.id,option.id])).expect(422);
  await db.modifierOption.update({ where: { id: option.id }, data: { isAvailable: false } });
  try {
    const blockedKey = randomUUID();
    await request(cart(blockedKey)).expect(422);
    assert.equal(await db.order.count({ where: { idempotencyKey: blockedKey } }), 0);
    await db.productVariant.update({ where: { id: variant.id }, data: { isAvailable: false } });
    const variantKey = randomUUID();
    await request(cart(variantKey, [])).expect(422);
    assert.equal(await db.order.count({ where: { idempotencyKey: variantKey } }), 0);
  } finally {
    await db.modifierOption.update({ where: { id: option.id }, data: { isAvailable: true } });
    await db.productVariant.update({ where: { id: variant.id }, data: { isAvailable: true } });
  }
});

test("P0 zone: COD/QR use saved ward, no routing, immutable fee and idempotency", async () => {
  const route = app.get(RoadRoutingService);
  const old = route.drivingMeters;
  let called = 0;
  route.drivingMeters = async () => { called++; throw Error("OSRM MUST NOT BE CALLED FOR ZONE"); };
  try {
    await db.address.update({ where: { id: addressId }, data: {
      catalogVersion: "vn-2026-09-08", provinceCode: "79", wardCode: "25747",
    } });
    const second = await db.deliveryPolicyVersion.create({ data: {
      branchId, version: 2, pricingMode: "ZONE", acceptingOrders: true,
      minSubtotalVnd: 80000, freeDeliveryAtSubtotalVnd: null,
      zones: { create: [
        { name: "Nhóm trung tâm", catalogVersion: "vn-2026-09-08",
          provinceCode: "79", wardCodes: ["25747"], feeVnd: 12000, isActive: true },
        { name: "Còn lại", catalogVersion: "vn-2026-09-08",
          provinceCode: "79", wardCodes: [], feeVnd: 25000, isActive: true },
      ] },
    } });
    const estimate = await client.post("/customer/delivery/quote")
      .set("Authorization", "Bearer " + token)
      .send({ branchId, addressId, items: orderBody().items }).expect(201);
    assert.equal(estimate.body.pricingMode, "ZONE");
    assert.equal(estimate.body.feeVnd, 12000);
    assert.equal(estimate.body.routeDistanceMeters, null);
    const codKey = randomUUID();
    const [a,b] = await Promise.all([request(orderBody(codKey)),request(orderBody(codKey))]);
    assert.equal(a.status,201); assert.equal(b.status,201);
    assert.equal(a.body.orderId,b.body.orderId);
    assert.equal(a.body.totalVnd,112000);
    const saved = await db.order.findUniqueOrThrow({where:{id:a.body.orderId}});
    assert.equal(saved.pricingMode, "ZONE");
    assert.equal(saved.roadDistanceMeters,null);
    assert.equal(saved.zoneNameSnapshot,"Nhóm trung tâm");
    assert.equal(saved.provinceCodeSnapshot,"79");
    assert.equal(saved.wardCodeSnapshot,"25747");
    assert.equal(saved.catalogVersionSnapshot,"vn-2026-09-08");
    assert.equal(saved.deliveryPolicyVersionId,second.id);
    const detail = await client.get("/customer/orders/"+saved.id)
      .set("Authorization","Bearer "+token).expect(200);
    assert.equal(detail.body.zoneNameSnapshot,"Nhóm trung tâm");
    const qr = await request({ ...orderBody(randomUUID()), paymentMethod: "QR" }).expect(201);
    assert.equal(qr.body.totalVnd,112000);
    assert.equal(qr.body.paymentStatus,"PENDING");
    await db.deliveryPolicyVersion.create({ data: {
      branchId, version: 3, pricingMode: "ZONE", acceptingOrders: true,
      minSubtotalVnd: 80000, freeDeliveryAtSubtotalVnd: null,
      zones: { create: [{ name: "Cước mới", catalogVersion: "vn-2026-09-08",
        provinceCode: "79", wardCodes: ["25747"], feeVnd: 20000, isActive: true }] },
    } });
    const repriced = await request(orderBody(randomUUID())).expect(201);
    assert.equal(repriced.body.totalVnd,120000);
    const oldOrder = await db.order.findUniqueOrThrow({ where: { id: saved.id } });
    assert.equal(oldOrder.totalVnd,112000);
    assert.equal(oldOrder.deliveryFeeVnd,12000);
    assert.equal(called,0,"zone checkout must not invoke OSRM");
    await db.address.update({ where: { id: addressId }, data: {wardCode:"25760"} });
    const outsideKey = randomUUID();
    const outside = await request(orderBody(outsideKey)).expect(422);
    assert.match(JSON.stringify(outside.body), /ZONE_NOT_SERVED/, JSON.stringify(outside.body));
    assert.equal(await db.order.count({where:{customerId:userId,idempotencyKey:outsideKey}}),0);
  } finally { route.drivingMeters = old; }
});


test("real combo checkout stores immutable fixed and chosen component snapshots", async () => {
  // Prior zone-pricing test intentionally leaves the address outside service;
  // restore a valid saved ward so this test isolates combo behavior.
  await db.address.update({ where: { id: addressId }, data: { wardCode: "25747" } });
  const base = await db.product.findUniqueOrThrow({
    where: { id: productId }, select: { categoryId: true },
  });
  const [fixedChild, choiceChild] = await Promise.all([
    db.product.create({ data: {
      categoryId: base.categoryId, name: "Mì combo " + randomUUID(),
      priceVnd: 10000, kind: "STANDARD", isAvailable: true,
    } }),
    db.product.create({ data: {
      categoryId: base.categoryId, name: "Bò combo " + randomUUID(),
      priceVnd: 30000, kind: "STANDARD", isAvailable: true,
    } }),
  ]);
  const [fixedVariant, choiceVariant] = await Promise.all([
    db.productVariant.create({ data: {
      productId: fixedChild.id, name: "Tô lớn", priceDeltaVnd: 0, isAvailable: true,
    } }),
    db.productVariant.create({ data: {
      productId: choiceChild.id, name: "200g", priceDeltaVnd: 0, isAvailable: true,
    } }),
  ]);
  const combo = await db.product.create({ data: {
    categoryId: base.categoryId, name: "Combo CI " + randomUUID(),
    priceVnd: 100000, kind: "COMBO", isAvailable: true,
  } });
  await db.productComboFixedItem.create({ data: {
    comboProductId: combo.id, childProductId: fixedChild.id, variantId: fixedVariant.id,
    quantity: 1, sortOrder: 0,
  } });
  const group = await db.productComboGroup.create({ data: {
    comboProductId: combo.id, name: "Chọn thịt", minSelect: 1, maxSelect: 1, sortOrder: 1,
  } });
  const option = await db.productComboOption.create({ data: {
    groupId: group.id, childProductId: choiceChild.id, variantId: choiceVariant.id,
    quantity: 2, priceDeltaVnd: 5000, sortOrder: 0,
  } });

  const result = await request({
    branchId, addressId, idempotencyKey: randomUUID(), paymentMethod: "COD",
    items: [{
      productId: combo.id, variantId: null, modifierIds: [],
      comboOptionIds: [option.id], quantity: 1, pricingMode: "SEPARATE",
    }],
  }).expect(201);
  assert.equal(result.body.totalVnd, 125000);

  const saved = await db.order.findUniqueOrThrow({
    where: { id: result.body.orderId },
    include: { items: { include: { comboItems: { orderBy: { sortOrder: "asc" } } } } },
  });
  assert.equal(saved.subtotalVnd, 105000);
  assert.equal(saved.items.length, 1);
  assert.deepEqual(saved.items[0].comboItems.map(component => ({
    kind: component.kind, productId: component.productId,
    variantId: component.variantId, productName: component.productName,
    variantName: component.variantName, quantity: component.quantity,
    priceDeltaVnd: component.priceDeltaVnd,
  })), [
    {
      kind: "FIXED", productId: fixedChild.id, variantId: fixedVariant.id,
      productName: fixedChild.name, variantName: "Tô lớn",
      quantity: 1, priceDeltaVnd: 0,
    },
    {
      kind: "CHOICE", productId: choiceChild.id, variantId: choiceVariant.id,
      productName: choiceChild.name, variantName: "200g",
      quantity: 2, priceDeltaVnd: 5000,
    },
  ]);

  const detail = await client.get("/customer/orders/" + result.body.orderId)
    .set("Authorization", "Bearer " + token).expect(200);
  assert.equal(detail.body.items[0].comboItems.length, 2);
  assert.equal(detail.body.items[0].comboItems[1].groupName, "Chọn thịt");
  assert.equal(detail.body.items[0].comboItems[1].productId, choiceChild.id);
  assert.equal(detail.body.items[0].comboItems[0].variantName, "Tô lớn");
  assert.equal(detail.body.items[0].comboItems[1].variantName, "200g");

  await db.productVariant.update({
    where: { id: choiceVariant.id }, data: { isAvailable: false },
  });
  try {
    const blockedKey = randomUUID();
    await request({
      branchId, addressId, idempotencyKey: blockedKey, paymentMethod: "COD",
      items: [{
        productId: combo.id, variantId: null, modifierIds: [],
        comboOptionIds: [option.id], quantity: 1, pricingMode: "SEPARATE",
      }],
    }).expect(422);
    assert.equal(await db.order.count({ where: { idempotencyKey: blockedKey } }), 0);
  } finally {
    await db.productVariant.update({
      where: { id: choiceVariant.id }, data: { isAvailable: true },
    });
  }
});


test("combo checkout reuses shared topping library and preserves immutable topping snapshot", async () => {
  await db.address.update({ where: { id: addressId }, data: { wardCode: "25747" } });
  const base = await db.product.findUniqueOrThrow({
    where: { id: productId }, select: { categoryId: true },
  });
  const combo = await db.product.create({ data: {
    categoryId: base.categoryId, name: "Combo topping CI " + randomUUID(),
    priceVnd: 100000, kind: "COMBO", isAvailable: true,
  } });
  const libraryGroup = await db.modifierGroup.create({ data: {
    branchId, name: "Thư viện topping " + randomUUID(),
    minSelect: 0, maxSelect: 5, sortOrder: 0, isAvailable: true,
  } });
  const topping = await db.modifierOption.create({ data: {
    groupId: libraryGroup.id, name: "Bò cuộn combo", priceDeltaVnd: 12000,
    isAvailable: true,
  } });
  const group = await db.productComboGroup.create({ data: {
    comboProductId: combo.id, name: "Chọn topping", minSelect: 1, maxSelect: 1, sortOrder: 0,
  } });
  const comboTopping = await db.productComboModifierOption.create({ data: {
    groupId: group.id, modifierOptionId: topping.id, quantity: 2,
    priceDeltaVnd: 7000, sortOrder: 0,
  } });

  const key = randomUUID();
  const accepted = await request({
    branchId, addressId, idempotencyKey: key, paymentMethod: "COD",
    items: [{
      productId: combo.id, variantId: null, modifierIds: [],
      comboOptionIds: [comboTopping.id], quantity: 1, pricingMode: "SEPARATE",
    }],
  }).expect(201);
  assert.equal(accepted.body.totalVnd, 127000);

  const saved = await db.order.findUniqueOrThrow({
    where: { customerId_idempotencyKey: { customerId: userId, idempotencyKey: key } },
    include: { items: { include: { comboItems: true } } },
  });
  assert.equal(saved.subtotalVnd, 107000);
  assert.equal(saved.items[0].comboItems.length, 1);
  assert.equal(saved.items[0].comboItems[0].productId, null);
  assert.equal(saved.items[0].comboItems[0].modifierOptionId, topping.id);
  assert.equal(saved.items[0].comboItems[0].productName, "Bò cuộn combo");
  assert.equal(saved.items[0].comboItems[0].quantity, 2);
  assert.equal(saved.items[0].comboItems[0].priceDeltaVnd, 7000);

  const detail = await client.get("/customer/orders/" + saved.id)
    .set("Authorization", "Bearer " + token).expect(200);
  assert.equal(detail.body.items[0].comboItems[0].modifierOptionId, topping.id);

  await db.modifierOption.update({ where: { id: topping.id }, data: {
    name: "Tên topping mới", priceDeltaVnd: 99000, isAvailable: false,
  } });
  try {
    const blockedKey = randomUUID();
    await request({
      branchId, addressId, idempotencyKey: blockedKey, paymentMethod: "COD",
      items: [{
        productId: combo.id, variantId: null, modifierIds: [],
        comboOptionIds: [comboTopping.id], quantity: 1, pricingMode: "SEPARATE",
      }],
    }).expect(422);
    assert.equal(await db.order.count({ where: { idempotencyKey: blockedKey } }), 0);
    const history = await db.order.findUniqueOrThrow({
      where: { id: saved.id }, include: { items: { include: { comboItems: true } } },
    });
    assert.equal(history.items[0].comboItems[0].productName, "Bò cuộn combo");
    assert.equal(history.items[0].comboItems[0].priceDeltaVnd, 7000);
  } finally {
    await db.modifierOption.update({ where: { id: topping.id }, data: { isAvailable: true } });
  }
});

test("L02 old Đồng Tháp address remains readable but cannot quote or create a new order", async () => {
  const oldAddress = await db.address.create({ data: {
    userId, label: "Địa chỉ lịch sử", line1: "Địa chỉ lịch sử ở Đồng Tháp cũ",
    latitude: "10.8", longitude: "106.7", catalogVersion: "vn-2026-09-08",
    provinceCode: "82", wardCode: "29944",
  } });
  const keyForAttempt = randomUUID();
  try {
    const shown = await client.get("/customer/addresses")
      .set("Authorization", "Bearer " + token).expect(200);
    assert.ok(shown.body.addresses.some(a => a.id === oldAddress.id &&
      a.wardCode === "29944"), "historical data must remain readable");
    const quote = await client.post("/customer/delivery/quote")
      .set("Authorization", "Bearer " + token)
      .send({ branchId, addressId: oldAddress.id, items: orderBody().items }).expect(422);
    assert.equal(quote.body.error?.code, "ZONE_NOT_SERVED");
    const denied = await request({ ...orderBody(keyForAttempt), addressId: oldAddress.id }).expect(422);
    assert.equal(denied.body.error?.code, "ZONE_NOT_SERVED");
    assert.equal(await db.order.count({ where: { idempotencyKey: keyForAttempt } }), 0);
  } finally {
    await db.address.delete({ where: { id: oldAddress.id } });
  }
});


test("L06 paged order/purchase history reaches older delivered orders and isolates customer", async () => {
  const policy = (await db.deliveryPolicyVersion.findFirstOrThrow({ where: { branchId } })).id;
  const timestamp = new Date("2024-03-01T00:00:00.000Z");
  const fixture = Array.from({ length: 62 }, (_, i) => ({
    id: randomUUID(), branchId, customerId: userId,
    deliveryPolicyVersionId: policy, idempotencyKey: randomUUID(),
    status: i % 2 === 0 ? "DELIVERED" : "PENDING",
    subtotalVnd: 70000, deliveryFeeVnd: 10000, totalVnd: 80000,
    latitudeSnapshot: "10.7731", longitudeSnapshot: "106.7032",
    addressLineSnapshot: "Đơn lịch sử nhiều trang", createdAt: timestamp,
  }));
  await db.order.createMany({ data: fixture });
  const headers = { Authorization: "Bearer " + token };
  const seen = new Set(), delivered = new Set();
  let cursor = null;
  for (let n = 0; n < 12; n++) {
    const query = "/customer/orders/pages?limit=20" + (cursor ? "&cursor=" + cursor : "");
    const response = await client.get(query).set(headers).expect(200);
    for (const row of response.body.items) {
      assert.ok(!seen.has(row.id), "cursor must never repeat any order");
      seen.add(row.id);
    }
    cursor = response.body.nextCursor;
    if (!cursor) break;
  }
  assert.equal(cursor, null);
  assert.ok(fixture.every(row => seen.has(row.id)), "older orders beyond 50 must be reachable");
  cursor = null;
  for (let n = 0; n < 12; n++) {
    const response = await client.get("/customer/orders/pages?delivered=1&limit=20"
      + (cursor ? "&cursor=" + cursor : "")).set(headers).expect(200);
    assert.ok(response.body.items.every(row => row.status === "DELIVERED"));
    for (const row of response.body.items) {
      assert.ok(!delivered.has(row.id));
      delivered.add(row.id);
    }
    cursor = response.body.nextCursor;
    if (!cursor) break;
  }
  assert.equal(cursor, null);
  assert.ok(fixture.filter(row => row.status === "DELIVERED")
    .every(row => delivered.has(row.id)));
  const stranger = await db.user.create({ data: { role: "CUSTOMER" },
    select: { id: true } });
  const foreign = await db.order.create({ data: {
    branchId, customerId: stranger.id, deliveryPolicyVersionId: policy,
    idempotencyKey: randomUUID(), subtotalVnd: 70000, deliveryFeeVnd: 10000,
    totalVnd: 80000, addressLineSnapshot: "Địa chỉ người khác",
    latitudeSnapshot: "10.7731", longitudeSnapshot: "106.7032",
  }, select: { id: true } });
  await client.get("/customer/orders/pages?cursor=" + foreign.id).set(headers).expect(400);
  await client.get("/customer/orders/pages?cursor=" + randomUUID()).set(headers).expect(400);
  await client.get("/customer/orders/pages?delivered=2").set(headers).expect(400);
  await client.get("/customer/orders/pages?limit=51").set(headers).expect(400);
  await client.get("/customer/orders/pages").expect(401);
});
