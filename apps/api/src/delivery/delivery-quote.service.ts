import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from "@nestjs/common";
import { quoteDelivery, DeliveryQuoteError } from "@hotpot/shared";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { RoadRoutingService } from "./road-routing.service";

export interface DeliveryCartItem {
  productId: string;
  variantId: string | null;
  modifierIds: string[];
  quantity: number;
}
export interface QuoteRequest {
  branchId: string;
  addressId: string;
  items: DeliveryCartItem[];
}
function amount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UnprocessableEntityException("INVALID_CATALOG_PRICE");
  }
  return value;
}

/** Every estimate is repriced from DB; the client never supplies a subtotal. */
@Injectable()
export class DeliveryQuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly routes: RoadRoutingService,
  ) {}

  async calculate(authorization: string | undefined, input: QuoteRequest) {
    const principal = await this.auth.principal(authorization);
    if (principal.role !== "CUSTOMER") throw new ForbiddenException("Customer account required");
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
      throw new BadRequestException("INVALID_CART");
    }
    const db = this.prisma.database;
    const [branch, address, policy, products] = await Promise.all([
      db.branch.findFirst({
        where: { id: input.branchId, isActive: true },
        select: { id: true, latitude: true, longitude: true },
      }),
      db.address.findFirst({
        where: { id: input.addressId, userId: principal.id },
        select: { id: true, latitude: true, longitude: true },
      }),
      db.deliveryPolicyVersion.findFirst({
        where: { branchId: input.branchId }, orderBy: { version: "desc" },
      }),
      db.product.findMany({
        where: {
          id: { in: [...new Set(input.items.map(line => line.productId))] },
          category: { is: { branchId: input.branchId } },
        },
        select: {
          id: true, name: true, isAvailable: true, priceVnd: true,
          variants: { select: { id: true, name: true, priceDeltaVnd: true, isAvailable: true } },
          modifierGroups: {
            select: {
              name: true, minSelect: true, maxSelect: true,
              options: { select: { id: true, name: true, priceDeltaVnd: true, isAvailable: true } },
            },
          },
        },
      }),
    ]);
    if (!branch) throw new NotFoundException("STORE_UNAVAILABLE");
    if (!address) throw new NotFoundException("ADDRESS_UNAVAILABLE");
    if (!policy) throw new ServiceUnavailableException("DELIVERY_POLICY_NOT_CONFIGURED");

    const catalog = new Map(products.map(product => [product.id, product]));
    let subtotal = 0;
    for (const item of input.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99
        || !Array.isArray(item.modifierIds) || item.modifierIds.length > 30
        || new Set(item.modifierIds).size !== item.modifierIds.length) {
        throw new BadRequestException("INVALID_CART_LINE");
      }
      const product = catalog.get(item.productId);
      if (!product || !product.isAvailable) throw new UnprocessableEntityException("PRODUCT_UNAVAILABLE");
      let unit = amount(product.priceVnd);
      if (item.variantId !== null) {
        const variant = product.variants.find(v => v.id === item.variantId);
        if (!variant || !variant.isAvailable) throw new UnprocessableEntityException("VARIANT_UNAVAILABLE");
        unit += variant.priceDeltaVnd;
      }
      const selected = new Set(item.modifierIds);
      const known = new Set<string>();
      for (const group of product.modifierGroups) {
        const chosen = group.options.filter(option => selected.has(option.id));
        for (const option of group.options) known.add(option.id);
        if (chosen.length < group.minSelect || chosen.length > group.maxSelect
          || chosen.some(option => !option.isAvailable)) {
          throw new UnprocessableEntityException("INVALID_MODIFIERS");
        }
        for (const option of chosen) unit += option.priceDeltaVnd;
      }
      if (item.modifierIds.some(id => !known.has(id))) {
        throw new UnprocessableEntityException("INVALID_MODIFIERS");
      }
      subtotal = amount(subtotal + amount(unit) * item.quantity);
    }
    if (subtotal === 0) throw new UnprocessableEntityException("INVALID_CATALOG_PRICE");
    const location = (p: { latitude: { toString(): string }; longitude: { toString(): string } }) => ({
      latitude: Number(p.latitude.toString()), longitude: Number(p.longitude.toString()),
    });
    // Route cannot be skipped or replaced by a straight-line distance.
    const roadDistanceMeters = await this.routes.drivingMeters(location(branch), location(address));
    try {
      const quote = quoteDelivery(subtotal, roadDistanceMeters, {
        versionId: policy.id, acceptingOrders: policy.acceptingOrders,
        baseMeters: policy.baseMeters, baseFeeVnd: policy.baseFeeVnd,
        extraStepMeters: policy.extraStepMeters, extraStepFeeVnd: policy.extraStepFeeVnd,
        maxRoadMeters: policy.maxRoadMeters, minSubtotalVnd: policy.minSubtotalVnd,
        freeDeliveryAtSubtotalVnd: policy.freeDeliveryAtSubtotalVnd,
      });
      return {
        branchId: branch.id, addressId: address.id, ...quote,
        quoteExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      };
    } catch (error) {
      if (error instanceof DeliveryQuoteError) {
        throw new UnprocessableEntityException({ code: error.code });
      }
      throw error;
    }
  }
}
