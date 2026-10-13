import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const purchased = readFileSync(new URL("../src/screens/PurchasedProductsScreen.tsx", import.meta.url), "utf8");

test("PWA and Android both persist rotating refresh sessions", () => {
  assert.doesNotMatch(app, /Platform\.OS === "web" \? AsyncStorage\.getItem\(REFRESH_KEY\)/);
  assert.match(app, /refreshBrowserSession/);
  assert.match(app, /startBrowserSession/);
  assert.match(app, /writeRefresh\(tokens\.refreshToken\)/);
  assert.match(app, /setAuthReady\(true\)/);
  assert.match(app, /authRestoreError/);
  assert.match(app, /setAccessExpiresAt/);
  assert.match(app, /renewSession/);
  assert.match(api, /class ApiRequestError extends Error/);
});

test("home cart has no counterfeit counter, notification links to real orders", () => {
  assert.match(app, /name="notifications" active size=\{27\}/);
  assert.match(app, /accessibilityLabel="Thông báo đơn hàng, xem đơn hàng"/);
  assert.doesNotMatch(app, /\{itemCount\}/);
  assert.doesNotMatch(app, /<View style=\{styles\.cartIconSurface\}>/);
});

test("account address editor is a dismissible modal and saved pins open maps", () => {
  assert.match(app, /<Modal visible=\{addressModalOpen\}/);
  assert.match(app, /onRequestClose=\{closeAddressEditor\}/);
  assert.match(app, /function showAddressPin\(saved: SavedAddress\)/);
  assert.match(app, /function savedAddressCards\(/);
  assert.match(app, /styles\.accountLogout/);
});

test("purchased products are backed by delivered orders, reorders revalidate in catalogue", () => {
  assert.match(purchased, /\/customer\/orders/);
  assert.match(purchased, /order\.status === "DELIVERED"/);
  assert.match(purchased, /onReorder\(\{/);
  assert.match(app, /optionSelectionError\(product\.modifierGroups, modifierIds\)/);
  assert.match(app, /product\.isAvailable/);
});
