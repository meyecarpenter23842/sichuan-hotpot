import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const panel = read("../src/OrderQueuePanel.tsx");
const app = read("../App.tsx");
const service = read("../../api/src/orders/admin-orders.service.ts");
const realtime = read("../../api/src/orders/order-realtime.service.ts");

test("L04 five working tabs and history launched exclusively from the clock shortcut", () => {
  for (const id of ["new", "confirmed", "preparing", "ready", "delivering"]) {
    assert.match(panel, new RegExp('id: "' + id + '"'));
  }
  assert.doesNotMatch(panel, /id: "history", label: "Lịch sử"/);
  for (const label of ["Mới", "Đã nhận", "Đang nấu", "Chờ giao", "Đang giao"]) {
    assert.ok(panel.includes('label: "' + label + '"'));
  }
  assert.match(panel, /accessibilityRole="tab"/);
  assert.match(panel, /accessibilityState=\{\{ selected: group === item.id \}\}/);
  assert.match(panel, /contentContainerStyle=\{s.groupRow\}/);
  // Live server counts belong to five working tabs; history is a separate screen.
  assert.match(panel, /group === "history" && \(lookupMode \|\| hasCode \|\| reportMetric\) \? "lookup" : group : mode/);
  assert.match(panel, /encodeURIComponent\(activeLane\) \+ historyQuery/);
  assert.match(panel, /accessibilityLabel="Mở lịch sử đơn hàng"/);
  assert.match(panel, /onPress=\{\(\) => onGroupChange\("history"\)\}/);
  assert.match(panel, /"Quay lại đơn đang xử lý"/);
  assert.match(panel, /onPress=\{onCloseHistory\}/);
  assert.match(panel, /const count = item.id === group && loadedLaneUrl === laneUrl && laneTotal !== null/);
});

test("L04 order list scrolls separately from fixed tabs and never loses filter on bottom switch", () => {
  assert.match(app, /const \[orderGroup, setOrderGroup\] = useState<OrderGroup>\("new"\)/);
  assert.match(app, /group=\{tab === "lookup" \? "history" : orderGroup\}/);
  assert.match(app, /onGroupChange=\{next => \{/);
  assert.match(app, /lastWorkingLane\.current = next/);
  assert.match(app, /onCloseHistory=\{\(\) => \{/);
  assert.match(panel, /style=\{s.orderListScroll\}/);
  assert.ok(panel.indexOf('accessibilityLabel="Bộ lọc trạng thái đơn"') <
    panel.indexOf('style={s.orderListScroll}'));
  assert.match(panel, /AppState.addEventListener\("change"/);
  assert.match(panel, /watchOrderEvents/);
});

test("L04 quick actions still fetch latest detail and require explicit confirmation", () => {
  assert.match(panel, /openDetail\(order.id, a.value\)/);
  assert.match(panel, /availableActions\(detail.status, role\).some/);
  assert.match(panel, /setAction\(quickAction\)/);
  assert.match(panel, /Xác nhận cập nhật/);
  assert.match(panel, /expectedStatus: selected.status, toStatus: action/);
  assert.match(panel, /Giao thất bại/);
  assert.match(panel, /Đã giao thành công/);
});

test("L04 driver route scopes API read and ws to assignment, controls only delivery", () => {
  assert.match(app, /staffRole === "DRIVER"\) setTab\("delivery"\)/);
  assert.match(app, /driverOnly \? item.id === "delivery"/);
  assert.match(service, /staff.role === "DRIVER" \? \{ deliveryAssignment:/);
  assert.match(service, /actor.role === "DRIVER" && !isAssignedDriver/);
  assert.match(realtime, /deliveryAssignment.findFirst/);
  assert.match(panel, /"\/driver"/);
  assert.match(panel, /DRIVER/);
});

test("L04 overview order accept is not one-tap: separate confirmation modal", () => {
  assert.match(app, /onPress=\{\(\) => setConfirmTarget\(order\)\}/);
  assert.match(app, /<Modal visible=\{!!confirmTarget\}/);
  assert.match(app, /Xác nhận nhận đơn\?/);
  assert.match(app, /if \(confirmTarget\) void confirm\(confirmTarget\)/);
  assert.match(app, /expectedStatus: "PENDING", toStatus: "CONFIRMED"/);
});
