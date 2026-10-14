import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const density = read("../src/density.ts");
const app = read("../App.tsx");
const settings = read("../src/SettingsHub.tsx");
const orders = read("../src/OrderQueuePanel.tsx");
const catalog = read("../src/CatalogPanel.tsx");

test("shared UI density reduces visual height without sacrificing 44dp actions", () => {
  for (const token of [
    /headerTop: 68/, /branchSelector: 50/, /bottomTab: 46/,
    /dashboardMetric: 82/, /settingTile: 104/, /settingIcon: 44/,
  ]) assert.match(density, token);
  assert.match(app, /minHeight: adminDensity\.bottomTab/);
  assert.match(app, /height: 44, width: 44/);
  assert.match(app, /numberOfLines=\{2\}>\{metric\.label\}/);
  assert.match(settings, /minHeight: adminDensity\.settingTile/);
  assert.match(settings, /maxHeight: "92%"/);
  assert.match(orders, /minHeight: 44, flexDirection: "row"/);
  assert.match(catalog, /minHeight: 58/);
});
test("status and totals remain server driven, no fake counts", () => {
  assert.match(app, /request<StaffOrder\[]>\("\/admin\/orders\/"/);
  assert.match(app, /selectedBranch\?\.isActive/);
  assert.match(app, /pending: orders\.filter/);
  assert.match(app, /formatMoney\(deliveredVnd\)/);
});
