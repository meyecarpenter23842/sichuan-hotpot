import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";

export interface DeliveryPolicyInput {
  acceptingOrders: boolean;
  baseMeters: number;
  baseFeeVnd: number;
  extraStepMeters: number;
  extraStepFeeVnd: number;
  maxRoadMeters: number;
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
      where: { branchId }, orderBy: { version: "desc" },
    });
  }

  async create(authorization: string | undefined, branchId: string, input: DeliveryPolicyInput) {
    await this.requireOwner(authorization);
    const integer = (n: number, min: number, max: number) =>
      Number.isSafeInteger(n) && n >= min && n <= max;
    if (
      typeof input.acceptingOrders !== "boolean"
      || !integer(input.baseMeters, 0, 100000)
      || !integer(input.baseFeeVnd, 0, 10000000)
      || !integer(input.extraStepMeters, 1, 100000)
      || !integer(input.extraStepFeeVnd, 0, 10000000)
      || !integer(input.maxRoadMeters, 1, 300000)
      || !integer(input.minSubtotalVnd, 0, 1000000000)
      || (input.freeDeliveryAtSubtotalVnd !== null
        && !integer(input.freeDeliveryAtSubtotalVnd, 0, 1000000000))
      || input.baseMeters > input.maxRoadMeters
      || (input.baseFeeVnd + Math.ceil(input.maxRoadMeters / input.extraStepMeters)
        * input.extraStepFeeVnd) > Number.MAX_SAFE_INTEGER
    ) throw new BadRequestException("INVALID_DELIVERY_POLICY");
    try {
      return await this.prisma.database.$transaction(async tx => {
        const branch = await tx.branch.findUnique({
          where: { id: branchId }, select: { id: true },
        });
        if (!branch) throw new NotFoundException("STORE_UNAVAILABLE");
        const previous = await tx.deliveryPolicyVersion.findFirst({
          where: { branchId }, orderBy: { version: "desc" }, select: { version: true },
        });
        // Immutable version: never update old rows/orders in place.
        return tx.deliveryPolicyVersion.create({
          data: { branchId, version: (previous?.version ?? 0) + 1, ...input },
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
