import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../src/OrderQueuePanel.tsx", import.meta.url), "utf8");

test("L02 detail transition controls remain visible below scroll body and preserve action guards", () => {
  const start = panel.indexOf('<Modal visible={!!selected}');
  const afterScroll = panel.indexOf('</ScrollView>', start);
  const footer = panel.indexOf('style={s.detailFooter}', afterScroll);
  assert.ok(start > 0 && afterScroll > start && footer > afterScroll);
  const rest = panel.slice(footer);
  assert.match(rest, /availableActions\(selected\.status, role\)\.map/);
  assert.match(rest, /onPress=\{\(\) => void save\(\)\}/);
  assert.match(rest, /\["CANCELED", "DELIVERY_FAILED"\]\.includes\(action\)/);
  assert.match(rest, /reason\.trim\(\)\.length < 5/);
  assert.match(rest, /selected\.payment\?\.method === "COD"/);
  assert.match(rest, /disabled=\{saving/);
  assert.match(panel, /<KeyboardAvoidingView style=\{s\.detailKeyboard\}/);
  assert.match(panel, /behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/);
});

test("L02 delivery summary and contact actions precede the long item list", () => {
  const detail = panel.indexOf('<Modal visible={!!selected}');
  const summary = panel.indexOf('style={s.detailCustomerSummary}', detail);
  const contact = panel.indexOf('style={s.deliveryContact}', detail);
  const items = panel.indexOf('selected.items.map', detail);
  assert.ok(summary > detail && contact > summary && items > contact);
  assert.match(panel, /selected\.totalVnd !== undefined/);
  assert.match(panel, /orderCustomerCallUrl\(selected\.phoneSnapshot\)/);
  assert.match(panel, /orderCustomerDirectionsUrl\(selected\.latitudeSnapshot, selected\.longitudeSnapshot\)/);
});

test("L02 hides an empty driver picker without loosening role and status guards", () => {
  assert.match(panel, /manager && \["READY", "DELIVERY_FAILED"\]\.includes\(selected\.status\)/);
  assert.match(panel, /drivers\.length > 0 \|\| !!selected\.deliveryAssignment\?\.driverId \|\| !!assignError/);
  assert.match(panel, /drivers\.map\(driver => <Pressable/);
  assert.doesNotMatch(panel, /Chưa có nhân viên DRIVER trong chi nhánh này/);
  assert.match(panel, /const kitchenOnly = role === "KITCHEN" \|\| mode === "kitchen"/);
  assert.match(panel, /!kitchenOnly && <View style=\{s\.detailCustomerSummary\}>/);
});
