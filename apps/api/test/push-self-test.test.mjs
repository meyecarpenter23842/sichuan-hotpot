import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { PushService } = require("../dist/push/push.service.js");

function mockService(ownerRole = "OWNER") {
  const token = "fcm-token-" + randomUUID().repeat(3);
  const userId = randomUUID();
  const branchId = randomUUID();
  const endpoint = { id: randomUUID(), userId, branchId, scope: "STAFF",
    transport: "FCM", token, p256dh: null, auth: null };
  const events = [];
  const database = {
    pushEndpoint: {
      findFirst: async ({ where }) => where.userId === userId && where.token === token ? endpoint : null,
      deleteMany: async () => { events.push("delete"); },
    },
    branch: { findUnique: async () => ({ id: branchId }) },
    branchMember: { findUnique: async () => ownerRole === "MANAGER" ? { role: "MANAGER" } : null },
    order: { create: async () => { throw Error("Test push must not create orders"); } },
  };
  const auth = { principal: async authorization =>
    authorization === "Bearer current" ? { id: userId, role: ownerRole }
      : authorization === "Bearer stranger" ? { id: randomUUID(), role: "CUSTOMER" }
        : (() => { throw Error("Unauthorized"); })() };
  const service = new PushService({ database }, auth);
  service.sendFcm = async (_endpoint, payload, admin) => {
    events.push({ payload, admin });
  };
  return { service, endpoint, events, token, userId };
}

test("FCM test sends only to registered current user's device, no Order mutation", async () => {
  const { service, token, events } = mockService();
  await assert.rejects(service.sendTest("Bearer stranger", token), /PUSH_DEVICE_NOT_REGISTERED_FOR_USER/);
  const sent = await service.sendTest("Bearer current", token);
  assert.equal(sent.status, "sent_to_fcm");
  assert.match(sent.testId, /^[0-9a-f-]{36}$/);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.kind, "TEST");
  assert.equal(events[0].admin, true);
  assert.equal(events[0].payload.orderId, undefined);
  assert.equal((await service.testStatus("Bearer current", sent.testId)).received, false);
  assert.equal((await service.testStatus("Bearer current", sent.testId)).failureCode, null);
  await assert.rejects(service.acknowledgeTest("Bearer stranger", sent.testId, token), /PUSH_TEST_RECEIPT_FORBIDDEN/);
  await assert.rejects(service.acknowledgeTest("Bearer current", sent.testId, "other-device"), /PUSH_TEST_RECEIPT_FORBIDDEN/);
  assert.equal((await service.acknowledgeTest("Bearer current", sent.testId, token)).status, "received_on_device");
  assert.equal((await service.testStatus("Bearer current", sent.testId)).received, true);
  await assert.rejects(service.sendTest("Bearer current", token), /PUSH_TEST_RATE_LIMIT_30_SECONDS/);
});

test("MANAGER branch membership can test own token, unauthorized role cannot", async () => {
  const manager = mockService("MANAGER");
  assert.equal((await manager.service.sendTest("Bearer current", manager.token)).status, "sent_to_fcm");
  const unauthorized = mockService("KITCHEN");
  await assert.rejects(unauthorized.service.sendTest("Bearer current", unauthorized.token), /STAFF_PUSH_FORBIDDEN/);
});

test("missing FCM server, invalid token, or missing own endpoint never returns delivery success", async () => {
  const { service, token } = mockService();
  service.sendFcm = async () => { throw new Error("FCM_SERVER_NOT_CONFIGURED"); };
  let failureId;
  const originalSet = service.testReceipts.set.bind(service.testReceipts);
  service.testReceipts.set = (id, entry) => { failureId = id; return originalSet(id, entry); };
  await assert.rejects(service.sendTest("Bearer current", token), /FCM_SERVER_NOT_CONFIGURED/);
  const detail = await service.testStatus("Bearer current", failureId);
  assert.equal(detail.status, "failed");
  assert.equal(detail.failureCode, "FCM_SERVER_NOT_CONFIGURED");
  await assert.rejects(service.sendTest("Bearer current", "short"), /PUSH_TOKEN_INVALID/);
});
