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

test("status notifications cover cooking, ready, delivery, completion and delivery failure", async () => {
  const sent = [];
  const service = new PushService({ database: {
    pushEndpoint: { findMany: async () => [] },
  } }, {});
  service.deliver = async (_endpoints, payload) => sent.push(payload);
  for (const status of ["PREPARING", "READY", "DELIVERING", "DELIVERED", "DELIVERY_FAILED"]) {
    await service.notifyCustomerStatus("user", "order", status,
      status === "DELIVERY_FAILED" ? "Khách không nghe máy" : null);
  }
  assert.equal(sent.length, 5);
  assert.ok(sent.every(payload => payload.kind === "ORDER_STATUS"
    && payload.url === "/?order=order" && payload.body && payload.title));
  assert.match(sent.at(-1).body, /Khách không nghe máy/);
  assert.ok(!sent[0].body.includes("Lý do:"), "only relevant statuses include a reason");
});
