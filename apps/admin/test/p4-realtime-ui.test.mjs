import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const orders = read("../src/OrderQueuePanel.tsx");
const settings = read("../src/SettingsHub.tsx");
const client = read("../src/order-realtime.ts");
const admin = read("../App.tsx");
test("realtime hints refetch authoritative HTTP while preserving fallback polling", () => {
  assert.match(orders, /watchOrderEvents\(/);
  assert.match(orders, /onReady: \(\) => \{ void sync\(\)/);
  assert.match(orders, /setInterval\(\(\) =>/);
  assert.match(orders, /AppState\.addEventListener/);
  assert.match(client, /scope: "staff"/);
  assert.doesNotMatch(client, /\?token=/);
});
test("chime is opt-in and exists only in dedicated Settings popup", () => {
  assert.match(settings, /id: "alerts".*label: "Thông báo"/);
  assert.match(settings, /selected === "alerts"/);
  assert.match(admin, /onChimeChange=\{changeChime\}/);
});
test("pending alerts deduplicate by order ID and overdue warnings are visible", () => {
  assert.match(orders, /pendingAlerts\.current\.has\(x\.id\)/);
  assert.match(orders, /event\.type === "order\.overdue"/);
});
