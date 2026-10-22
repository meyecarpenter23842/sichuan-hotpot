import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const pkg = JSON.parse(read("../package.json"));
const config = JSON.parse(read("../app.json"));
const release = JSON.parse(read("../vercel.json"));
const app = read("../App.tsx");
const service = read("../src/pos-api.ts");
const model = read("../src/pos-cart.ts");
const sheet = read("../src/ProductSheet.tsx");
test("Retail is isolated Expo Web PWA with strict typed checks, no automatic production deployment", () => {
  assert.equal(pkg.name, "@hotpot/retail");
  assert.match(pkg.scripts.build, /expo export --platform web/);
  assert.equal(config.expo.web.output, "single");
  assert.equal(release.git.deploymentEnabled, false);
  assert.match(read("../src/api-origin.ts"), /EXPO_PUBLIC_API_BASE_URL/);
  assert.doesNotMatch(service, /(?:window\.localStorage|localStorage\.setItem|sessionStorage\.setItem|AsyncStorage\.setItem)/);
});
test("real branch-scoped staff and menu flow, no demo checkout", () => {
  for (const snippet of ["/auth/login", "/auth/me", "/admin/orders/branches",
    "/catalog/branches/", 'root + "/tables"', 'root + "/approvals"',
    '/sessions/" + sessionId', '"/sessions/" + frozen.sessionId + "/tickets"',
    '"/tickets/" + ticketId + "/" + decision']) assert.ok(app.includes(snippet), snippet);
  assert.match(app, /const permitted = \["OWNER", "MANAGER", "WAITER", "CASHIER"\]/);
  assert.match(app, /!canOrder\(role\)/);
  assert.match(app, /setInterval\(\(\) => \{ if \(AppState\.currentState === "active"\)/);
  assert.match(app, /clientKey\(\)/);
  assert.match(app, /setPendingSubmit\(frozen\)/);
  assert.match(app, /setPendingSubmit\(null\); setCart\(\[\]\)/);
  assert.match(app, /Duyệt đưa Bếp/);
  assert.match(app, /Đợi nhân viên xác nhận/);
  // L07 replaced the old promise with real server-backed settlement controls.
  assert.match(app, /<RetailSettlementPanel/);
  const settlement = read("../src/RetailSettlementPanel.tsx");
  assert.match(settlement, /"\/payments"/);
  assert.match(settlement, /"\/checkout"/);
  assert.match(settlement, /"\/close"/);
  assert.match(settlement, /"\/transfer"/);
  assert.match(settlement, /"\/confirm"/);
  assert.match(settlement, /"\/refund"/);
  // Cleaning is a table-list action, not part of the settlement form.
  assert.match(app, /"\/clean"/);
  assert.doesNotMatch(app, /\/customer\/checkout|payment\/confirm|\/delivery\//);
});
test("real image paths and sizes, modifiers, combo requirements respect backend limits", () => {
  assert.match(service, /products-image\|catalog-media/);
  assert.match(service, /pub-63ed7b1c33514906ab6e2d82f41bffce\.r2\.dev/);
  assert.match(model, /isSelectionValid/);
  assert.match(model, /group\.minSelect/);
  assert.match(model, /group\.maxSelect/);
  assert.match(model, /comboOptionIds/);
  assert.match(sheet, /Ghi chú chế biến/);
  assert.match(sheet, /Chọn size/);
  assert.match(sheet, /Có sẵn trong combo/);
  assert.match(sheet, /maxLength=\{500\}/);
});
test("tablet/desktop split and distinct mobile routes enforce tap accessibility", () => {
  assert.match(app, /const desktop = width >= 768/);
  assert.match(app, /width: "40%"/);
  assert.match(app, /page === "tables"/);
  assert.match(app, /page === "menu"/);
  assert.match(app, /accessibilityRole="tab"/);
  assert.match(app, /minHeight: 44/);
  assert.match(app, /SafeAreaProvider/);
  assert.match(app, /keyboardShouldPersistTaps="handled"/);
});
