import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/screens/AuthScreen.tsx", import.meta.url), "utf8");

test("L07 login uses a labeled orange/grey native switch instead of checkbox", () => {
  assert.match(source, /<Switch value=\{remember\} onValueChange=\{changeRemember\}/);
  assert.match(source, /accessibilityLabel="Ghi nhớ tên đăng nhập"/);
  assert.match(source, /true: "#FA850F"/);
  assert.match(source, /false: "#B7B8BC"/);
  assert.doesNotMatch(source, /accessibilityRole="checkbox"/);
});

test("L07 switching remember off clears only the saved username; never persists password", () => {
  assert.match(source, /AsyncStorage\.removeItem\(REMEMBER_USERNAME\)/);
  assert.match(source, /AsyncStorage\.setItem\(REMEMBER_USERNAME, username\.trim\(\)\)/);
  assert.match(source, /disabled=\{busy \|\| rememberSaving\}/);
  assert.doesNotMatch(source, /AsyncStorage\.setItem\([^\n]*(?:password|accessToken|refreshToken)/);
});
