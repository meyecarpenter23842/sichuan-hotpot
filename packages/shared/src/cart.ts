/**
 * Client-side cart state only. Never use any displayed price as an order total:
 * the API must re-fetch product, variant and modifier prices at checkout.
 */
export interface CartSelection {
  readonly productId: string;
  readonly variantId: string | null;
  readonly modifierIds: readonly string[];
  /** Nondefault count per selected topping; missing entries mean one per dish. */
  readonly modifierQuantities?: readonly { readonly id: string; readonly quantity: number }[];
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
  const modifierIds = [...new Set(selection.modifierIds.map(id => nonempty(id, "MODIFIER")))].sort();
  const counts = selection.modifierQuantities ?? [];
  if (!Array.isArray(counts) || counts.length > 30) throw new CartInputError("INVALID_TOPPING_QUANTITY");
  const seen = new Set<string>();
  const modifierQuantities = counts.map(row => {
    if (!row || typeof row !== "object") throw new CartInputError("INVALID_TOPPING_QUANTITY");
    const id = nonempty(row.id, "MODIFIER");
    if (seen.has(id) || !modifierIds.includes(id) || !Number.isSafeInteger(row.quantity)
      || row.quantity < 1 || row.quantity > 20) throw new CartInputError("INVALID_TOPPING_QUANTITY");
    seen.add(id);
    return { id, quantity: row.quantity };
  }).filter(row => row.quantity !== 1).sort((a,b) => a.id.localeCompare(b.id));
  return { productId, variantId, modifierIds,
    ...(modifierQuantities.length ? { modifierQuantities } : {}) };
}

export function cartLineKey(selection: CartSelection): string {
  const clean = normalizeCartSelection(selection);
  return JSON.stringify([clean.productId, clean.variantId, clean.modifierIds,
    ...(clean.modifierQuantities?.length ? [clean.modifierQuantities] : [])]);
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

/** Edit one topping count for a cart line; never change another dish or its toppings. */
export function setCartToppingQuantity(
  cart: readonly CartLine[], key: string, toppingId: string, quantity: number,
): CartLine[] {
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 20)
    throw new CartInputError("INVALID_TOPPING_QUANTITY");
  const line = cart.find(item => item.key === key);
  if (!line) throw new CartInputError("CART_LINE_NOT_FOUND");
  if (!line.selection.modifierIds.includes(toppingId))
    throw new CartInputError("TOPPING_NOT_SELECTED");
  const selection = normalizeCartSelection(line.selection);
  const nextIds = quantity === 0
    ? selection.modifierIds.filter(id => id !== toppingId) : [...selection.modifierIds];
  const nextCounts = (selection.modifierQuantities ?? [])
    .filter(row => row.id !== toppingId);
  if (quantity > 1) nextCounts.push({ id:toppingId, quantity });
  const next = normalizeCartSelection({ ...selection, modifierIds:nextIds,
    modifierQuantities: nextCounts });
  const without = cart.filter(item => item.key !== key);
  return addCartLine(without, next, line.quantity);
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
  modifierQuantities?: { id: string; quantity: number }[];
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
      ...(selection.modifierQuantities?.length ? { modifierQuantities:
        selection.modifierQuantities.map(({id,quantity}) => ({id,quantity})) } : {}),
      quantity: line.quantity,
    };
  });
}
