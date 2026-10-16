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
      || item.modifierIds.some(id => typeof id !== "string" || !id.trim())) {
      throw new BadRequestException("INVALID_CART_LINE");
    }
    const product = catalog.get(item.productId);
    if (!product || !product.isAvailable) throw new UnprocessableEntityException("PRODUCT_UNAVAILABLE");
    const separate = item.pricingMode === "SEPARATE";
    const baseUnit = amount(product.priceVnd);
    let dishUnit = baseUnit;
    let variantName: string | null = null;
    if (item.variantId !== null) {
      const variant = product.variants.find(v => v.id === item.variantId);
      if (!variant || !variant.isAvailable) throw new UnprocessableEntityException("VARIANT_UNAVAILABLE");
      dishUnit = amount(dishUnit + variant.priceDeltaVnd);
      variantName = variant.name;
    }
    const selected = new Map<string,number>();
    for (const id of item.modifierIds) selected.set(id, (selected.get(id)??0)+1);
    const known = new Set<string>();
    const modifiers: {name:string;priceVnd:number}[] = [];
    let separateExtras = 0;
    let legacyUnit = dishUnit;
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
      const count = chosen.reduce((sum, option) => sum + (selected.get(option.id)??0), 0);
      if (group.minSelect < 0 || group.maxSelect < group.minSelect
        || count < group.minSelect || count > group.maxSelect
        || chosen.some(option => !option.isAvailable)) {
        throw new UnprocessableEntityException("INVALID_MODIFIERS");
      }
      // Required choices describe how each dish is prepared (e.g. its spice).
      // Optional topping counts are absolute per cart line, independent of the
      // dish counter; raising "lẩu lớn" 1->2 cannot silently double toppings.
      for (const option of chosen) {
        const units=selected.get(option.id)??0;
        const price=amount(option.priceDeltaVnd);
        legacyUnit=amount(legacyUnit+amount(price*units));
        if (separate && group.minSelect>0) {
          separateExtras=amount(separateExtras+amount(price*units*item.quantity));
          modifiers.push({name:option.name,priceVnd:amount(price*units*item.quantity)});
        } else {
          for(let n=0;n<units;n++){
            if(separate)separateExtras=amount(separateExtras+price);
            modifiers.push({name:option.name,priceVnd:price});
          }
        }
      }
    }
    if (item.modifierIds.some(id => !known.has(id))) {
      throw new UnprocessableEntityException("INVALID_MODIFIERS");
    }
    const unitPriceVnd=separate?dishUnit:legacyUnit;
    const lineTotalVnd=separate
      ?amount(amount(dishUnit*item.quantity)+separateExtras)
      :amount(legacyUnit*item.quantity);
    subtotalVnd=amount(subtotalVnd+lineTotalVnd);
    lines.push({
      productId: product.id, productName: product.name, variantName,
      quantity: item.quantity, unitPriceVnd, lineTotalVnd, modifiers,
    });
  }
  if (subtotalVnd === 0) throw new UnprocessableEntityException("INVALID_CATALOG_PRICE");
  return { subtotalVnd, lines };
}
