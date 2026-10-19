import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("Admin overview uses server summary rather than first 100 most-recent orders", () => {
  assert.match(app, /\/summary", token/);
  assert.match(app, /\/pages\?group=new&limit=3/);
  assert.match(app, /setSummary\(figures\)/);
  assert.match(app, /setSummary\(null\)/);
  assert.match(app, /summary\?\.deliveredValueVnd/);
  assert.match(app, /summary\.confirmedPaymentVnd/);
  assert.doesNotMatch(app, /new Date\(order\.updatedAt\)/);
  assert.doesNotMatch(app, /\/admin\/orders\/" \+ branchId, token\)/);
});

test("Dashboard labels distinguish fulfilled order value from confirmed payments", () => {
  assert.match(app, /Giá trị giao hôm nay/);
  assert.match(app, /Thanh toán đã xác nhận trong đơn giao hôm nay/);
  assert.match(app, /QR đang chờ xác nhận/);
  assert.match(app, /\{loading \|\| !summary \? "—" : metric\.value\}/);
});
