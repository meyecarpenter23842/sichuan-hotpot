import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("../src/VietnamAdministrativeAreaPicker.tsx",import.meta.url),"utf8");
test("shared modal picker is searchable, keyboard-safe and does not shift form layout",()=>{
  assert.match(src,/Modal transparent animationType="fade"/);
  assert.match(src,/FlatList data=\{filtered\}/);
  assert.match(src,/KeyboardAvoidingView/);
  assert.match(src,/SafeAreaView/);
  assert.match(src,/searchAdministrativeAreas/);
});
test("province resets ward, multi ward selection constrained by selected province",()=>{
  assert.match(src,/codes\[0\] === provinceCode \? wardCode : null/);
  assert.match(src,/selectableWardsForProvince\(provinceCode, wardsForProvince\(provinceCode\)\)/);
  assert.match(src,/accessibilityRole=\{multiple \? "checkbox" : "radio"\}/);
});

test("new selection filters former Đồng Tháp wards but preserves historical warning",()=>{
  assert.match(src,/selectableWardsForProvince\(province.code, wardsForProvince\(province.code\)\)/);
  assert.match(src,/isWardAllowedForNewDelivery\(provinceCode, wardCode\)/);
  assert.match(src,/excludedCount > 0/);
});
