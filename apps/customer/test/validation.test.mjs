import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../src/validation.ts", import.meta.url), "utf8");
test("input validation source preserves Vietnamese requirements and never hardcodes a shipping fee", () => {
  assert.match(raw, /Mật khẩu phải dài 6–8/);
  assert.match(raw, /tọa độ GPS/);
  assert.doesNotMatch(raw, /shipFee|deliveryFeeVnd\s*=/);
});
test("customer API adapter does not contain a fabricated success response", () => {
  const code = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(code, /response\.ok/);
  assert.match(code, /EXPO_PUBLIC_API_BASE_URL/);
  assert.doesNotMatch(code, /mockOrder|fakeOrder/);
});

test("login references exact owner R2 key and backend auth flow", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../src/screens/AuthScreen.tsx", import.meta.url), "utf8");
  assert.match(auth, /r2\.dev\/system-image\/login-hero\.png/);
  assert.match(auth, /"\/auth\/google"/);
  assert.match(app, /"\/auth\/me"/);
  assert.match(auth, /imageFailed/);
  assert.match(auth, /Xem thực đơn mà không cần đăng nhập/);
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

test("login-first responsive UI and red-white PWA viewport contract", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../src/screens/AuthScreen.tsx", import.meta.url), "utf8");
  const pwa = readFileSync(new URL("../scripts/lock-pwa-viewport.mjs", import.meta.url), "utf8");
  assert.match(app, /useState<Screen>\("login"\)/);
  assert.match(app, /screen === "login"/);
  assert.match(auth, /loginNoScroll/);
  assert.match(auth, /Logo Google nhiều màu/);
  assert.match(auth, /register\/request-code/);
  assert.match(auth, /password\/reset/);
  assert.match(pwa, /user-scalable=no/);
  assert.match(pwa, /maximum-scale=1/);
  assert.doesNotMatch(app, /#FFF7EB|#FFF9F1|#FFF8F0/);
});
