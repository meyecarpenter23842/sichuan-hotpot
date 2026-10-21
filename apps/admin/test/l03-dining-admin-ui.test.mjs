import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../App.tsx");
const hub = read("../src/SettingsHub.tsx");
const config = read("../src/DiningConfigurationPanel.tsx");
const board = read("../src/DiningTablesPanel.tsx");
const qr = read("../src/TableQrPreview.tsx");
const api = read("../../api/src/dining/dining.controller.ts");
const service = read("../../api/src/dining/dining.service.ts");
const branches = read("../../api/src/orders/admin-orders.service.ts");

test("operational bottom tabs are exactly five; management pages stay off bottom", () => {
  assert.match(app, /id: "dining", label: "Bàn", shortLabel: "Bàn"/);
  assert.doesNotMatch(app, /id: "catalog", label: "Thực đơn", shortLabel: "Món"/);
  assert.match(app, /\["overview", "orders", "kitchen", "dining", "delivery"\]/);
  assert.match(app, /diningArea.*setDiningArea/);
  assert.match(app, /filter={diningFilter} onFilterChange={setDiningFilter}/);
  assert.match(app, /display={diningDisplay} onDisplayChange={setDiningDisplay}/);
  assert.match(app, /tab === "catalog" && catalog/);
  assert.match(app, /<CatalogPanel catalog={catalog} token={token} reload={reload}/);
  assert.match(app, /<DiningConfigurationPanel key={branchId} token={token} branchId={branchId}/);
  assert.match(hub, /id: "catalog", label: "Món & danh mục"/);
  assert.match(hub, /id: "dining-config", label: "Bàn & QR"/);
  assert.match(app, /setTab\(destination\)/);
  assert.match(app, /managementBack/);
});

test("Admin QR is rendered offline and printed only for active tables", () => {
  assert.match(qr, /tableQrMatrix\(url\)/);
  assert.match(qr, /tableQrSvg\(url\)/);
  assert.match(qr, /StorageAccessFramework\.createFileAsync/);
  assert.match(qr, /document\.createElement\("a"\)/);
  assert.match(qr, /popup\.print\(\)/);
  assert.doesNotMatch(qr, /api\.qrserver|quickchart|googleapis/);
  assert.match(config, /const printable = table\.isActive && !!area\?\.isActive/);
  assert.match(config, /disabled={!printable}/);
  assert.match(config, /rotateConfirm/);
  assert.match(config, /"\/rotate-qr"/);
});

test("dining board uses branch scoped real endpoints, no demo orders or fake payments", () => {
  assert.match(board, /"\/tables", token/);
  assert.match(board, /"\/approvals", token/);
  assert.match(board, /base \+ "\/sessions\/" \+ table\.sessions\[0\]\.id, token/);
  assert.match(board, /"\/approve", token, "POST"/);
  assert.match(board, /"\/reject", token, "POST"/);
  assert.match(board, /"\/tables\/" \+ table\.id \+ "\/sessions"/);
  assert.match(board, /bill\.dueVnd/);
  assert.match(board, /AppState\.currentState === "active"/);
  assert.match(board, /minHeight: 44/);
  assert.match(board, /accessibilityRole="button"/);
});
test("backend creates scoped areas/tables and rotates a live table credential atomically", () => {
  for (const endpoint of ["configuration", "areas/:areaId", "tables/:tableId/rotate-qr"]) {
    assert.ok(api.includes(endpoint));
  }
  assert.match(service, /async createArea/);
  assert.match(service, /async editArea/);
  assert.match(service, /async createTable/);
  assert.match(service, /async editTable/);
  assert.match(service, /async rotateQr/);
  assert.match(service, /DINING_TABLE_HAS_OPEN_SESSION/);
  assert.match(service, /DINING_AREA_HAS_OPEN_TABLES/);
  assert.match(service, /QR_ROTATED/);
  assert.match(service, /revokedAt: new Date\(\)/);
  assert.match(branches, /"WAITER", "CASHIER"/);
});
