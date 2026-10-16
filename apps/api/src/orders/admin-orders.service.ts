import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma, type OrderStatus, type Role } from "@prisma/client";
import { assertOrderTransition, OrderTransitionError } from "@hotpot/shared";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import type { DeliveryCartItem } from "../delivery/delivery-quote.service";
import { priceCart, productSelect } from "../delivery/pricing";
import { OrderRealtimeService } from "./order-realtime.service";

const operatingRoles = ["OWNER", "MANAGER", "KITCHEN"] as const;
type OperationalRole = (typeof operatingRoles)[number];
const allowedTargets = [
  "CONFIRMED", "CANCELED", "PREPARING", "READY",
  "DELIVERING", "DELIVERED", "DELIVERY_FAILED",
] as const;
type TargetStatus = (typeof allowedTargets)[number];

const selectOrder = {
  id: true, branchId: true, status: true, createdAt: true, updatedAt: true,
  subtotalVnd: true, deliveryFeeVnd: true, totalVnd: true,
  payment: { select: { method: true, status: true, amountVnd: true } },
  items: { select: {
    id: true, productId: true, variantId: true, pricingMode: true,
    productName: true, variantName: true, quantity: true, unitPriceVnd: true,
    lineTotalVnd: true,
    modifiers: { select: { optionId: true, name: true, priceVnd: true } },
    comboItems: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { productId: true, kind: true, groupName: true, productName: true,
        quantity: true, priceDeltaVnd: true, sortOrder: true } },
  } },
} as const satisfies Prisma.OrderSelect;

const kitchenOrderSelect = {
  id: true, branchId: true, status: true, createdAt: true, updatedAt: true,
  items: { select: { productName: true, variantName: true, quantity: true,
    modifiers: { select: { name: true } } } },
} as const satisfies Prisma.OrderSelect;

type EditInput = {
  expectedStatus: "PENDING" | "CONFIRMED";
  expectedUpdatedAt: string;
  reason: string;
  items: DeliveryCartItem[];
};

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly realtime: OrderRealtimeService,
  ) {}

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
          catalogVersion: true, provinceCode: true, wardCode: true,
          latitude: true, longitude: true, isActive: true },
        orderBy: { name: "asc" },
      });
      return rows.map(row => ({ ...row, staffRole: "OWNER" as const }));
    }
    const memberships = await this.prisma.database.branchMember.findMany({
      where: { userId: principal.id, role: { in: [...operatingRoles] } },
      select: { role: true, branch: { select: { id: true, code: true, name: true,
        address: true, catalogVersion: true, provinceCode: true, wardCode: true,
        latitude: true, longitude: true, isActive: true } } },
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
        ...(staff.role === "KITCHEN" ? kitchenOrderSelect : selectOrder),
        statusHistory: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { fromStatus: true, toStatus: true, reason: true, createdAt: true },
        },
        ...(staff.role === "KITCHEN" ? {} : {
          phoneSnapshot: true, addressLineSnapshot: true, roadDistanceMeters: true,
          pricingMode: true, zoneNameSnapshot: true,
          provinceCodeSnapshot: true, wardCodeSnapshot: true,
          catalogVersionSnapshot: true,
          edits: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              reason: true, status: true, beforeSubtotalVnd: true, afterSubtotalVnd: true,
              beforeTotalVnd: true, afterTotalVnd: true, createdAt: true,
            },
          },
        }),
      },
    });
    if (!record) throw new NotFoundException("ORDER_NOT_FOUND");
    return record;
  }

  async transition(
    authorization: string | undefined,
    branchId: string,
    orderId: string,
    input: { expectedStatus: OrderStatus; toStatus: TargetStatus; reason?: string },
  ) {
    const actor = await this.role(authorization, branchId);
    if (!allowedTargets.includes(input.toStatus)) {
      throw new BadRequestException("ORDER_STATUS_NOT_SUPPORTED");
    }
    const reason = input.reason?.trim() || null;
    if (input.toStatus === "CANCELED" && (!reason || reason.length < 5)) {
      throw new BadRequestException("CANCEL_REASON_REQUIRED");
    }
    if (input.toStatus === "DELIVERY_FAILED" && (!reason || reason.length < 5)) {
      throw new BadRequestException("DELIVERY_FAILURE_REASON_REQUIRED");
    }

    try {
      const changed = await this.prisma.database.$transaction(async tx => {
        const order = await tx.order.findFirst({
          where: { id: orderId, branchId },
          select: {
            status: true, customerId: true,
            payment: { select: { id: true, method: true, status: true } },
          },
        });
        if (!order) throw new NotFoundException("ORDER_NOT_FOUND");
        if (order.status !== input.expectedStatus) {
          throw new ConflictException("ORDER_CHANGED_REFRESH");
        }
        try {
          assertOrderTransition({
            from: order.status, to: input.toStatus,
            role: actor.role as Role, isAssignedDriver: false,
          });
        } catch (error) {
          if (error instanceof OrderTransitionError) {
            throw new ConflictException("INVALID_ORDER_TRANSITION");
          }
          throw error;
        }

        const updated = await tx.order.updateMany({
          where: { id: orderId, branchId, status: input.expectedStatus },
          data: { status: input.toStatus },
        });
        if (updated.count !== 1) throw new ConflictException("ORDER_CHANGED_REFRESH");

        if (input.toStatus === "DELIVERED" && order.payment?.method === "COD"
          && order.payment.status === "PENDING") {
          await tx.payment.update({
            where: { id: order.payment.id }, data: { status: "CONFIRMED" },
          });
        }

        await tx.orderStatusHistory.create({
          data: {
            orderId, actorId: actor.actorId, fromStatus: order.status,
            toStatus: input.toStatus, reason,
          },
        });
        return {
          id: orderId, fromStatus: order.status, status: input.toStatus,
          customerId: order.customerId,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      void this.realtime.publish({
        type: "order.status", orderId, branchId, customerId: changed.customerId,
        status: changed.status,
      });
      return { id: changed.id, fromStatus: changed.fromStatus, status: changed.status };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("ORDER_CHANGED_REFRESH");
      }
      throw error;
    }
  }

  async editItems(
    authorization: string | undefined,
    branchId: string,
    orderId: string,
    input: EditInput,
  ) {
    const actor = await this.role(authorization, branchId);
    if (actor.role !== "OWNER" && actor.role !== "MANAGER") {
      throw new ForbiddenException("ORDER_EDIT_FORBIDDEN");
    }
    const reason = input.reason.trim();
    if (reason.length < 5 || reason.length > 500) {
      throw new BadRequestException("ORDER_EDIT_REASON_REQUIRED");
    }
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (!Number.isFinite(expectedUpdatedAt.getTime())) {
      throw new BadRequestException("INVALID_ORDER_EDIT_VERSION");
    }

    try {
      const changed = await this.prisma.database.$transaction(async tx => {
        const order = await tx.order.findFirst({
          where: { id: orderId, branchId },
          select: {
            status: true, customerId: true, updatedAt: true,
            subtotalVnd: true, deliveryFeeVnd: true, totalVnd: true,
            payment: { select: { id: true, status: true } },
            items: {
              orderBy: { id: "asc" },
              select: {
                id: true, productId: true, variantId: true, pricingMode: true,
                productName: true, variantName: true, quantity: true,
                unitPriceVnd: true, lineTotalVnd: true,
                modifiers: {
                  orderBy: { id: "asc" },
                  select: { optionId: true, name: true, priceVnd: true },
                },
                comboItems: {
                  orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
                  select: { productId: true, kind: true, groupName: true, productName: true,
                    quantity: true, priceDeltaVnd: true, sortOrder: true },
                },
              },
            },
          },
        });
        if (!order) throw new NotFoundException("ORDER_NOT_FOUND");
        if (order.status !== input.expectedStatus
          || order.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw new ConflictException("ORDER_CHANGED_REFRESH");
        }
        if (!["PENDING", "CONFIRMED"].includes(order.status)) {
          throw new ConflictException("ORDER_EDIT_LOCKED");
        }
        if (!order.payment || order.payment.status !== "PENDING") {
          throw new ConflictException("ORDER_PAYMENT_ALREADY_SETTLED");
        }

        const productIds = [...new Set(input.items.map(item => item.productId))];
        const products = await tx.product.findMany({
          where: {
            id: { in: productIds },
            category: { is: { branchId } },
          },
          select: productSelect,
        });
        const priced = priceCart(input.items, products);
        const totalVnd = priced.subtotalVnd + order.deliveryFeeVnd;
        if (!Number.isSafeInteger(totalVnd) || totalVnd < priced.subtotalVnd) {
          throw new BadRequestException("INVALID_ORDER_TOTAL");
        }

        const versionCheck = await tx.order.updateMany({
          where: { id: orderId, branchId, status: input.expectedStatus, updatedAt: expectedUpdatedAt },
          data: { subtotalVnd: priced.subtotalVnd, totalVnd },
        });
        if (versionCheck.count !== 1) throw new ConflictException("ORDER_CHANGED_REFRESH");

        await tx.orderItemModifierSnapshot.deleteMany({
          where: { orderItem: { orderId } },
        });
        await tx.orderItemComboSnapshot.deleteMany({
          where: { orderItem: { orderId } },
        });
        await tx.orderItem.deleteMany({ where: { orderId } });

        for (const line of priced.lines) {
          await tx.orderItem.create({
            data: {
              orderId, productId: line.productId, variantId: line.variantId,
              productName: line.productName, variantName: line.variantName,
              pricingMode: line.pricingMode, quantity: line.quantity,
              unitPriceVnd: line.unitPriceVnd, lineTotalVnd: line.lineTotalVnd,
              modifiers: {
                create: line.modifiers.map(modifier => ({
                  optionId: modifier.optionId,
                  name: modifier.name, priceVnd: modifier.priceVnd,
                })),
              },
              comboItems: {
                create: line.comboItems.map(component => ({
                  productId: component.productId, kind: component.kind,
                  groupName: component.groupName, productName: component.productName,
                  quantity: component.quantity, priceDeltaVnd: component.priceDeltaVnd,
                  sortOrder: component.sortOrder,
                })),
              },
            },
          });
        }

        await tx.payment.update({
          where: { id: order.payment.id }, data: { amountVnd: totalVnd },
        });

        const afterItems = priced.lines.map(line => ({
          productId: line.productId, variantId: line.variantId,
          pricingMode: line.pricingMode, productName: line.productName,
          variantName: line.variantName, quantity: line.quantity,
          unitPriceVnd: line.unitPriceVnd, lineTotalVnd: line.lineTotalVnd,
          modifiers: line.modifiers,
          comboItems: line.comboItems,
        }));

        await tx.orderEditAudit.create({
          data: {
            orderId, actorId: actor.actorId, reason, status: order.status,
            beforeSubtotalVnd: order.subtotalVnd, afterSubtotalVnd: priced.subtotalVnd,
            beforeTotalVnd: order.totalVnd, afterTotalVnd: totalVnd,
            beforeItems: order.items as unknown as Prisma.InputJsonValue,
            afterItems: afterItems as unknown as Prisma.InputJsonValue,
          },
        });

        return {
          id: orderId, status: order.status, customerId: order.customerId,
          subtotalVnd: priced.subtotalVnd, totalVnd,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });

      void this.realtime.publish({
        type: "order.updated", orderId, branchId, customerId: changed.customerId,
        status: changed.status,
      });
      return changed;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("ORDER_CHANGED_REFRESH");
      }
      throw error;
    }
  }
}
