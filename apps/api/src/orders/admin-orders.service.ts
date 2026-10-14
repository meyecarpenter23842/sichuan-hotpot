import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma, type OrderStatus, type Role } from "@prisma/client";
import { assertOrderTransition, OrderTransitionError } from "@hotpot/shared";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";

const operatingRoles = ["OWNER", "MANAGER", "KITCHEN"] as const;
type OperationalRole = (typeof operatingRoles)[number];
const allowedTargets = ["CONFIRMED", "CANCELED", "PREPARING", "READY"] as const;
type TargetStatus = (typeof allowedTargets)[number];
const selectOrder = {
  id: true, branchId: true, status: true, createdAt: true, updatedAt: true,
  subtotalVnd: true, deliveryFeeVnd: true, totalVnd: true,
  payment: { select: { method: true, status: true } },
  items: { select: {
    productName: true, variantName: true, quantity: true, unitPriceVnd: true,
    lineTotalVnd: true,
    modifiers: { select: { name: true, priceVnd: true } },
  } },
} as const satisfies Prisma.OrderSelect;
const kitchenOrderSelect = {
  id: true, branchId: true, status: true, createdAt: true, updatedAt: true,
  items: { select: { productName: true, variantName: true, quantity: true,
    modifiers: { select: { name: true } } } },
} as const satisfies Prisma.OrderSelect;

@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  private async role(authorization: string | undefined, branchId: string): Promise<{
    actorId: string; role: OperationalRole;
  }> {
    const principal = await this.auth.principal(authorization);
    const branch = await this.prisma.database.branch.findUnique({
      where: { id: branchId }, select: { id: true },
    });
    if (!branch) throw new NotFoundException("BRANCH_NOT_FOUND");
    if (principal.role === "OWNER") return { actorId: principal.id, role: "OWNER" };
    const member = await this.prisma.database.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId: principal.id } },
      select: { role: true },
    });
    if (!member || !operatingRoles.includes(member.role as OperationalRole)) {
      throw new ForbiddenException("BRANCH_OPERATIONS_FORBIDDEN");
    }
    return { actorId: principal.id, role: member.role as OperationalRole };
  }

  async branches(authorization: string | undefined) {
    const principal = await this.auth.principal(authorization);
    if (principal.role === "OWNER") {
      const rows = await this.prisma.database.branch.findMany({
        select: { id: true, code: true, name: true, address: true,
          latitude: true, longitude: true, isActive: true },
        orderBy: { name: "asc" },
      });
      return rows.map(row => ({ ...row, staffRole: "OWNER" as const }));
    }
    const memberships = await this.prisma.database.branchMember.findMany({
      where: { userId: principal.id, role: { in: [...operatingRoles] } },
      select: { role: true, branch: { select: { id: true, code: true, name: true,
        address: true, latitude: true, longitude: true, isActive: true } } },
        orderBy: { branch: { name: "asc" } },
    });
    return memberships.map(({ branch, role }) => ({ ...branch, staffRole: role }));
  }

  async list(authorization: string | undefined, branchId: string, status?: OrderStatus) {
    const staff = await this.role(authorization, branchId);
    return this.prisma.database.order.findMany({
      where: { branchId, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100, select: staff.role === "KITCHEN" ? kitchenOrderSelect : selectOrder,
    });
  }

  async detail(authorization: string | undefined, branchId: string, orderId: string) {
    const staff = await this.role(authorization, branchId);
    const record = await this.prisma.database.order.findFirst({
      where: { id: orderId, branchId }, select: {
        ...(staff.role === "KITCHEN" ? kitchenOrderSelect : selectOrder), statusHistory: { orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { fromStatus: true, toStatus: true, reason: true, createdAt: true } },
        ...(staff.role === "KITCHEN" ? {} : {
          phoneSnapshot: true, addressLineSnapshot: true, roadDistanceMeters: true,
        }),
      },
    });
    if (!record) throw new NotFoundException("ORDER_NOT_FOUND");
    return record;
  }

  async transition(authorization: string | undefined, branchId: string, orderId: string,
    input: { expectedStatus: OrderStatus; toStatus: TargetStatus; reason?: string }) {
    const actor = await this.role(authorization, branchId);
    if (!allowedTargets.includes(input.toStatus)) {
      throw new BadRequestException("ORDER_STATUS_NOT_SUPPORTED");
    }
    const reason = input.reason?.trim() || null;
    if (input.toStatus === "CANCELED" && (!reason || reason.length < 5)) {
      throw new BadRequestException("CANCEL_REASON_REQUIRED");
    }
    try {
      return await this.prisma.database.$transaction(async tx => {
        const order = await tx.order.findFirst({
          where: { id: orderId, branchId }, select: { status: true },
        });
        if (!order) throw new NotFoundException("ORDER_NOT_FOUND");
        if (order.status !== input.expectedStatus) {
          throw new ConflictException("ORDER_CHANGED_REFRESH");
        }
        try {
          assertOrderTransition({ from: order.status, to: input.toStatus,
            role: actor.role as Role, isAssignedDriver: false });
        } catch (error) {
          if (error instanceof OrderTransitionError) {
            throw new ConflictException("INVALID_ORDER_TRANSITION");
          }
          throw error;
        }
        // Atomic compare-and-set: two staff cannot both accept one pending order.
        const updated = await tx.order.updateMany({
          where: { id: orderId, branchId, status: input.expectedStatus },
          data: { status: input.toStatus },
        });
        if (updated.count !== 1) throw new ConflictException("ORDER_CHANGED_REFRESH");
        await tx.orderStatusHistory.create({
          data: { orderId, actorId: actor.actorId, fromStatus: order.status,
            toStatus: input.toStatus, reason },
        });
        return { id: orderId, fromStatus: order.status, status: input.toStatus };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("ORDER_CHANGED_REFRESH");
      }
      throw error;
    }
  }
}
