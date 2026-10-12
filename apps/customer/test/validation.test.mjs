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

test("login references exact owner R2 key and real backend auth flow", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /r2\.dev\/system-image\/login-hero\.png/);
  assert.match(app, /"\/auth\/google"/);
  assert.match(app, /"\/auth\/me"/);
  assert.match(app, /loginHeroFailed/);
  assert.match(app, /Xem thực đơn mà không cần đăng nhập/);
});

test("P2.2 uses real modifier IDs/option groups without trusting prices", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(app, /optionSelectionError/);
  assert.match(app, /selectedModifierIds/);
  assert.match(app, /selectedModifierPrice/);
  assert.match(api, /products-image/);
  assert.match(api, /imageKey/);
  assert.match(app, /\/customer\/addresses/);
  assert.doesNotMatch(app, /fakeCheckout|mockOrder|deliveryFeeVnd\s*=\s*0/);
});

test("P2.2 option selection enforces required, max and unavailable options", async () => {
  const { optionSelectionError } = await import("../src/validation.ts");
  const groups = [{ name: "Độ cay", minSelect: 1, maxSelect: 1,
    options: [{ id: "mild", isAvailable: true }, { id: "hot", isAvailable: true }, { id: "gone", isAvailable: false }] }];
  assert.match(optionSelectionError(groups, []) ?? "", /Vui lòng chọn/);
  assert.equal(optionSelectionError(groups, ["mild"]), null);
  assert.match(optionSelectionError(groups, ["mild", "hot"]) ?? "", /Chọn quá/);
  assert.match(optionSelectionError(groups, ["gone"]) ?? "", /hết hàng/);
  assert.match(optionSelectionError(groups, ["unknown"]) ?? "", /không hợp lệ/);
});
