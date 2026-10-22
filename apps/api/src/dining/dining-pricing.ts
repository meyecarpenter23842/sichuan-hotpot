import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { priceCart, productSelect, type PricedOrderLine } from "../delivery/pricing";

export type DiningItemForPricing = {
  productId: string; standaloneTopping?: boolean;
  variantId?: string | null; modifierIds: string[];
  comboOptionIds?: string[]; quantity: number;
};
export type DiningPricedLine = Omit<PricedOrderLine, "productId"> & {
  productId: string | null; standaloneToppingOptionId?: string;
};

/** Authoritative transactional checkout for dishes and opt-in library toppings.
 * A standalone topping is NEVER a fabricated product row: DiningTicketItem.productId
 * is nullable and selectionSnapshot retains the original ModifierOption ID. */
export async function priceDiningItems(
  tx: Prisma.TransactionClient, branchId: string, items: readonly DiningItemForPricing[],
): Promise<{ lines: DiningPricedLine[]; subtotalVnd: number }> {
  if (items.length < 1 || items.length > 100) throw new BadRequestException("INVALID_CART");
  const regular = items.filter(x => x.standaloneTopping !== true);
  const topping = items.filter(x => x.standaloneTopping === true);
  const [products, options] = await Promise.all([
    regular.length ? tx.product.findMany({
      where: { id: { in: [...new Set(regular.map(x => x.productId))] },
        category: { branchId, isPublished: true } },
      select: productSelect,
    }) : Promise.resolve([]),
    topping.length ? tx.modifierOption.findMany({
      where: { id: { in: [...new Set(topping.map(x => x.productId))] },
        isAvailable: true, imageKey: { not: null },
        group: { branchId, isAvailable: true, allowStandalone: true,
          imageKey: { not: null } } },
      select: { id: true, name: true, priceDeltaVnd: true },
    }) : Promise.resolve([]),
  ]);
  // Old/normal product pricing stays exactly in the shared authoritative engine.
  const regularPriced = regular.length ? priceCart(regular.map(x => ({
    productId: x.productId, variantId: x.variantId ?? null,
    modifierIds: x.modifierIds, comboOptionIds: x.comboOptionIds ?? [],
    quantity: x.quantity,
  })), products).lines : [];
  const byId = new Map(options.map(o => [o.id, o]));
  const lines: DiningPricedLine[] = [];
  let regularIndex = 0;
  let subtotalVnd = 0;
  for (const item of items) {
    if (item.standaloneTopping === true) {
      // Restrict toppings to pure lines; never let size/other option IDs
      // bypass group restrictions or piggyback on an addon line.
      if (item.variantId != null || item.modifierIds.length !== 0 ||
          (item.comboOptionIds?.length ?? 0) !== 0 ||
          !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)
        throw new BadRequestException("INVALID_STANDALONE_TOPPING");
      const option = byId.get(item.productId);
      if (!option) throw new UnprocessableEntityException("STANDALONE_TOPPING_UNAVAILABLE");
      const amount = option.priceDeltaVnd * item.quantity;
      if (!Number.isSafeInteger(amount) || amount < 0)
        throw new UnprocessableEntityException("INVALID_CATALOG_PRICE");
      lines.push({
        productId: null, standaloneToppingOptionId: option.id, productName: option.name,
        variantId: null, variantName: null, pricingMode: "LEGACY",
        quantity: item.quantity, unitPriceVnd: option.priceDeltaVnd, lineTotalVnd: amount,
        modifiers: [], comboItems: [],
      });
      subtotalVnd += amount;
    } else {
      const priced = regularPriced[regularIndex++];
      if (!priced) throw new UnprocessableEntityException("PRODUCT_UNAVAILABLE");
      lines.push(priced);
      subtotalVnd += priced.lineTotalVnd;
    }
    if (!Number.isSafeInteger(subtotalVnd) || subtotalVnd > 2_000_000_000)
      throw new UnprocessableEntityException("INVALID_CATALOG_PRICE");
  }
  if (subtotalVnd <= 0) throw new UnprocessableEntityException("INVALID_CATALOG_PRICE");
  return { lines, subtotalVnd };
}
