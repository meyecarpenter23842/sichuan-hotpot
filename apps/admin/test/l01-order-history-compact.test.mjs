import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const source = path => readFileSync(new URL(path, import.meta.url), "utf8");
const panel = source("../src/OrderQueuePanel.tsx");
const date = source("../src/HistoryDateFilter.tsx");
const service = source("../../api/src/orders/admin-orders.service.ts");

test("L01 history has exactly one compact search/date/status toolbar", () => {
  assert.match(panel, /<View style=\{s\.historyToolbar\}>/);
  assert.match(panel, /placeholder="Mã đơn"/);
  assert.match(panel, /<HistoryDateFilter compact value=\{historyRange\}/);
  assert.match(panel, /accessibilityLabel=\{"?\s*"Lọc trạng thái: "/);
  assert.match(panel, /setStatusMenuOpen\(true\)/);
  assert.match(panel, /historyFilters\.map\(item => <Pressable/);
  assert.doesNotMatch(panel, /historyFilters\.map\(item => <Pressable[^]*?style=\{\[s\.historyFilter,/);
  assert.match(date, /compact && !calendarMode/);
  assert.match(date, /presets\.map\(item => <Pressable/);
  assert.match(date, /onPress=\{openPicker\}/);
  assert.match(date, /rangeDays\(start, to\) > 366/);
});

test("L01 order card shows identity/address only outside kitchen", () => {
  assert.match(panel, /!kitchenOnly && <View style=\{s\.customerHeader\}>/);
  assert.match(panel, /order\.customer\?\.localCredential\?\.normalizedUsername/);
  assert.match(panel, /order\.phoneSnapshot\?\.trim\(\) \|\| "Khách hàng"/);
  assert.match(panel, /!kitchenOnly && <Text numberOfLines=\{2\} style=\{s\.orderAddress\}>/);
  assert.match(panel, /order\.addressLineSnapshot\?\.trim\(\)/);
  assert.match(panel, /style=\{s\.orderIdSmall\}/);
  assert.match(panel, /style=\{s\.compactActions\}/);
  assert.match(panel, /style=\{s\.detailButton\}/);
  assert.match(service, /const kitchenOrderSelect = \{/);
  const kitchenSelect = service.split("const kitchenOrderSelect = {")[1].split("const driverOrderSelect")[0];
  assert.doesNotMatch(kitchenSelect, /phoneSnapshot|addressLineSnapshot|localCredential/);
  assert.match(service, /const driverOrderSelect = \{/);
  assert.match(service, /deliveryAssignment: \{ is: \{ driverId: staff\.actorId \} \}/);
  assert.match(service, /phoneSnapshot: true, addressLineSnapshot: true/);
});
