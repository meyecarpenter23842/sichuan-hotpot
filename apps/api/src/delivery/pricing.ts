import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { DeliveryCartItem } from "./delivery-quote.service";

export const productSelect = {
  id: true, name: true, isAvailable: true, priceVnd: true,
  variants: { select: { id: true, name: true, priceDeltaVnd: true, isAvailable: true } },
  modifierGroups: {
    select: {
      name: true, minSelect: true, maxSelect: true, isAvailable: true, branchId: true,
      options: { select: { id: true, name: true, priceDeltaVnd: true, isAvailable: true } },
    },
  },
  modifierAssignments: {
    select: { group: { select: {
      name: true, minSelect: true, maxSelect: true, isAvailable: true,
      options: { select: { id: true, name: true, priceDeltaVnd: true, isAvailable: true } },
    } } },
  },
} as const satisfies Prisma.ProductSelect;

export type PricedCatalogProduct = Prisma.ProductGetPayload<{ select: typeof productSelect }>;
export interface PricedOrderLine {
  readonly productId: string;
  readonly productName: string;
  readonly variantName: string | null;
  readonly quantity: number;
  readonly unitPriceVnd: number;
  readonly lineTotalVnd: number;
  readonly modifiers: readonly { readonly name: string; readonly priceVnd: number }[];
}
export interface PricedCart {
  readonly subtotalVnd: number;
  readonly lines: readonly PricedOrderLine[];
}
function amount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UnprocessableEntityException("INVALID_CATALOG_PRICE");
  }
  return value;
}

/** Pure authoritative pricing shared by quote and transactional checkout. */
export function priceCart(
  items: readonly DeliveryCartItem[], products: readonly PricedCatalogProduct[],
): PricedCart {
  if (items.length === 0 || items.length > 100) throw new BadRequestException("INVALID_CART");
  const catalog = new Map(products.map(product => [product.id, product]));
  const lines: PricedOrderLine[] = [];
  let subtotalVnd = 0;
  for (const item of items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
      || !Array.isArray(item.modifierIds) || item.modifierIds.length > 30
      || new Set(item.modifierIds).size !== item.modifierIds.length) {
      throw new BadRequestException("INVALID_CART_LINE");
    }
    const product = catalog.get(item.productId);
    if (!product || !product.isAvailable) throw new UnprocessableEntityException("PRODUCT_UNAVAILABLE");
    let unit = amount(product.priceVnd);
    let variantName: string | null = null;
    if (item.variantId !== null) {
      const variant = product.variants.find(v => v.id === item.variantId);
      if (!variant || !variant.isAvailable) throw new UnprocessableEntityException("VARIANT_UNAVAILABLE");
      unit += variant.priceDeltaVnd;
      variantName = variant.name;
    }
    const selected = new Set(item.modifierIds);
    const known = new Set<string>();
    const modifiers: { name: string; priceVnd: number }[] = [];
    const groups = [...new Map([
      ...product.modifierGroups.filter(group => group.branchId == null)
        .map(group => [group.name + ":" + group.options.map(o => o.id).join(","), group] as const),
      ...(product.modifierAssignments ?? []).map(assignment => {
        const group = assignment.group;
        return [group.name + ":" + group.options.map(o => o.id).join(","), group] as const;
      }),
    ]).values()].filter(group => group.isAvailable !== false);
    for (const group of groups) {
      const chosen = group.options.filter(option => selected.has(option.id));
      for (const option of group.options) known.add(option.id);
      if (group.minSelect < 0 || group.maxSelect < group.minSelect
        || chosen.length < group.minSelect || chosen.length > group.maxSelect
        || chosen.some(option => !option.isAvailable)) {
        throw new UnprocessableEntityException("INVALID_MODIFIERS");
      }
      for (const option of chosen) {
        unit += option.priceDeltaVnd;
        modifiers.push({ name: option.name, priceVnd: option.priceDeltaVnd });
      }
    }
    if (item.modifierIds.some(id => !known.has(id))) {
      throw new UnprocessableEntityException("INVALID_MODIFIERS");
    }
    const lineTotalVnd = amount(amount(unit) * item.quantity);
    subtotalVnd = amount(subtotalVnd + lineTotalVnd);
    lines.push({
      productId: product.id, productName: product.name, variantName,
      quantity: item.quantity, unitPriceVnd: unit, lineTotalVnd, modifiers,
    });
  }
  if (subtotalVnd === 0) throw new UnprocessableEntityException("INVALID_CATALOG_PRICE");
  return { subtotalVnd, lines };
}
