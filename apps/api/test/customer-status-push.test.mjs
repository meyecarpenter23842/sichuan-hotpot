import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const { PushService } = require("../dist/push/push.service.js");

test("customer status push targets only the customer, carries reason and opens the real order", async () => {
  const requests = [];
  const deliveries = [];
  const service = new PushService({ database: {
    pushEndpoint: { findMany: async query => {
      requests.push(query);
      return [{ id: "device", token: "redacted", transport: "FCM", p256dh: null, auth: null }];
    } },
  } }, {});
  service.deliver = async (endpoints, payload, admin) => deliveries.push({ endpoints, payload, admin });
  const orderId = "order-has-id";
  await service.notifyCustomerStatus("customer-1", orderId, "CANCELED", "Món đã hết");
  assert.deepEqual(requests[0], { where: { scope: "CUSTOMER", userId: "customer-1" } });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].admin, false);
  assert.equal(deliveries[0].payload.kind, "ORDER_STATUS");
  assert.equal(deliveries[0].payload.orderId, orderId);
  assert.equal(deliveries[0].payload.url, "/?order=order-has-id");
  assert.match(deliveries[0].payload.title, /hủy/);
  assert.match(deliveries[0].payload.body, /Lý do: Món đã hết/);
  await service.notifyCustomerStatus("customer-1", orderId, "PENDING", null);
  assert.equal(deliveries.length, 1, "PENDING is not a new status alert");
});

test("customer receives no push for cooking, ready, delivered or delivery failed", async () => {
  const sent = [];
  let endpointLookups = 0;
  const service = new PushService({ database: {
    pushEndpoint: { findMany: async () => { endpointLookups++; return []; } },
  } }, {});
  service.deliver = async (_endpoints, payload) => sent.push(payload);
  for (const status of ["PENDING", "CONFIRMED", "PREPARING", "READY",
    "DELIVERING", "DELIVERED", "CANCELED", "DELIVERY_FAILED"]) {
    await service.notifyCustomerStatus("user", "order", status, null);
  }
  assert.deepEqual(sent.map(p => p.title), [
    "Đơn hàng đang được giao", "Đơn hàng đã bị hủy",
  ]);
  assert.equal(endpointLookups, 2, "silenced statuses must not even query push endpoints");
  assert.ok(sent.every(p => p.kind === "ORDER_STATUS" && p.url === "/?order=order"));
  assert.ok(sent.every(p => !p.body.includes("Lý do:")));
});
test("customer confirmed push remains separate and targeted", async () => {
  const queries = [], sent = [];
  const service = new PushService({ database: {
    pushEndpoint: { findMany: async q => { queries.push(q); return []; } },
  } }, {});
  service.deliver = async (_endpoints, payload) => sent.push(payload);
  await service.notifyCustomerConfirmed("my-customer", "order-123");
  assert.deepEqual(queries[0], { where: { scope: "CUSTOMER", userId: "my-customer" } });
  assert.equal(sent[0].kind, "ORDER_CONFIRMED");
  assert.equal(sent[0].url, "/?order=order-123");
});
