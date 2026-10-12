import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../src/validation.ts", import.meta.url), "utf8");
test("input validation source preserves Vietnamese requirements and never hardcodes a shipping fee", () => {
  assert.match(raw, /Mật khẩu mới phải dài 12/);
  assert.match(raw, /tọa độ GPS/);
  assert.doesNotMatch(raw, /shipFee|deliveryFeeVnd\s*=/);
});
test("customer API adapter does not contain a fabricated success response", () => {
  const code = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(code, /response\.ok/);
  assert.match(code, /EXPO_PUBLIC_API_BASE_URL/);
  assert.doesNotMatch(code, /mockOrder|fakeOrder/);
});
