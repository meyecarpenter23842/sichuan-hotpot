/**
 * Client-side cart state only. Never use any displayed price as an order total:
 * the API must re-fetch product, variant and modifier prices at checkout.
 */
export interface CartSelection {
  readonly productId: string;
  readonly variantId: string | null;
  readonly modifierIds: readonly string[];
}
export interface CartLine {
  readonly key: string;
  readonly selection: CartSelection;
  readonly quantity: number;
}

export class CartInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartInputError";
  }
}

const MAX_QUANTITY = 99;
const MAX_LINES = 100;

function nonempty(value: string, field: string): string {
  const clean = value.trim();
  if (!clean || clean.length > 128) throw new CartInputError("INVALID_" + field);
  return clean;
}

function validQuantity(value: number, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_QUANTITY) {
    throw new CartInputError("INVALID_QUANTITY");
  }
  return value;
}

/** Identity is based on IDs, never labels or client-calculated monetary values. */
export function normalizeCartSelection(selection: CartSelection): CartSelection {
  const productId = nonempty(selection.productId, "PRODUCT");
  const variantId = selection.variantId === null ? null : nonempty(selection.variantId, "VARIANT");
  if (selection.modifierIds.length > 30) throw new CartInputError("TOO_MANY_MODIFIERS");
  // Repeated IDs represent counts of the same topping on ONE portion.
  // Preserve multiplicity throughout cart, quote and checkout. Sorting keeps
  // the cart key stable regardless of the order toppings were added.
  const modifierIds = selection.modifierIds.map(id => nonempty(id, "MODIFIER")).sort();
  return { productId, variantId, modifierIds };
}

export function cartLineKey(selection: CartSelection): string {
  const clean = normalizeCartSelection(selection);
  return JSON.stringify([clean.productId, clean.variantId, clean.modifierIds]);
}

export function addCartLine(
  cart: readonly CartLine[], selection: CartSelection, quantity = 1,
): CartLine[] {
  validQuantity(quantity);
  const normalized = normalizeCartSelection(selection);
  const key = cartLineKey(normalized);
  const existing = cart.find(line => line.key === key);
  if (!existing && cart.length >= MAX_LINES) throw new CartInputError("CART_FULL");
  if (existing && existing.quantity + quantity > MAX_QUANTITY) {
    throw new CartInputError("INVALID_QUANTITY");
  }
  if (existing) {
    return cart.map(line => line.key === key
      ? { ...line, quantity: line.quantity + quantity }
      : line);
  }
  return [...cart, { key, selection: normalized, quantity }];
}

export function setCartQuantity(cart: readonly CartLine[], key: string, quantity: number): CartLine[] {
  validQuantity(quantity, true);
  if (quantity === 0) return cart.filter(line => line.key !== key);
  if (!cart.some(line => line.key === key)) throw new CartInputError("CART_LINE_NOT_FOUND");
  return cart.map(line => line.key === key ? { ...line, quantity } : line);
}

/** Count a topping on a single portion, not the number of whole dishes. */
export function cartModifierCount(selection: CartSelection, modifierId: string): number {
  return selection.modifierIds.filter(id => id === modifierId).length;
}

/** Change topping quantity immutably. Identity changes with the selection;
 * merge two equivalent cart lines safely without losing quantities. The caller
 * must validate group min/max on the current catalog before invoking this.
 */
export function setCartModifierQuantity(
  cart: readonly CartLine[], key: string, modifierId: string, count: number,
): CartLine[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > 30) {
    throw new CartInputError("INVALID_MODIFIER_QUANTITY");
  }
  const current = cart.find(line => line.key === key);
  if (!current) throw new CartInputError("CART_LINE_NOT_FOUND");
  const id = nonempty(modifierId, "MODIFIER");
  const remaining = current.selection.modifierIds.filter(option => option !== id);
  if (remaining.length + count > 30) throw new CartInputError("TOO_MANY_MODIFIERS");
  const selection = normalizeCartSelection({
    ...current.selection,
    modifierIds: [...remaining, ...Array(count).fill(id)],
  });
  const nextKey = cartLineKey(selection);
  const existing = cart.find(line => line.key === nextKey && line.key !== key);
  if (existing && existing.quantity + current.quantity > MAX_QUANTITY) {
    throw new CartInputError("INVALID_QUANTITY");
  }
  return cart.flatMap(line => {
    if (line.key === key) return existing ? [] : [{ ...current, key: nextKey, selection }];
    if (existing && line.key === nextKey) {
      return [{ ...line, quantity: line.quantity + current.quantity }];
    }
    return [line];
  });
}

export function cartItemCount(cart: readonly CartLine[]): number {
  return cart.reduce((sum, line) => sum + line.quantity, 0);
}

/** This payload does not contain prices; the server owns the price authority. */
export function checkoutCartItems(cart: readonly CartLine[]): {
  productId: string;
  variantId: string | null;
  modifierIds: string[];
  quantity: number;
}[] {
  if (cart.length === 0) throw new CartInputError("EMPTY_CART");
  return cart.map(line => {
    validQuantity(line.quantity);
    const selection = normalizeCartSelection(line.selection);
    if (cartLineKey(selection) !== line.key) throw new CartInputError("CART_KEY_MISMATCH");
    return {
      productId: selection.productId,
      variantId: selection.variantId,
      modifierIds: [...selection.modifierIds],
      quantity: line.quantity,
    };
  });
}
