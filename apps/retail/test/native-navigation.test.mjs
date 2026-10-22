import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const cfg = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;

test("Native back navigates POS without discarding an uncertain send", () => {
  assert.match(app, /BackHandler.addEventListener\("hardwareBackPress"/);
  assert.match(app, /cart.length \|\| pendingSubmit/);
  assert.match(app, /setPage\(page === "bill" \? "menu" : "tables"\)/);
  assert.match(app, /setSelectedProduct\(null\)/);
});
test("Native keyboard resizes and login form scrolls instead of clipping", () => {
  assert.equal(cfg.android.softwareKeyboardLayoutMode, "resize");
  assert.match(app, /contentContainerStyle=\{st.loginScreen\} keyboardShouldPersistTaps="handled"/);
  assert.match(app, /loginScreen: \{ flexGrow: 1/);
});
test("Retail keeps orientation unlocked and distinct fixed Android identity", () => {
  assert.equal(cfg.orientation, "default");
  assert.equal(cfg.android.package, "vn.sichuanhotpot.retail");
});
