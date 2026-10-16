import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const catalog = read("../src/CatalogPanel.tsx");
const groups = read("../src/ModifierGroupsPanel.tsx");
const sw = read("../src/StatusSwitch.tsx");
const library = read("../src/SharedModifierLibraryPanel.tsx");
test("L03 provides actual branch-scoped reusable groups and accessible controls", () => {
  assert.match(catalog, /<SharedModifierLibraryPanel catalog=\{catalog\}/);
  assert.match(catalog, /tab === "modifiers"/);
  assert.match(catalog, /validateGroupAvailability/);
  assert.match(library, /catalog\.modifierLibrary/);
  assert.match(library, /group\.options\.map\(option=>/);
  assert.match(library, /usedByProductIds/);
  assert.match(library, /accessibilityRole="checkbox"/);
  assert.match(sw, /accessibilityRole="switch"/);
  assert.match(sw, /minHeight: 44, minWidth: 56/);
});
test("L03 attaches shared groups to multiple products without duplicate creation", () => {
  assert.match(library, /group-assignments/);
  assert.match(library, /catalog\.catalogRevision/);
  assert.match(catalog, /setAssignProductId/);
  assert.match(library, /onPickImage\("options"/);
  assert.match(library, /onPickImage\("groups"/);
  assert.match(catalog, /busyRef\.current = true/);
  assert.match(catalog, /request\(root \+ path, token, method, body\)/);
});

test("L05 displays server and selection errors in both tabs", () => {
  const toast = '{toast && <View style={st.toastLayer} pointerEvents="box-none">';
  const modal = '<Modal visible={editor !== null}';
  assert.ok(catalog.indexOf(toast) >= 0 && catalog.indexOf(toast) < catalog.indexOf(modal),
    "Errors must render above the scrolling body for either tab");
  assert.match(catalog, /setTimeout\(\(\) =>/);
  assert.match(catalog, /4200/);
  assert.match(catalog, /accessibilityLabel="Đóng thông báo"/);
  assert.match(catalog, /remaining < group\.minSelect/);
});
