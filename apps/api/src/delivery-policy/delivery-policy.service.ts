import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { ADMIN_CATALOG_VERSION, provinceByCode, wardByCode,
  isWardAllowedForNewDelivery } from "@hotpot/shared";

export interface DeliveryZoneInput {
  name: string;
  provinceCode: string;
  catalogVersion: string;
  wardCodes: string[];
  feeVnd: number;
  isActive: boolean;
}
export interface DeliveryPolicyInput {
  pricingMode?: "DISTANCE" | "ZONE";
  zones?: DeliveryZoneInput[];
  acceptingOrders: boolean;
  baseMeters?: number;
  baseFeeVnd?: number;
  extraStepMeters?: number;
  extraStepFeeVnd?: number;
  maxRoadMeters?: number;
  minSubtotalVnd: number;
  freeDeliveryAtSubtotalVnd: number | null;
}

@Injectable()
export class DeliveryPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private async requireOwner(authorization: string | undefined): Promise<void> {
    const principal = await this.auth.principal(authorization);
    // MANAGER can operate branch orders, but only OWNER changes pricing.
    if (principal.role !== "OWNER") throw new ForbiddenException("OWNER_REQUIRED");
  }

  async current(authorization: string | undefined, branchId: string) {
    await this.requireOwner(authorization);
    const branch = await this.prisma.database.branch.findUnique({
      where: { id: branchId }, select: { id: true },
    });
    if (!branch) throw new NotFoundException("STORE_UNAVAILABLE");
    return this.prisma.database.deliveryPolicyVersion.findFirst({
      where: { branchId }, orderBy: { version: "desc" }, include: { zones: true },
    });
  }

  async create(authorization: string | undefined, branchId: string, input: DeliveryPolicyInput) {
    await this.requireOwner(authorization);
    const integer = (n: number | undefined, min: number, max: number) =>
      typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
    const mode = input.pricingMode ?? "DISTANCE";
    if (!["DISTANCE", "ZONE"].includes(mode)
      || typeof input.acceptingOrders !== "boolean"
      || !integer(input.minSubtotalVnd, 0, 1000000000)
      || (input.freeDeliveryAtSubtotalVnd !== null
        && !integer(input.freeDeliveryAtSubtotalVnd, 0, 1000000000))) {
      throw new BadRequestException("INVALID_DELIVERY_POLICY");
    }
    if (mode === "ZONE") {
      if (!Array.isArray(input.zones) || input.zones.length < 1 || input.zones.length > 100) {
        throw new BadRequestException("ZONE_RATE_MISSING");
      }
      const wardKeys = new Set<string>(), provinceDefaults = new Set<string>();
      for (const zone of input.zones) {
        if (!zone || typeof zone.name !== "string" || !zone.name.trim()
          || zone.name.length > 160 || zone.catalogVersion !== ADMIN_CATALOG_VERSION
          || !provinceByCode(zone.provinceCode)
          || !integer(zone.feeVnd, 0, 10000000) || typeof zone.isActive !== "boolean"
          || !Array.isArray(zone.wardCodes) || zone.wardCodes.length > 300
          || zone.wardCodes.some(code => typeof code !== "string"
            || wardByCode(code)?.provinceCode !== zone.provinceCode
            || !isWardAllowedForNewDelivery(zone.provinceCode, code))) {
          throw new BadRequestException("INVALID_DELIVERY_ZONE");
        }
        const prefix = zone.catalogVersion + ":" + zone.provinceCode + ":";
        if (zone.wardCodes.length === 0) {
          if (provinceDefaults.has(prefix)) throw new BadRequestException("ZONE_OVERLAP");
          provinceDefaults.add(prefix);
        }
        for (const ward of zone.wardCodes) {
          const key = prefix + ward;
          if (wardKeys.has(key)) throw new BadRequestException("ZONE_OVERLAP");
          wardKeys.add(key);
        }
      }
      if (!input.zones.some(zone => zone.isActive)) throw new BadRequestException("ZONE_RATE_MISSING");
    } else if (
      typeof input.acceptingOrders !== "boolean"
      || !integer(input.baseMeters, 0, 100000)
      || !integer(input.baseFeeVnd, 0, 10000000)
      || !integer(input.extraStepMeters, 1, 100000)
      || !integer(input.extraStepFeeVnd, 0, 10000000)
      || !integer(input.maxRoadMeters, 1, 300000)
      || input.baseMeters! > input.maxRoadMeters!
      || (input.baseFeeVnd! + Math.ceil(input.maxRoadMeters! / input.extraStepMeters!)
        * input.extraStepFeeVnd!) > Number.MAX_SAFE_INTEGER
    ) throw new BadRequestException("INVALID_DELIVERY_POLICY");
    try {
      return await this.prisma.database.$transaction(async tx => {
        const branch = await tx.branch.findUnique({
          where: { id: branchId }, select: { id: true },
        });
        if (!branch) throw new NotFoundException("STORE_UNAVAILABLE");
        const previous = await tx.deliveryPolicyVersion.findFirst({
          where: { branchId }, orderBy: { version: "desc" }, select: { version: true, pricingMode: true },
        });
        // A converted branch must never accidentally reactivate the OSRM pricing path.
        if (previous?.pricingMode === "ZONE" && mode !== "ZONE") {
          throw new BadRequestException("DISTANCE_PRICING_RETIRED");
        }
        // Immutable policy + immutable zone rows; never mutate historical versions.
        return tx.deliveryPolicyVersion.create({
          data: { branchId, version: (previous?.version ?? 0) + 1,
            pricingMode: mode, acceptingOrders: input.acceptingOrders,
            minSubtotalVnd: input.minSubtotalVnd,
            freeDeliveryAtSubtotalVnd: input.freeDeliveryAtSubtotalVnd,
            baseMeters: mode === "ZONE" ? null : input.baseMeters!,
            baseFeeVnd: mode === "ZONE" ? null : input.baseFeeVnd!,
            extraStepMeters: mode === "ZONE" ? null : input.extraStepMeters!,
            extraStepFeeVnd: mode === "ZONE" ? null : input.extraStepFeeVnd!,
            maxRoadMeters: mode === "ZONE" ? null : input.maxRoadMeters!,
            ...(mode === "ZONE" ? { zones: { create: input.zones!.map(zone => ({
              name: zone.name.trim(), provinceCode: zone.provinceCode,
              catalogVersion: zone.catalogVersion, wardCodes: zone.wardCodes,
              feeVnd: zone.feeVnd, isActive: zone.isActive,
            })) } } : {}),
          }, include: { zones: true },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === "P2002" || error.code === "P2034")) {
        throw new ConflictException("POLICY_VERSION_CONFLICT_RETRY");
      }
      throw error;
    }
  }
}
