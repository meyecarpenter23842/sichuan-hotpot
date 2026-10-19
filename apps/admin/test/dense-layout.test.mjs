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
    /headerTop: 62/, /branchSelector: 44/, /bottomTab: 46/,
    /dashboardMetric: 70/, /settingTile: 104/, /settingIcon: 44/,
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
  assert.match(app, /request<DailyOverviewSummary>\("\/admin\/orders\/"/);
  assert.match(app, /request<\{ items: StaffOrder\[] \}>/);
  assert.match(app, /selectedBranch\?\.isActive/);
  assert.match(app, /pending: summary\?\.pending \?\? 0/);
  assert.match(app, /formatMoney\(summary\?\.deliveredValueVnd \?\? 0\)/);
});

test("branch chooser overlays without changing page layout, and catalog tabs stay above local scroller", () => {
  assert.match(app, /style=\{\[styles\.branchOverlay, \{ top: headerHeight \}\]\}/);
  assert.match(app, /position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 50/);
  assert.match(app, /tab === "catalog" && catalog && branches\.length > 0/);
  assert.match(catalog, /<ScrollView testID="catalog-body-scroll" style=\{st\.contentScroll\}/);
  assert.doesNotMatch(catalog, /<ScrollView key=\{tab\}/);
  assert.match(catalog, /minHeight: 0/);
  assert.doesNotMatch(catalog, /branchWarning:/);
  assert.match(catalog, /heading: \{[^\n]*height: 44, flexShrink: 0/);
  assert.doesNotMatch(app, /remove scroll catalog/);
});
