import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { historyPeriodRange, vietnamDay } from "../src/history-search.ts";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const report = read("../src/BusinessReportPanel.tsx");
const app = read("../App.tsx");
const queue = read("../src/OrderQueuePanel.tsx");
const api = read("../../api/src/orders/admin-orders.service.ts");
const controller = read("../../api/src/orders/admin-orders.controller.ts");

test("L03 periods include today, yesterday, 7/30 days, this month and Vietnam midnight", () => {
  const now = new Date("2026-03-01T00:00:00.000Z");
  assert.equal(vietnamDay(now), "2026-03-01");
  assert.deepEqual(historyPeriodRange("yesterday", now),
    { period: "yesterday", from: "2026-02-28", to: "2026-02-28" });
  assert.deepEqual(historyPeriodRange("thisMonth", now),
    { period: "thisMonth", from: "2026-03-01", to: "2026-03-01" });
  const monthEnd = new Date("2026-12-31T16:59:59.999Z");
  assert.deepEqual(historyPeriodRange("thisMonth", monthEnd),
    { period: "thisMonth", from: "2026-12-01", to: "2026-12-31" });
  assert.match(report, /<HistoryDateFilter report value=\{range\}/);
  assert.match(report, /onRangeChange/);
  assert.match(report, /Kỳ \{showDay\(from\)\}/);
});

test("L03 finance uses real status events and distinct order ids, not payment.updatedAt", () => {
  assert.match(controller, /@Get\(":branchId\/business-report"\)/);
  assert.match(api, /actor\.role !== "OWNER" && actor\.role !== "MANAGER"/);
  assert.match(api, /this\.prisma\.database\.\$queryRaw<ReportRow\[\]>/);
  assert.match(api, /AT TIME ZONE 'Asia\/Ho_Chi_Minh'/);
  assert.match(api, /SELECT DISTINCT ON \(h\."orderId"\)/);
  assert.match(api, /AND h\."createdAt" >=/);
  assert.match(api, /o\."status" = 'DELIVERED'/);
  assert.match(api, /p\."status" = 'CONFIRMED'/);
  assert.match(api, /p\."status" = 'REFUNDED'/);
  assert.match(api, /paymentCollectedAtAvailable: false/);
  assert.doesNotMatch(api, /"Payment" p[^;]+p\."updatedAt"/s);
});

test("L03 report is a dedicated screen entered from overview, with no new bottom tab", () => {
  assert.match(app, /accessibilityLabel="Mở báo cáo kinh doanh"/);
  assert.match(app, /onChangeTab\("report"\)/);
  assert.match(app, /tab === "report" && operator && branchId/);
  assert.match(app, /onDrillDown=\{\(metric, range\) => \{/);
  assert.match(app, /setReportMetric\(metric\)/);
  assert.match(app, /setHistoryRange\(range\)/);
  assert.match(app, /setOrderGroup\("history"\)/);
  assert.match(report, /onClose: \(\) => void/);
  assert.match(report, /onDrillDown: \(metric: ReportMetric, range: HistoryRange\) => void/);
  assert.match(report, /onPress=\{\(\) => onDrillDown\(item\.metric, period\)\}/);
  assert.match(report, /report\.days\.map\(day =>/);
  assert.match(report, /paymentCollectedAtAvailable: false/);
  assert.match(report, /KHÔNG phải dòng tiền theo ngày thực nhận/);
});

test("L03 all KPI drilldowns use scoped backend query and can return to history", () => {
  assert.match(controller, /@Query\("metric"\) metric\?: string/);
  assert.match(controller, /INVALID_REPORT_DRILLDOWN/);
  assert.match(queue, /reportMetric \? "&metric=" \+ encodeURIComponent\(reportMetric\)/);
  assert.match(queue, /accessibilityLabel="Thoát bộ lọc báo cáo"/);
  assert.match(queue, /onPress=\{onClearReportMetric\}/);
  assert.match(api, /statusHistory: \{ some: \{/);
  assert.match(api, /paymentMatch/);
  assert.match(api, /group !== "lookup" \|\| !search\.from/);
  assert.match(api, /createdAt = orderCreatedBetween\(search\.from, search\.to\)/);
});
