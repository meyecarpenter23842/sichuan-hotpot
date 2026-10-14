import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const address = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const web = readFileSync(new URL("../src/components/AddressPinMap.web.tsx", import.meta.url), "utf8");
const native = readFileSync(new URL("../src/components/AddressPinMap.native.tsx", import.meta.url), "utf8");
test("PWA and Android use real draggable pins with manual coordinate fallback", () => {
  assert.match(web, /L\.tileLayer/);
  assert.match(web, /map\.on\("click"/);
  assert.match(web, /mapPin\.on\("dragend"/);
  assert.match(native, /<MapView/);
  assert.match(native, /<Marker coordinate=\{pin\} draggable/);
  assert.match(native, /onDragEnd=/);
  assert.match(address, /<AddressPinMap latitude=\{address\.latitude\}/);
  assert.match(address, /Vĩ độ \(latitude\)/);
  assert.match(address, /Kinh độ \(longitude\)/);
});
test("draft address modal preserves existing selection on cancel, selects only after save", () => {
  assert.match(address, /addressBeforeModal\.current = address/);
  assert.match(address, /if \(addressBeforeModal\.current\) setAddress\(addressBeforeModal\.current\)/);
  assert.match(address, /setSelectedAddressId\(saved\.id\)/);
  assert.match(address, /setAddressModalOpen\(false\)/);
});
