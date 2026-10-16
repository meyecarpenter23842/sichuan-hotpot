import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const combo = readFileSync(new URL("../src/combo.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const orders = readFileSync(new URL("../src/screens/OrdersScreen.tsx", import.meta.url), "utf8");

test("customer sees and must complete real combo groups before adding to cart", () => {
  assert.match(api, /kind: "STANDARD" \| "COMBO"/);
  assert.match(app, /Combo gồm/);
  assert.match(app, /selectedComboOptionIds/);
  assert.match(app, /changeDetailCombo/);
  assert.match(app, /comboSelectionError\(selectedProduct, selectedComboOptionIds\)/);
  assert.match(app, /comboOptionIds: selectedComboOptionIds/);
  assert.match(combo, /group\.minSelect/);
  assert.match(combo, /group\.maxSelect/);
  assert.match(combo, /childProduct\.isAvailable/);
});

test("cart and order history expose selected combo composition instead of a mystery total", () => {
  assert.match(app, /Thành phần combo/);
  assert.match(app, /cartComboOptionCount/);
  assert.match(app, /costs\.comboTotal/);
  assert.match(orders, /item\.comboItems\.map/);
  assert.match(orders, /component\.groupName/);
});

test("customer combo composition exposes configured size and blocks unavailable size", () => {
  assert.match(api, /variant: Variant \| null/);
  assert.match(app, /fixed\.variant \? " · " \+ fixed\.variant\.name/);
  assert.match(app, /choice\.variantName \? " · " \+ choice\.variantName/);
  assert.match(combo, /item\.variant != null && !item\.variant\.isAvailable/);
  assert.match(combo, /option\.variant == null \|\| option\.variant\.isAvailable/);
  assert.match(orders, /component\.variantName/);
});


test("customer combo groups mix normal products and shared topping library choices", () => {
  assert.match(api, /modifierOptions: ComboModifierOption\[\]/);
  assert.match(combo, /function comboGroupChoices/);
  assert.match(combo, /sourceType: "TOPPING"/);
  assert.match(combo, /modifierOption\.group\.isAvailable/);
  assert.match(app, /comboGroupChoices\(group\)/);
  assert.match(app, /Topping ·/);
  assert.match(app, /snapshot\.modifierOptionId/);
  assert.match(api, /modifierOptionId: string \| null/);
});
