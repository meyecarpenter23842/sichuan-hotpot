import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL(p, import.meta.url), "utf8");
const report = read("../src/BusinessReportPanel.tsx");
const dining = read("../src/DiningReportSection.tsx");
const legacy = read("../../api/src/orders/admin-orders.service.ts");
const backend = read("../../api/src/dining/dining-report.service.ts");
const controller = read("../../api/src/dining/dining-report.controller.ts");

test("L08 report channels retain immutable delivery clock and separate dine-in cash clock", () => {
  assert.match(report, /"DELIVERY" \| "DINE_IN" \| "ALL"/);
  assert.match(report, /Báo cáo kênh:/);
  assert.match(report, /channel !== "DINE_IN"/);
  assert.match(report, /channel !== "DELIVERY"/);
  assert.match(report, /<DiningReportSection token={token}/);
  assert.match(report, /"\/business-report\?from="/);
  assert.match(legacy, /paymentBasis: "CURRENT_CONFIRMED_STATUS_BY_DELIVERY_DATE"/);
  assert.match(report, /Chưa có thời điểm thu tiền giao hàng/);
});
test("L08 report uses server SQL aggregation, explicit accounting clocks and paging", () => {
  assert.match(backend, /vietnamDateWindow\(from, to\)/);
  assert.match(backend, /AT TIME ZONE 'Asia\/Ho_Chi_Minh'/);
  assert.match(backend, /s\.status = 'CLOSED'/);
  assert.match(backend, /a\.action = 'PAYMENT_REFUNDED'/);
  assert.match(backend, /p\.status IN \('CONFIRMED', 'REFUNDED'\)/);
  assert.match(backend, /LIMIT \$\{limit \+ 1\} OFFSET \$\{page \* limit\}/);
  assert.match(backend, /"confirmedAt"/);
  assert.match(backend, /"closedAt"/);
  assert.match(backend, /DINING_REPORT_FORBIDDEN/);
  assert.match(controller, /ParseUUIDPipe/);
  assert.match(controller, /Cache-Control", "no-store"/);
});
test("L08 mobile-first report has loading, empty, errors, safe controls and separate refund", () => {
  assert.match(dining, /accessibilityRole="button"/);
  assert.match(dining, /minHeight: 44/);
  assert.match(dining, /ActivityIndicator/);
  assert.match(dining, /setError/);
  assert.match(dining, /Chưa có món trong hóa đơn/);
  assert.match(dining, /netCollectedVnd/);
  assert.match(dining, /refundedVnd/);
  assert.match(dining, /shiftBasis: "NOT_AVAILABLE"/);
  assert.match(dining, /Đây là khoản xác nhận theo nhân viên/);
  assert.match(dining, /"Xem thêm mặt hàng"/);
  assert.match(dining, /"Xem thêm nhân viên"/);
  assert.doesNotMatch(dining, /createOrder\(|localStorage|AsyncStorage/);
});
