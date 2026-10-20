import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ALL_HISTORY, calendarGrid, historyPeriodRange, rangeDays,
  shiftDay, showDay, validHistoryCode, vietnamDay,
} from "../src/history-search.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const panel = read("../src/OrderQueuePanel.tsx");
const app = read("../App.tsx");
const filter = read("../src/HistoryDateFilter.tsx");
const service = read("../../api/src/orders/admin-orders.service.ts");
const controller = read("../../api/src/orders/admin-orders.controller.ts");

test("L02 Vietnam timezone presets calculate inclusive created-day windows", () => {
  const beforeMidnight = new Date("2026-10-19T16:59:59.999Z");
  const midnight = new Date("2026-10-19T17:00:00.000Z");
  assert.equal(vietnamDay(beforeMidnight), "2026-10-19");
  assert.equal(vietnamDay(midnight), "2026-10-20");
  assert.deepEqual(historyPeriodRange("today", midnight),
    { period: "today", from: "2026-10-20", to: "2026-10-20" });
  assert.deepEqual(historyPeriodRange("week", midnight),
    { period: "week", from: "2026-10-14", to: "2026-10-20" });
  assert.deepEqual(historyPeriodRange("month", midnight),
    { period: "month", from: "2026-09-21", to: "2026-10-20" });
  assert.deepEqual(historyPeriodRange("all", midnight), ALL_HISTORY);
  assert.equal(rangeDays("2026-01-01", "2026-01-01"), 1);
  assert.equal(rangeDays("2026-01-01", "2026-12-31"), 365);
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(showDay("2026-10-20"), "20/10/2026");
});

test("L02 calendar picker is Monday-first, allows leap Feb and refuses huge ranges", () => {
  const feb = calendarGrid(2028, 1);
  assert.equal(feb.length, 42);
  assert.equal(feb.filter(Boolean).length, 29);
  assert.equal(feb[(new Date("2028-02-01T00:00:00Z").getUTCDay() + 6) % 7],
    "2028-02-01");
  assert.ok(feb.includes("2028-02-29"));
  assert.match(filter, /rangeDays\(start, to\) > 366/);
  assert.match(filter, /accessibilityLabel="Tháng trước"/);
  assert.match(filter, /accessibilityLabel="Tháng sau"/);
  assert.match(filter, /accessibilityLabel="Áp dụng khoảng ngày"/);
  assert.match(filter, /onChange\(\{ period: "custom", from: start, to \}\)/);
});

test("L02 user can type short or full UUID and server filters by indexes", () => {
  assert.equal(validHistoryCode("#793C85B1"), true);
  assert.equal(validHistoryCode("793c85b1"), true);
  assert.equal(validHistoryCode("00000000-0000-4000-8000-000000000000"), true);
  assert.equal(validHistoryCode("793c85"), false);
  assert.equal(validHistoryCode("anything' OR true"), false);
  assert.match(controller, /@Query\("from"\) from\?: string/);
  assert.match(controller, /@Query\("code"\) code\?: string/);
  assert.match(controller, /"history", "lookup", "kitchen"/);
  assert.match(service, /group === "lookup" && staff\.role !== "OWNER"/);
  assert.match(service, /orderCreatedBetween\(search\.from, search\.to\)/);
  assert.match(service, /orderIdMatch\(search\.code\)/);
  assert.match(service, /AND: \[\{ id: cursorId \}\]/);
});

test("L02 history filters are server-driven, debounced and persistent across bottom tabs", () => {
  assert.match(app, /const \[historyRange, setHistoryRange\] = useState<HistoryRange>\(ALL_HISTORY\)/);
  assert.match(app, /const \[historyCode, setHistoryCode\] = useState\("".*\)/);
  assert.match(panel, /const timer = setTimeout\(\(\) => setDebouncedCode/);
  assert.match(panel, /const activeLane = mode === "orders"/);
  assert.match(panel, /group === "history" && \(hasCode \|\| reportMetric\) \? "lookup" : group/);
  assert.match(panel, /encodeURIComponent\(historyRange\.from\)/);
  assert.match(panel, /encodeURIComponent\(historyRange\.to\)/);
  assert.match(panel, /encodeURIComponent\(debouncedCode/);
  assert.match(panel, /<HistoryDateFilter value=\{historyRange\} onChange=\{onHistoryRangeChange\} \/>/);
  assert.match(panel, /autoCapitalize="characters"/);
  assert.match(panel, /accessibilityLabel="Tìm theo mã đơn"/);
  assert.match(panel, /onHistoryCodeChange\("".*\)/);
  assert.match(panel, /const visible = !badCode && !searchPending && loadedLaneUrl === laneUrl/);
  assert.match(panel, /accessibilityLabel="Thử tải lại đơn hàng"/);
  assert.match(panel, /while \(rows\.length < target && cursor\)/);
  assert.match(panel, /setLaneTotal\(total\)/);
});
