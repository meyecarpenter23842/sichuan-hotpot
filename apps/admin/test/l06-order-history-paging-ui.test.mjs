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
  assert.match(panel, /loadedCount = useRef\(25\)/);
  assert.match(panel, /historyQuery/);
  assert.match(service, /historyStatus \?\? \{ in: groups\[group\] \}/);
});

test("L06 old orders persist when realtime/10s refreshes newest status lane", () => {
  assert.match(panel, /refreshLaneRef\.current\(\)/);
  assert.match(panel, /setLaneOrders\(prev => \{/);
  assert.match(panel, /setLaneOrders\(rows\)/);
  assert.match(panel, /loadedCount\.current/);
  assert.match(panel, /while \(rows\.length < target && cursor\)/);
  assert.match(panel, /new Set\(prev\.map\(item => item\.id\)\)/);
  assert.match(panel, /mode !== "orders" && <>/);
  assert.match(panel, /laneTotal !== null/);
});

test("P0 history filter is server-owned, cancel color and actor audit are consistent", () => {
  assert.match(controller, /INVALID_HISTORY_FILTER/);
  assert.match(controller, /historyStatuses = \["DELIVERED", "CANCELED", "DELIVERY_FAILED"\]/);
  assert.match(service, /historyStatus && group !== "history"/);
  assert.match(service, /status: historyStatus \?\? \{ in: groups\[group\] \}/);
  assert.match(service, /source: actorId === null \? "UNKNOWN"/);
  assert.match(service, /actorId === customerId \? "CUSTOMER"/);
  assert.match(panel, /CANCELED: \{ background: "#FDE4E8", text: "#B31E30" \}/);
  assert.match(panel, /DELIVERY_FAILED: \{ background: "#FFF0D8"/);
  assert.match(panel, /historyFilters\.map/);
  assert.match(panel, /onHistoryStatusChange\(item\.value\)/);
  assert.match(panel, /onGroupChange\("history"\)/);
  assert.match(panel, /cancellationSourceLabel\[canceledChange\.source\]/);
  assert.doesNotMatch(panel, /loadedHistory\.current/);
  assert.doesNotMatch(panel, /\.\.\.prev\.filter\(item => !seen\.has\(item\.id\)\)/);
});

test("History has its own header and never briefly displays a previous filter's orders", () => {
  assert.match(panel, /const visible = loadedLaneUrl === laneUrl \? laneOrders : \[\]/);
  assert.match(panel, /setLoadedLaneUrl\(laneUrl\)/);
  assert.match(panel, /setLoadedLaneUrl\(null\)/);
  assert.match(panel, /key=\{laneUrl\} style=\{s\.orderListScroll\}/);
  assert.match(panel, /laneLoading && visible\.length === 0/);
  assert.match(panel, /group !== "history" && <View style=\{s\.tabsToolbar\}>/);
  assert.match(panel, /group === "history" && <View style=\{s\.historyHeading\}>/);
  assert.match(panel, /historyFilters\.map/);
  assert.match(panel, /onHistoryStatusChange\(item\.value\)/);
  assert.match(panel, /onPress=\{onCloseHistory\}/);
  assert.doesNotMatch(panel, /historyTab:/);
});
