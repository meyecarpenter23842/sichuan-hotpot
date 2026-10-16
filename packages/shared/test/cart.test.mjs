import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCartLine, cartItemCount, cartLineKey, checkoutCartItems,
  normalizeCartSelection, setCartQuantity, cartModifierCount,
  setCartModifierQuantity, replaceCartLineSelection, CartInputError,
} from "../dist/cart.js";

const base = { productId: "hotpot-1", variantId: null, modifierIds: ["tofu", "beef"] };
const swapped = { productId: "hotpot-1", variantId: null, modifierIds: ["beef", "tofu", "beef"] };

test("selection identity ignores order but preserves topping quantities", () => {
  assert.notEqual(cartLineKey(base), cartLineKey(swapped));
  assert.deepEqual(normalizeCartSelection(swapped).modifierIds, ["beef", "beef", "tofu"]);
  assert.equal(cartLineKey(base), cartLineKey({ ...base, modifierIds:["tofu","beef"] }));
  assert.equal(cartModifierCount(swapped,"beef"),2);
});

test("same selected item combines quantities; alternate variant stays separate", () => {
  const first = addCartLine([], base, 2);
  const combined = addCartLine(first, { ...base, modifierIds:["tofu","beef"] }, 3);
  assert.equal(combined.length, 1);
  assert.equal(combined[0].quantity, 5);
  const separate = addCartLine(combined, { ...base, variantId: "large" });
  assert.equal(separate.length, 2);
  assert.equal(cartItemCount(separate), 6);
  assert.equal(first[0].quantity, 2, "immutable original cart");
});

test("topping quantity changes rekey cart and merge matching configurations",()=>{
  const first=addCartLine([],base,2);
  const second=addCartLine(first,swapped,1);
  assert.equal(second.length,2,"different topping quantities are separate lines");
  const combined=setCartModifierQuantity(second,first[0].key,"beef",2);
  assert.equal(combined.length,1);
  assert.equal(combined[0].quantity,3,"identical configurations merge quantities");
  assert.equal(cartModifierCount(combined[0].selection,"beef"),2);
  const removed=setCartModifierQuantity(combined,combined[0].key,"beef",0);
  assert.equal(cartModifierCount(removed[0].selection,"beef"),0);
  assert.deepEqual(checkoutCartItems(combined)[0].modifierIds,["beef","beef","tofu"]);
  assert.throws(()=>setCartModifierQuantity(combined,combined[0].key,"beef",31),CartInputError);
  assert.throws(()=>replaceCartLineSelection(combined,"wrong",base),CartInputError);
});
test("quantity zero removes a line; updates cannot exceed 99", () => {
  const cart = addCartLine([], base, 4);
  assert.equal(setCartQuantity(cart, cart[0].key, 0).length, 0);
  assert.equal(setCartQuantity(cart, cart[0].key, 6)[0].quantity, 6);
  assert.throws(() => addCartLine(cart, base, 96), CartInputError);
  assert.throws(() => setCartQuantity(cart, cart[0].key, NaN), CartInputError);
  assert.throws(() => setCartQuantity(cart, "missing", 2), CartInputError);
});

test("rejects invalid product/variant/modifier inputs and unsafe quantities", () => {
  assert.throws(() => addCartLine([], { ...base, productId: " " }), CartInputError);
  assert.throws(() => addCartLine([], { ...base, variantId: "" }), CartInputError);
  assert.throws(() => addCartLine([], { ...base, modifierIds: [""] }), CartInputError);
  assert.throws(() => addCartLine([], base, 1.5), CartInputError);
  assert.throws(() => addCartLine([], base, 100), CartInputError);
});

test("checkout payload contains IDs and quantities, never frontend prices", () => {
  const cart = addCartLine([], base, 3);
  const payload = checkoutCartItems(cart);
  assert.deepEqual(payload, [{ productId: "hotpot-1", variantId: null, modifierIds: ["beef", "tofu"], quantity: 3, pricingMode:"SEPARATE" }]);
  assert.equal(JSON.stringify(payload).includes("price"), false);
  assert.throws(() => checkoutCartItems([]), /EMPTY_CART/);
});

test("tampered persisted cart key is rejected before checkout", () => {
  const cart = addCartLine([], base, 1);
  assert.throws(() => checkoutCartItems([{ ...cart[0], key: "wrong" }]), /CART_KEY_MISMATCH/);
});
