import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
  ServiceUnavailableException, UnprocessableEntityException,
} from "@nestjs/common";
import { quoteDelivery, quoteZoneDelivery, DeliveryQuoteError, validateAdministrativeSelection } from "@hotpot/shared";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { RoadRoutingService } from "./road-routing.service";
import { priceCart, productSelect } from "./pricing";

export interface DeliveryCartItem {
  productId: string;
  variantId: string | null;
  modifierIds: string[];
  comboOptionIds?: string[];
  quantity: number;
  pricingMode?: "SEPARATE";
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
        where: { id: input.branchId },
        select: { id: true, isActive: true, latitude: true, longitude: true },
      }),
      db.address.findFirst({
        where: { id: input.addressId, userId: principal.id },
        select: { id: true, latitude: true, longitude: true,
          catalogVersion: true, provinceCode: true, wardCode: true },
      }),
      db.deliveryPolicyVersion.findFirst({
        where: { branchId: input.branchId }, orderBy: { version: "desc" },
      }),
      db.product.findMany({
        where: {
          id: { in: [...new Set(input.items.map(line => line.productId))] },
          category: { is: { branchId: input.branchId } },
        },
        select: productSelect,
      }),
    ]);
    if (!branch) throw new NotFoundException("STORE_UNAVAILABLE");
    if (!branch.isActive) throw new UnprocessableEntityException({ code: "STORE_CLOSED" });
    if (!address) throw new NotFoundException("ADDRESS_UNAVAILABLE");
    if (!policy) throw new ServiceUnavailableException("DELIVERY_POLICY_NOT_CONFIGURED");
    if (!policy.acceptingOrders) throw new UnprocessableEntityException({ code: "STORE_CLOSED" });

    const { subtotalVnd: subtotal } = priceCart(input.items, products);
    if (policy.pricingMode === "ZONE") {
      if (!validateAdministrativeSelection(address)) {
        throw new UnprocessableEntityException({ code: "ADDRESS_REGION_UNCONFIRMED" });
      }
      try {
        const zones = await db.deliveryZone.findMany({ where: { policyVersionId: policy.id } });
        const priced = quoteZoneDelivery(subtotal, address, zones, {
          versionId: policy.id, acceptingOrders: policy.acceptingOrders,
          minSubtotalVnd: policy.minSubtotalVnd,
          freeDeliveryAtSubtotalVnd: policy.freeDeliveryAtSubtotalVnd,
        });
        return { branchId: branch.id, addressId: address.id, ...priced,
          quoteExpiresAt: new Date(Date.now() + 120_000).toISOString() };
      } catch (error) {
        if (error instanceof DeliveryQuoteError) {
          throw new UnprocessableEntityException({ code: error.code });
        }
        throw error;
      }
    }
    const location = (p: { latitude: { toString(): string }; longitude: { toString(): string } }) => ({
      latitude: Number(p.latitude.toString()), longitude: Number(p.longitude.toString()),
    });
    // Route cannot be skipped or replaced by a straight-line distance.
    const roadDistanceMeters = await this.routes.drivingMeters(location(branch), location(address));
    try {
      const quote = quoteDelivery(subtotal, roadDistanceMeters, {
        versionId: policy.id, acceptingOrders: policy.acceptingOrders,
        baseMeters: policy.baseMeters ?? -1, baseFeeVnd: policy.baseFeeVnd ?? -1,
        extraStepMeters: policy.extraStepMeters ?? -1, extraStepFeeVnd: policy.extraStepFeeVnd ?? -1,
        maxRoadMeters: policy.maxRoadMeters ?? -1, minSubtotalVnd: policy.minSubtotalVnd,
        freeDeliveryAtSubtotalVnd: policy.freeDeliveryAtSubtotalVnd,
      });
      return {
        branchId: branch.id, addressId: address.id, ...quote,
        pricingMode: "DISTANCE" as const,
        zoneId: null, zoneName: null, provinceCode: null, wardCode: null, catalogVersion: null,
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
