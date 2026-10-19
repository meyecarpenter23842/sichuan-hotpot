import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const settings = readFileSync(new URL("../src/SettingsHub.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/CustomerPanel.tsx", import.meta.url), "utf8");
const apiService = readFileSync(new URL("../../api/src/orders/admin-orders.service.ts", import.meta.url), "utf8");

test("Customers are OWNER-only inside existing settings popup, not a new dashboard", () => {
  assert.match(settings, /id: "customers".*owner: true/);
  assert.match(settings, /selected === "customers" && owner && <CustomerPanel/);
  assert.match(settings, /key={branch.id}/);
  assert.match(panel, /setHistory\(response.items\)/);
  assert.match(panel, /aria|accessibilityRole="button"/);
  assert.match(panel, /Xem thêm khách/);
  assert.match(panel, /Không tải được khách hàng/);
  assert.match(panel, /Chưa có khách đặt hàng/);
});

test("No customer auth, GPS or address snapshots are exposed by directory/history", () => {
  const area = apiService.slice(apiService.indexOf("  async customers("),
    apiService.indexOf("  async list(", apiService.indexOf("  async customers(")));
  assert.match(area, /actor.role !== "OWNER"/);
  assert.match(area, /orders: \{ some: \{ branchId \} \}/);
  assert.match(area, /where: \{ branchId, customerId \}/);
  assert.match(area, /take: 20/);
  assert.match(area, /take: limit \+ 1/);
  assert.doesNotMatch(area, /latitudeSnapshot: true|longitudeSnapshot: true|addressLineSnapshot: true|localCredential: true/);
});
