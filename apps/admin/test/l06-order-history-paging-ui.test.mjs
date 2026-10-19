import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const panel = read("../src/OrderQueuePanel.tsx");
const controller = read("../../api/src/orders/admin-orders.controller.ts");
const service = read("../../api/src/orders/admin-orders.service.ts");

test("L06 admin history has independent backend-paged status lanes, never 100-order truncation", () => {
  assert.match(controller, /@Get\(":branchId\/pages"\)/);
  assert.ok(controller.indexOf('@Get(":branchId/pages")') < controller.indexOf('@Get(":branchId/:orderId")'));
  assert.match(service, /async listPage\(/);
  assert.match(service, /deliveryAssignment: \{ is: \{ driverId: staff\.actorId \} \}/);
  assert.match(service, /INVALID_ORDER_PAGE_CURSOR/);
  assert.match(service, /order\.count\(\{ where: scope \}\)/);
  assert.match(service, /createdAt: \{ lt: cursor\.createdAt \}/);
  assert.match(service, /id: \{ lt: cursor\.id \}/);
  assert.match(panel, /const activeLane = mode === "orders" \? group : mode/);
  assert.match(panel, /"\/pages\?group="/);
  assert.match(panel, /setLaneTotal\(page\.total\)/);
  assert.match(panel, /Xem thêm đơn cũ/);
  assert.match(panel, /loadedHistory\.current/);
});

test("L06 old orders persist when realtime/10s refreshes newest status lane", () => {
  assert.match(panel, /refreshLaneRef\.current\(\)/);
  assert.match(panel, /setLaneOrders\(prev => \{/);
  assert.match(panel, /\[\.\.\.page\.items, \.\.\.prev\.filter/);
  assert.match(panel, /new Set\(prev\.map\(x => x\.id\)\)/);
  assert.match(panel, /Tổng quan gần đây/);
  assert.match(panel, /laneTotal !== null/);
});
