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
import { PushService } from "../push/push.service";
import { orderCreatedBetween, orderIdMatch, vietnamDateWindow } from "./order-search";

const operatingRoles = ["OWNER", "MANAGER", "KITCHEN", "DRIVER"] as const;
type OperationalRole = (typeof operatingRoles)[number];
const allowedTargets = [
  "CONFIRMED", "CANCELED", "PREPARING", "READY",
  "DELIVERING", "DELIVERED", "DELIVERY_FAILED",
] as const;
type TargetStatus = (typeof allowedTargets)[number];

const selectOrder = {
  id: true, branchId: true, status: true, createdAt: true, updatedAt: true,
  customerNote: true, subtotalVnd: true, deliveryFeeVnd: true, totalVnd: true,
  payment: { select: { method: true, status: true, amountVnd: true } },
  items: { select: {
    id: true, productId: true, variantId: true, pricingMode: true,
    productName: true, variantName: true, quantity: true, unitPriceVnd: true,
    lineTotalVnd: true,
    modifiers: { select: { optionId: true, name: true, priceVnd: true } },
    comboItems: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { productId: true, variantId: true, modifierOptionId: true,
        kind: true, groupName: true, productName: true, variantName: true,
        quantity: true, priceDeltaVnd: true, sortOrder: true } },
  } },
} as const satisfies Prisma.OrderSelect;

const kitchenOrderSelect = {
  id: true, branchId: true, status: true, createdAt: true, updatedAt: true,
  customerNote: true,
  items: { select: { productName: true, variantName: true, quantity: true,
    modifiers: { select: { name: true } },
    comboItems: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { kind: true, groupName: true, productName: true,
        variantName: true, quantity: true } },
  } },
} as const satisfies Prisma.OrderSelect;

const driverOrderSelect = {
  id: true, branchId: true, status: true, createdAt: true, updatedAt: true,
  totalVnd: true,
  payment: { select: { method: true, status: true, amountVnd: true } },
  items: { select: {
    productName: true, variantName: true, quantity: true,
    modifiers: { select: { name: true } },
    comboItems: { select: {
      kind: true, groupName: true, productName: true, variantName: true, quantity: true,
    } },
  } },
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
    private readonly push: PushService,
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

  // Only the store owner can browse customers who actually ordered here.
  // Never return address snapshots, GPS, auth credentials or unrelated branches.
  async customers(authorization: string | undefined, branchId: string,
    cursor?: string, limit = 20) {
    const actor = await this.role(authorization, branchId);
    if (actor.role !== "OWNER") throw new ForbiddenException("CUSTOMERS_OWNER_ONLY");
    const rows = await this.prisma.database.user.findMany({
      where: {
        orders: { some: { branchId } },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: {
        id: true,
        phoneE164: true,
        _count: { select: { orders: { where: { branchId } } } },
        orders: {
          where: { branchId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { phoneSnapshot: true, createdAt: true },
        },
      },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(user => ({
        id: user.id,
        phone: user.orders[0]?.phoneSnapshot ?? user.phoneE164 ?? null,
        orderCount: user._count.orders,
        lastOrderAt: user.orders[0]?.createdAt ?? null,
      })),
      nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null,
    };
  }

  async customerHistory(authorization: string | undefined, branchId: string,
    customerId: string) {
    const actor = await this.role(authorization, branchId);
    if (actor.role !== "OWNER") throw new ForbiddenException("CUSTOMERS_OWNER_ONLY");
    const orders = await this.prisma.database.order.findMany({
      where: { branchId, customerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: {
        id: true, status: true, createdAt: true, totalVnd: true,
        payment: { select: { method: true, status: true } },
      },
    });
    if (!orders.length) throw new NotFoundException("BRANCH_CUSTOMER_NOT_FOUND");
    return { customerId, items: orders };
  }

  async list(authorization: string | undefined, branchId: string, status?: OrderStatus) {
    const staff = await this.role(authorization, branchId);
    return this.prisma.database.order.findMany({
      where: { branchId, ...(status ? { status } : {}),
        ...(staff.role === "DRIVER" ? { deliveryAssignment: { is: { driverId: staff.actorId } } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100, select: staff.role === "KITCHEN" ? kitchenOrderSelect
        : staff.role === "DRIVER" ? driverOrderSelect : selectOrder,
    });
  }

  /**
   * Reporting has three independent clocks: order.createdAt for the order
   * cohort, statusHistory.createdAt for delivered/canceled/failed events,
   * and *no* trusted payment-confirmation timestamp in today's schema.
   * Consequently confirmed payment is a CURRENT balance grouped by delivery
   * day, never falsely advertised as cash received on that calendar day.
   *
   * All aggregation happens in PostgreSQL; nothing is capped at 100 rows.
   */
  async businessReport(authorization: string | undefined, branchId: string,
    from: string, to: string) {
    const actor = await this.role(authorization, branchId);
    if (actor.role !== "OWNER" && actor.role !== "MANAGER") {
      throw new ForbiddenException("BUSINESS_REPORT_FORBIDDEN");
    }
    const window = vietnamDateWindow(from, to);
    type ReportRow = {
      day: Date;
      createdCount: bigint; cohortCanceledCount: bigint;
      deliveredCount: bigint; canceledCount: bigint; failedCount: bigint;
      deliveredValueVnd: bigint; confirmedPaymentVnd: bigint;
      codConfirmedVnd: bigint; qrConfirmedVnd: bigint;
      pendingPaymentVnd: bigint; refundedPaymentVnd: bigint;
    };
    const rows = await this.prisma.database.$queryRaw<ReportRow[]>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(${from}::date, ${to}::date,
          INTERVAL '1 day')::date AS day
      ),
      created AS (
        SELECT (o."createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          count(*)::bigint AS count,
          count(*) FILTER (WHERE o."status" = 'CANCELED')::bigint AS canceled_cohort
        FROM "Order" o WHERE o."branchId" = ${branchId}::uuid
          AND o."createdAt" >= ${window.start}
          AND o."createdAt" < ${window.end}
        GROUP BY 1
      ),
      delivered_events AS (
        SELECT DISTINCT ON (h."orderId") h."orderId", h."createdAt"
        FROM "OrderStatusHistory" h
        JOIN "Order" o ON o."id" = h."orderId"
        WHERE o."branchId" = ${branchId}::uuid AND o."status" = 'DELIVERED'
          AND h."toStatus" = 'DELIVERED'
          AND h."createdAt" >= ${window.start} AND h."createdAt" < ${window.end}
        ORDER BY h."orderId", h."createdAt" ASC
      ),
      delivered AS (
        SELECT (e."createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          count(*)::bigint AS count,
          coalesce(sum(o."totalVnd"), 0)::bigint AS value_vnd,
          coalesce(sum(p."amountVnd") FILTER (WHERE p."status" = 'CONFIRMED'), 0)::bigint AS confirmed_vnd,
          coalesce(sum(p."amountVnd") FILTER (WHERE p."status" = 'CONFIRMED' AND p."method" = 'COD'), 0)::bigint AS cod_vnd,
          coalesce(sum(p."amountVnd") FILTER (WHERE p."status" = 'CONFIRMED' AND p."method" = 'QR'), 0)::bigint AS qr_vnd,
          coalesce(sum(p."amountVnd") FILTER (WHERE p."status" = 'PENDING'), 0)::bigint AS pending_vnd,
          coalesce(sum(p."amountVnd") FILTER (WHERE p."status" = 'REFUNDED'), 0)::bigint AS refunded_vnd
        FROM delivered_events e
        JOIN "Order" o ON o."id" = e."orderId"
        LEFT JOIN "Payment" p ON p."orderId" = o."id"
        GROUP BY 1
      ),
      canceled_events AS (
        SELECT DISTINCT ON (h."orderId") h."orderId", h."createdAt"
        FROM "OrderStatusHistory" h
        JOIN "Order" o ON o."id" = h."orderId"
        WHERE o."branchId" = ${branchId}::uuid AND o."status" = 'CANCELED'
          AND h."toStatus" = 'CANCELED'
          AND h."createdAt" >= ${window.start} AND h."createdAt" < ${window.end}
        ORDER BY h."orderId", h."createdAt" ASC
      ),
      failed_events AS (
        SELECT DISTINCT ON (h."orderId") h."orderId", h."createdAt"
        FROM "OrderStatusHistory" h
        JOIN "Order" o ON o."id" = h."orderId"
        WHERE o."branchId" = ${branchId}::uuid
          AND h."toStatus" = 'DELIVERY_FAILED'
          AND h."createdAt" >= ${window.start} AND h."createdAt" < ${window.end}
        ORDER BY h."orderId", h."createdAt" ASC
      ),
      cancellations AS (
        SELECT (e."createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          count(*)::bigint AS count FROM canceled_events e GROUP BY 1
      ),
      failures AS (
        SELECT (e."createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          count(*)::bigint AS count FROM failed_events e GROUP BY 1
      )
      SELECT d.day,
        coalesce(c.count, 0)::bigint AS "createdCount",
        coalesce(c.canceled_cohort, 0)::bigint AS "cohortCanceledCount",
        coalesce(v.count, 0)::bigint AS "deliveredCount",
        coalesce(x.count, 0)::bigint AS "canceledCount",
        coalesce(f.count, 0)::bigint AS "failedCount",
        coalesce(v.value_vnd, 0)::bigint AS "deliveredValueVnd",
        coalesce(v.confirmed_vnd, 0)::bigint AS "confirmedPaymentVnd",
        coalesce(v.cod_vnd, 0)::bigint AS "codConfirmedVnd",
        coalesce(v.qr_vnd, 0)::bigint AS "qrConfirmedVnd",
        coalesce(v.pending_vnd, 0)::bigint AS "pendingPaymentVnd",
        coalesce(v.refunded_vnd, 0)::bigint AS "refundedPaymentVnd"
      FROM days d
      LEFT JOIN created c ON c.day = d.day
      LEFT JOIN delivered v ON v.day = d.day
      LEFT JOIN cancellations x ON x.day = d.day
      LEFT JOIN failures f ON f.day = d.day
      ORDER BY d.day ASC
    `);
    const money = (n: bigint) => {
      const value = Number(n);
      if (!Number.isSafeInteger(value)) {
        throw new ConflictException("REPORT_VALUE_OVERFLOW");
      }
      return value;
    };
    const days = rows.map(row => ({
      day: new Date(row.day).toISOString().slice(0, 10),
      createdCount: money(row.createdCount),
      cohortCanceledCount: money(row.cohortCanceledCount),
      deliveredCount: money(row.deliveredCount),
      canceledCount: money(row.canceledCount),
      failedCount: money(row.failedCount),
      deliveredValueVnd: money(row.deliveredValueVnd),
      confirmedPaymentVnd: money(row.confirmedPaymentVnd),
      codConfirmedVnd: money(row.codConfirmedVnd),
      qrConfirmedVnd: money(row.qrConfirmedVnd),
      pendingPaymentVnd: money(row.pendingPaymentVnd),
      refundedPaymentVnd: money(row.refundedPaymentVnd),
    }));
    const totals = days.reduce((acc, day) => {
      for (const key of Object.keys(acc) as (keyof typeof acc)[]) {
        acc[key] += day[key];
      }
      return acc;
    }, {
      createdCount: 0, cohortCanceledCount: 0, deliveredCount: 0,
      canceledCount: 0, failedCount: 0, deliveredValueVnd: 0,
      confirmedPaymentVnd: 0, codConfirmedVnd: 0, qrConfirmedVnd: 0,
      pendingPaymentVnd: 0, refundedPaymentVnd: 0,
    });
    return {
      from, to, timezone: "Asia/Ho_Chi_Minh", days, totals,
      cancellationRatePercent: totals.createdCount
        ? Math.round(totals.cohortCanceledCount * 10000 / totals.createdCount) / 100 : 0,
      cancellationRateBasis: "CREATED_COHORT_CURRENT_STATUS",
      paymentBasis: "CURRENT_CONFIRMED_STATUS_BY_DELIVERY_DATE",
      paymentCollectedAtAvailable: false,
    };
  }

  /**
   * Branch-wide daily figures are computed on the server, not from the most
   * recent 100 orders delivered by the alert endpoint. Vietnam observes UTC+7
   * year-round, so the business-day window is unambiguous even on UTC hosts.
   */
  async overviewSummary(authorization: string | undefined, branchId: string) {
    const staff = await this.role(authorization, branchId);
    if (staff.role !== "OWNER" && staff.role !== "MANAGER") {
      throw new ForbiddenException("ORDER_SUMMARY_FORBIDDEN");
    }
    const vietnamNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const date = vietnamNow.toISOString().slice(0, 10);
    const start = new Date(Date.UTC(
      vietnamNow.getUTCFullYear(), vietnamNow.getUTCMonth(),
      vietnamNow.getUTCDate(),
    ) - 7 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const [statuses, delivered] = await Promise.all([
      this.prisma.database.order.groupBy({
        by: ["status"],
        where: { branchId, status: { in: [
          "PENDING", "CONFIRMED", "PREPARING", "READY",
        ] } },
        _count: { _all: true },
      }),
      this.prisma.database.order.findMany({
        where: {
          branchId, status: "DELIVERED",
          statusHistory: { some: {
            toStatus: "DELIVERED",
            createdAt: { gte: start, lt: end },
          } },
        },
        select: {
          totalVnd: true,
          payment: { select: { method: true, status: true, amountVnd: true } },
        },
      }),
    ]);
    const counts = new Map(statuses.map(row => [row.status, row._count._all]));
    let deliveredValueVnd = 0;
    let confirmedPaymentVnd = 0;
    for (const order of delivered) {
      deliveredValueVnd += order.totalVnd;
      // QR awaiting review, refunds and failed payments are NOT counted as paid.
      // COD is confirmed atomically when delivery is completed.
      if (order.payment?.status === "CONFIRMED") {
        confirmedPaymentVnd += order.payment.amountVnd;
      }
    }
    return {
      date,
      pending: counts.get("PENDING") ?? 0,
      preparing: (counts.get("CONFIRMED") ?? 0) + (counts.get("PREPARING") ?? 0),
      ready: counts.get("READY") ?? 0,
      deliveredCount: delivered.length,
      deliveredValueVnd,
      confirmedPaymentVnd,
    };
  }

  // Old clients still use list() for latest order alerts. This scoped endpoint
  // pages each status lane independently, so >100 new orders cannot hide history.
  async listPage(authorization: string | undefined, branchId: string,
    group: "new" | "confirmed" | "preparing" | "ready" | "delivering"
      | "history" | "lookup" | "kitchen" | "delivery",
    cursorId?: string, limit = 25,
    historyStatus?: "DELIVERED" | "CANCELED" | "DELIVERY_FAILED",
    search: { from?: string | undefined; to?: string | undefined;
      code?: string | undefined;
      metric?: "CREATED" | "COHORT_CANCELED" | "DELIVERED" | "CANCELED"
        | "FAILED" | "CONFIRMED" | "COD_CONFIRMED" | "QR_CONFIRMED"
        | "PENDING" | "REFUNDED" | undefined } = {}) {
    const staff = await this.role(authorization, branchId);
    if (historyStatus && group !== "history")
      throw new BadRequestException("INVALID_HISTORY_FILTER");
    if ((search.from !== undefined || search.to !== undefined || search.code !== undefined)
      && group !== "history" && group !== "lookup") {
      throw new BadRequestException("INVALID_ORDER_LOOKUP_SCOPE");
    }
    if (group === "lookup" && historyStatus)
      throw new BadRequestException("INVALID_HISTORY_FILTER");
    if (search.metric && (group !== "lookup" || !search.from || !search.to || search.code))
      throw new BadRequestException("INVALID_REPORT_DRILLDOWN");
    const groups: Record<typeof group, OrderStatus[]> = {
      new: ["PENDING"], confirmed: ["CONFIRMED"], preparing: ["PREPARING"],
      ready: ["READY"], delivering: ["DELIVERING"],
      history: ["DELIVERED", "CANCELED", "DELIVERY_FAILED"],
      lookup: ["PENDING", "CONFIRMED", "PREPARING", "READY",
        "DELIVERING", "DELIVERED", "CANCELED", "DELIVERY_FAILED"],
      kitchen: ["CONFIRMED", "PREPARING", "READY"],
      delivery: ["READY", "DELIVERING", "DELIVERED", "DELIVERY_FAILED"],
    };
    // Only the kitchen or assigned drivers may use their specialized lanes.
    if (group === "lookup" && staff.role !== "OWNER" && staff.role !== "MANAGER")
      throw new ForbiddenException("ORDER_LOOKUP_FORBIDDEN");
    if (staff.role === "KITCHEN" && group !== "kitchen")
      throw new ForbiddenException("ORDER_LANE_FORBIDDEN");
    if (staff.role === "DRIVER" && group !== "delivery")
      throw new ForbiddenException("ORDER_LANE_FORBIDDEN");
    const createdAt = orderCreatedBetween(search.from, search.to);
    const matchedId = orderIdMatch(search.code);
    const metric = search.metric;
    const byCreatedDay = !metric || metric === "CREATED" || metric === "COHORT_CANCELED";
    const eventType = metric === "CANCELED" ? "CANCELED"
      : metric === "FAILED" ? "DELIVERY_FAILED" : "DELIVERED";
    const metricStatus: Prisma.OrderWhereInput["status"] =
      metric === "COHORT_CANCELED" || metric === "CANCELED" ? "CANCELED"
      : metric && metric !== "CREATED" && metric !== "FAILED" ? "DELIVERED"
      : { in: groups[group] };
    const paymentMatch: Prisma.OrderWhereInput["payment"] =
      metric === "CONFIRMED" ? { is: { status: "CONFIRMED" } }
      : metric === "COD_CONFIRMED"
        ? { is: { status: "CONFIRMED", method: "COD" } }
      : metric === "QR_CONFIRMED"
        ? { is: { status: "CONFIRMED", method: "QR" } }
      : metric === "PENDING" ? { is: { status: "PENDING" } }
      : metric === "REFUNDED" ? { is: { status: "REFUNDED" } }
      : undefined;
    const scope: Prisma.OrderWhereInput = {
      branchId, status: historyStatus ?? metricStatus,
      ...(byCreatedDay && createdAt ? { createdAt } : {}),
      ...(metric && !byCreatedDay && createdAt ? {
        statusHistory: { some: {
          toStatus: eventType, createdAt,
        } },
      } : {}),
      ...(paymentMatch ? { payment: paymentMatch } : {}),
      ...(matchedId ? { id: matchedId } : {}),
      ...(staff.role === "DRIVER"
        ? { deliveryAssignment: { is: { driverId: staff.actorId } } } : {}),
    };
    const cursor = cursorId ? await this.prisma.database.order.findFirst({
      where: { ...scope, AND: [{ id: cursorId }] },
      select: { createdAt: true, id: true },
    }) : null;
    if (cursorId && !cursor) throw new BadRequestException("INVALID_ORDER_PAGE_CURSOR");
    const [rows, total] = await Promise.all([
      this.prisma.database.order.findMany({
        where: { ...scope, ...(cursor ? { OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ] } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: staff.role === "KITCHEN" ? kitchenOrderSelect
          : staff.role === "DRIVER" ? driverOrderSelect : selectOrder,
      }),
      this.prisma.database.order.count({ where: scope }),
    ]);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return { items, total, nextCursor: hasMore
      ? items[items.length - 1]?.id ?? null : null };
  }

  async detail(authorization: string | undefined, branchId: string, orderId: string) {
    const staff = await this.role(authorization, branchId);
    const record = await this.prisma.database.order.findFirst({
      where: { id: orderId, branchId,
        ...(staff.role === "DRIVER" ? { deliveryAssignment: { is: { driverId: staff.actorId } } } : {}) },
      select: {
        ...(staff.role === "KITCHEN" ? kitchenOrderSelect
          : staff.role === "DRIVER" ? driverOrderSelect : selectOrder),
        // Internal-only comparison. Never expose customer or actor IDs in the audit payload.
        customerId: true,
        statusHistory: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { fromStatus: true, toStatus: true, reason: true, createdAt: true, actorId: true },
        },
        ...(staff.role === "KITCHEN" ? {} : {
          phoneSnapshot: true, addressLineSnapshot: true, roadDistanceMeters: true,
          latitudeSnapshot: true, longitudeSnapshot: true,
          ...(staff.role === "DRIVER" ? {} : {
          pricingMode: true, zoneNameSnapshot: true,
          provinceCodeSnapshot: true, wardCodeSnapshot: true,
          catalogVersionSnapshot: true,
          deliveryAssignment: { select: { driverId: true } },
          edits: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              reason: true, status: true, beforeSubtotalVnd: true, afterSubtotalVnd: true,
              beforeTotalVnd: true, afterTotalVnd: true, createdAt: true,
            },
          },
          }),
        }),
      },
    });
    if (!record) throw new NotFoundException("ORDER_NOT_FOUND");
    const { customerId, statusHistory, ...detail } = record;
    return {
      ...detail,
      statusHistory: statusHistory.map(({ actorId, ...change }) => ({
        ...change,
        source: actorId === null ? "UNKNOWN" as const
          : actorId === customerId ? "CUSTOMER" as const : "SHOP" as const,
      })),
    };
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
            deliveryAssignment: { select: { driverId: true } },
            payment: { select: { id: true, method: true, status: true } },
          },
        });
        if (!order) throw new NotFoundException("ORDER_NOT_FOUND");
        if (order.status !== input.expectedStatus) {
          throw new ConflictException("ORDER_CHANGED_REFRESH");
        }
        const isAssignedDriver = actor.role === "DRIVER"
          && order.deliveryAssignment?.driverId === actor.actorId;
        // A driver may change only their own assigned delivery. No other order
        // details leak through status mutations, even if IDs are guessed.
        if (actor.role === "DRIVER" && !isAssignedDriver) {
          throw new NotFoundException("ORDER_NOT_FOUND");
        }
        try {
          assertOrderTransition({
            from: order.status, to: input.toStatus,
            role: actor.role as Role, isAssignedDriver,
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
      if (changed.status === "CONFIRMED") {
        void this.push.notifyCustomerConfirmed(changed.customerId, orderId).catch(() => undefined);
      } else if (changed.status === "CANCELED" || changed.status === "DELIVERING") {
        // Customer only needs essential alerts. Every other status still syncs via
        // realtime/polling and remains in the server-side order history.
        void this.push.notifyCustomerStatus(changed.customerId, orderId, changed.status, reason)
          .catch(() => undefined);
      }
      return { id: changed.id, fromStatus: changed.fromStatus, status: changed.status };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("ORDER_CHANGED_REFRESH");
      }
      throw error;
    }
  }

  async drivers(authorization: string | undefined, branchId: string) {
    const actor = await this.role(authorization, branchId);
    if (actor.role !== "OWNER" && actor.role !== "MANAGER")
      throw new ForbiddenException("DRIVER_ASSIGN_FORBIDDEN");
    return this.prisma.database.branchMember.findMany({
      where: { branchId, role: "DRIVER" }, orderBy: { createdAt: "asc" },
      select: { userId: true, user: { select: { phoneE164: true } } },
    });
  }

  async assignDriver(authorization: string | undefined, branchId: string,
    orderId: string, driverId: string) {
    const actor = await this.role(authorization, branchId);
    if (actor.role !== "OWNER" && actor.role !== "MANAGER")
      throw new ForbiddenException("DRIVER_ASSIGN_FORBIDDEN");
    try {
      const changed = await this.prisma.database.$transaction(async tx => {
        const [member, order] = await Promise.all([
          tx.branchMember.findUnique({
            where: { branchId_userId: { branchId, userId: driverId } },
            select: { role: true },
          }),
          tx.order.findFirst({
            where: { id: orderId, branchId },
            select: { status: true, customerId: true },
          }),
        ]);
        if (!order) throw new NotFoundException("ORDER_NOT_FOUND");
        if (member?.role !== "DRIVER") throw new BadRequestException("DRIVER_NOT_IN_BRANCH");
        // Assignment changes only before dispatch. A failed delivery may be
        // reassigned for retry, never a completed or in-transit delivery.
        if (order.status !== "READY" && order.status !== "DELIVERY_FAILED")
          throw new ConflictException("DRIVER_ASSIGN_STATUS_LOCKED");
        await tx.deliveryAssignment.upsert({
          where: { orderId },
          create: { orderId, driverId },
          update: { driverId, assignedAt: new Date() },
        });
        return { customerId: order.customerId, status: order.status };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      void this.realtime.publish({
        type: "order.updated", orderId, branchId, customerId: changed.customerId,
        status: changed.status,
      });
      return { orderId, driverId, status: changed.status };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictException("ORDER_CHANGED_REFRESH");
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
                  select: { productId: true, variantId: true, modifierOptionId: true,
                    kind: true, groupName: true, productName: true, variantName: true,
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
                  productId: component.productId, variantId: component.variantId,
                  modifierOptionId: component.modifierOptionId,
                  kind: component.kind, groupName: component.groupName,
                  productName: component.productName, variantName: component.variantName,
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
