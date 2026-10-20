import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const panel = readFileSync(new URL("../src/OrderQueuePanel.tsx", import.meta.url), "utf8");

test("orders screen uses its compact status tabs as the sole permanent navigation", () => {
  assert.match(panel, /\{mode !== "orders" && <>/);
  assert.match(panel, /\{mode === "orders" && group !== "history" && <View style=\{s\.tabsToolbar\}>/);
  assert.match(panel, /\{mode === "orders" && group === "history" && <View style=\{s\.historyHeading\}>/);
  assert.match(panel, /accessibilityLabel="Mở lịch sử đơn hàng"/);
  assert.match(panel, /"Quay lại đơn đang xử lý"/);
  assert.doesNotMatch(panel, /<Text[^>]*>\s*Lịch sử\{group ===/);
  assert.match(panel, /accessibilityLabel="Bộ lọc trạng thái đơn"/);
  assert.match(panel, /onPress=\{\(\) => onGroupChange\(item\.id\)\}/);
  assert.match(panel, /tabsToolbar: \{ flexDirection: "row", alignItems: "center"/);
  assert.doesNotMatch(panel, /Tổng quan gần đây|Đơn thật ·|<Text style=\{s\.sync/);
  assert.doesNotMatch(panel, /Đã hiển thị hết/);
});

test("orders still refresh, warn and allow all original state transitions", () => {
  assert.match(panel, /accessibilityLabel="Đồng bộ lịch sử đơn hàng"/);
  assert.match(panel, /disabled=\{syncing \|\| laneLoading\} onPress=\{\(\) => void sync\(\)\}/);
  assert.match(panel, /watchOrderEvents/);
  assert.match(panel, /setInterval\(\(\) => \{/);
  assert.match(panel, /overdueCount > 0 && !kitchenOnly/);
  assert.match(panel, /\{!!laneError && <View style=\{s.retryRow\}>/);
  assert.match(panel, /accessibilityLabel="Thử tải lại đơn hàng"/);
  assert.match(panel, /\{visible\.map\(order => <View key=\{order\.id\}/);
  assert.match(panel, /\/admin\/orders\//);
  assert.match(panel, /label: "Đã giao thành công"/);
});
