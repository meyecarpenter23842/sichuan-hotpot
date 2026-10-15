import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const hub = read("../src/SettingsHub.tsx");
const branch = read("../src/BranchPanel.tsx");
const policy = read("../src/DeliveryPolicyPanel.tsx");
const hours = read("../src/HoursPanel.tsx");
const catalog = read("../src/CatalogPanel.tsx");
const app = read("../App.tsx");

test("L07 real settings use semantic switches; selectors and actions remain actions", () => {
  assert.match(hub, /<StatusSwitch value=\{chimeEnabled\}/);
  assert.doesNotMatch(hub, /<Action label=\{chimeEnabled \?/);
  assert.match(branch, /<StatusSwitch value=\{branch\.isActive\}/);
  assert.match(policy, /<StatusSwitch value=\{acceptingOrders\}/);
  assert.match(hours, /<StatusSwitch value=\{!day\.isClosed\}/);
  assert.doesNotMatch(hours, /<Pill label=\{day\.isClosed/);
  assert.doesNotMatch(policy, /<Pill label="Tạm dừng"/);
  assert.match(catalog, /<StatusSwitch value=\{product\.isAvailable\}/);
  assert.match(catalog, /<StatusSwitch value=\{variant\.isAvailable\}/);
  assert.match(catalog, /<StatusSwitch value=\{option\.isAvailable\}/);
});

test("L07 branch status stays server-owned and requires explicit confirmation", () => {
  assert.match(branch, /setConfirmStatus\(next\)/);
  assert.match(branch, /<Modal visible=\{confirmStatus !== null\}/);
  assert.match(branch, /confirmStatus === branch\.isActive/);
  assert.match(branch, /"PATCH", \{ isActive: confirmStatus \}/);
  assert.match(branch, /await onSaved\(updated\.id, false\)/);
  assert.match(branch, /disabled=\{saving\}/);
  assert.match(branch, /Đơn đã đặt vẫn được giữ nguyên/);
});

test("L07 acceptance toggle is only draft, cannot enable inactive/unconfigured branch", () => {
  assert.match(policy, /disabled=\{current\?\.pricingMode !== "ZONE" \|\| \(!active && !acceptingOrders\)\}/);
  assert.match(policy, /setAcceptingOrders\(next\)/);
  assert.match(policy, /Thay đổi chưa được lưu trên máy chủ/);
  assert.match(policy, /"POST", payload/);
  assert.match(policy, /applyPolicy\(value\)/);
  assert.match(policy, /setAcceptingOrders\(value\?\.acceptingOrders \?\? false\)/);
});

test("L07 unsaved weekly hours remain local until API PUT", () => {
  assert.match(hours, /onDirtyChange\?\.\(hasChanges\)/);
  assert.match(hours, /Lịch bán có thay đổi chưa lưu/);
  assert.match(hours, /onValueChange=\{\(\) => toggleDay\(day\)\}/);
  assert.match(hours, /token, "PUT", \{ days \}/);
  assert.match(hours, /busy=\{saving\}/);
});

test("L07 chime preference persists per-device and serializes rapid toggles", () => {
  assert.match(app, /chimeLock\.current \|\| chimePending/);
  assert.match(app, /void saveOrderChime\(enabled\)/);
  assert.match(app, /setChimeEnabled\(enabled\)/);
  assert.match(app, /chimeError=\{chimeError\}/);
  assert.match(hub, /busy=\{chimePending\}/);
  assert.match(hub, /if \(next\) playOrderChime\(\)/);
});
