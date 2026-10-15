import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const catalog = read("../src/CatalogPanel.tsx");
const groups = read("../src/ModifierGroupsPanel.tsx");
const sw = read("../src/StatusSwitch.tsx");
test("L05 uses real product-scoped groups and accessible switches", () => {
  assert.match(catalog, /<ModifierGroupsPanel catalog=\{catalog\}/);
  assert.match(catalog, /tab === "modifiers"/);
  assert.match(catalog, /validateGroupAvailability/);
  assert.match(groups, /product\.modifierGroups\.map\(group =>/);
  assert.match(groups, /group\.options\.map\(option =>/);
  assert.match(groups, /product\.variants\.map\(variant =>/);
  assert.match(groups, /Các nhóm hiện được thiết lập riêng cho từng món/);
  assert.match(sw, /accessibilityRole="switch"/);
  assert.match(sw, /minHeight: 44, minWidth: 56/);
});
test("L05 does not present product-scoped groups as a reusable library", () => {
  assert.doesNotMatch(groups, /placeholderData|mockGroups/);
  assert.match(groups, /onEditGroup\(product, group\)/);
  assert.match(groups, /onToggleOption\(group, option, next\)/);
  assert.match(catalog, /busyRef\.current = true/);
  assert.match(catalog, /request\(root \+ path, token, method, body\)/);
});
