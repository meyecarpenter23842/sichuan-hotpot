import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { DeliveryCartItem } from "./delivery-quote.service";

export const productSelect = {
  id: true, name: true, kind: true, isAvailable: true, priceVnd: true,
  comboFixedItems: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { sortOrder: true, quantity: true,
      variant: { select: { id: true, productId: true, name: true, isAvailable: true } },
      childProduct: { select: { id: true, name: true, kind: true, isAvailable: true } } },
  },
  comboGroups: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true, name: true, minSelect: true, maxSelect: true, sortOrder: true,
      options: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, quantity: true, priceDeltaVnd: true, sortOrder: true,
          variant: { select: { id: true, productId: true, name: true, isAvailable: true } },
          childProduct: { select: { id: true, name: true, kind: true, isAvailable: true } } },
      },
    },
  },
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
  readonly variantId: string | null;
  readonly variantName: string | null;
  readonly pricingMode: "LEGACY" | "SEPARATE";
  readonly quantity: number;
  readonly unitPriceVnd: number;
  readonly lineTotalVnd: number;
  readonly modifiers: readonly {
    readonly optionId: string; readonly name: string; readonly priceVnd: number;
  }[];
  readonly comboItems: readonly {
    readonly productId: string; readonly variantId: string | null;
    readonly kind: "FIXED" | "CHOICE"; readonly groupName: string | null;
    readonly productName: string; readonly variantName: string | null;
    readonly quantity: number; readonly priceDeltaVnd: number; readonly sortOrder: number;
  }[];
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
    const comboOptionIds = item.comboOptionIds ?? [];
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
      || !Array.isArray(item.modifierIds) || item.modifierIds.length > 30
      || item.modifierIds.some(id => typeof id !== "string" || !id.trim())
      || !Array.isArray(comboOptionIds) || comboOptionIds.length > 30
      || comboOptionIds.some(id => typeof id !== "string" || !id.trim())) {
      throw new BadRequestException("INVALID_CART_LINE");
    }
    const product = catalog.get(item.productId);
    if (!product || !product.isAvailable) throw new UnprocessableEntityException("PRODUCT_UNAVAILABLE");
    const separate = item.pricingMode === "SEPARATE";
    const baseUnit = amount(product.priceVnd);
    let dishUnit = baseUnit;
    const comboItems: {
      productId: string; variantId: string | null; kind: "FIXED" | "CHOICE";
      groupName: string | null; productName: string; variantName: string | null;
      quantity: number; priceDeltaVnd: number; sortOrder: number;
    }[] = [];

    const productKind = product.kind ?? "STANDARD";
    if (productKind === "STANDARD") {
      if (comboOptionIds.length) {
        throw new UnprocessableEntityException("INVALID_COMBO_SELECTION");
      }
    } else {
      if (product.comboFixedItems.length === 0 && product.comboGroups.length === 0) {
        throw new UnprocessableEntityException("COMBO_NOT_CONFIGURED");
      }
      for (const fixed of product.comboFixedItems) {
        if (fixed.quantity < 1 || fixed.quantity > 99
          || fixed.childProduct.kind !== "STANDARD" || !fixed.childProduct.isAvailable
          || (fixed.variant != null
            && (fixed.variant.productId !== fixed.childProduct.id || !fixed.variant.isAvailable))) {
          throw new UnprocessableEntityException("COMBO_COMPONENT_UNAVAILABLE");
        }
        comboItems.push({
          productId: fixed.childProduct.id, variantId: fixed.variant?.id ?? null,
          kind: "FIXED", groupName: null, productName: fixed.childProduct.name,
          variantName: fixed.variant?.name ?? null, quantity: fixed.quantity,
          priceDeltaVnd: 0, sortOrder: fixed.sortOrder,
        });
      }

      const selectedCombo = new Map<string, number>();
      for (const id of comboOptionIds) {
        selectedCombo.set(id, (selectedCombo.get(id) ?? 0) + 1);
      }
      const knownCombo = new Set<string>();
      for (const group of product.comboGroups) {
        for (const option of group.options) knownCombo.add(option.id);
        const chosen = group.options.filter(option => selectedCombo.has(option.id));
        const count = chosen.reduce((sum, option) => sum + (selectedCombo.get(option.id) ?? 0), 0);
        if (group.minSelect < 0 || group.maxSelect < group.minSelect || group.maxSelect > 30
          || count < group.minSelect || count > group.maxSelect) {
          throw new UnprocessableEntityException("INVALID_COMBO_SELECTION");
        }
        for (const option of chosen) {
          const units = selectedCombo.get(option.id) ?? 0;
          if (units < 1 || option.quantity < 1 || option.quantity > 99
            || option.childProduct.kind !== "STANDARD" || !option.childProduct.isAvailable
            || (option.variant != null
              && (option.variant.productId !== option.childProduct.id || !option.variant.isAvailable))) {
            throw new UnprocessableEntityException("COMBO_COMPONENT_UNAVAILABLE");
          }
          const delta = amount(option.priceDeltaVnd);
          dishUnit = amount(dishUnit + amount(delta * units));
          comboItems.push({
            productId: option.childProduct.id, variantId: option.variant?.id ?? null,
            kind: "CHOICE", groupName: group.name, productName: option.childProduct.name,
            variantName: option.variant?.name ?? null, quantity: option.quantity * units,
            priceDeltaVnd: delta * units,
            sortOrder: group.sortOrder * 1000 + option.sortOrder,
          });
        }
      }
      if (comboOptionIds.some(id => !knownCombo.has(id))) {
        throw new UnprocessableEntityException("INVALID_COMBO_SELECTION");
      }
    }
    let variantId: string | null = null;
    let variantName: string | null = null;
    if (item.variantId !== null) {
      const variant = product.variants.find(v => v.id === item.variantId);
      if (!variant || !variant.isAvailable) throw new UnprocessableEntityException("VARIANT_UNAVAILABLE");
      dishUnit = amount(dishUnit + variant.priceDeltaVnd);
      variantId = variant.id;
      variantName = variant.name;
    }
    const selected = new Map<string,number>();
    for (const id of item.modifierIds) selected.set(id, (selected.get(id)??0)+1);
    const known = new Set<string>();
    const modifiers: {optionId:string;name:string;priceVnd:number}[] = [];
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
          modifiers.push({optionId:option.id,name:option.name,
            priceVnd:amount(price*units*item.quantity)});
        } else {
          for(let n=0;n<units;n++){
            if(separate)separateExtras=amount(separateExtras+price);
            modifiers.push({optionId:option.id,name:option.name,priceVnd:price});
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
      productId: product.id, productName: product.name, variantId, variantName,
      pricingMode: separate ? "SEPARATE" : "LEGACY",
      quantity: item.quantity, unitPriceVnd, lineTotalVnd, modifiers, comboItems,
    });
  }
  if (subtotalVnd === 0) throw new UnprocessableEntityException("INVALID_CATALOG_PRICE");
  return { subtotalVnd, lines };
}
