import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { vietnamDateWindow } from "../orders/order-search";

const TZ = "Asia/Ho_Chi_Minh" as const;
function safeNumber(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new ConflictException("REPORT_VALUE_OVERFLOW");
  return n;
}
function dayKey(v: Date): string { return v.toISOString().slice(0, 10); }
type DailyRow = { day: Date;
  settledSessionCount: bigint; closedInvoiceVnd: bigint;
  ticketCount: bigint; rejectedQrCount: bigint; voidedTicketCount: bigint;
  cashCollectedVnd: bigint; qrCollectedVnd: bigint; refundedVnd: bigint;
  pendingQrVnd: bigint; voidedQrCount: bigint;
};
type ProductRow = { productName: string; variantName: string | null;
  quantity: bigint; amountVnd: bigint };
type StaffRow = { staffId: string; method: string; paymentCount: bigint; collectedVnd: bigint };

/**
 * L08 has two *different clocks*: closedAt for completed invoice value and
 * confirmedAt for cash inflows; a PAYMENT_REFUNDED audit createdAt is an outflow
 * on the refund day, NOT on the historical confirmation/closure day.
 * Delivery reporting is intentionally separate and unchanged.
 */
@Injectable()
export class DiningReportService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  private async scope(auth: string | undefined, branchId: string) {
    const principal = await this.auth.principal(auth);
    const branch = await this.prisma.database.branch.findUnique({
      where: { id: branchId }, select: { id: true },
    });
    if (!branch) throw new NotFoundException("DINING_BRANCH_NOT_FOUND");
    if (principal.role === "OWNER") return;
    const membership = await this.prisma.database.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId: principal.id } }, select: { role: true },
    });
    if (!membership || !["OWNER", "MANAGER"].includes(membership.role))
      throw new ForbiddenException("DINING_REPORT_FORBIDDEN");
  }

  async summary(auth: string | undefined, branchId: string, from: string, to: string) {
    await this.scope(auth, branchId);
    const { start, end } = vietnamDateWindow(from, to);
    const rows = await this.prisma.database.$queryRaw<DailyRow[]>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(${from}::date, ${to}::date, interval '1 day')::date AS day
      ),
      invoices AS (
        SELECT (s."closedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          s.id AS session_id,
          coalesce(sum(i."lineTotalVnd") FILTER (WHERE t.status IN
            ('APPROVED', 'PREPARING', 'READY', 'SERVED')), 0)::bigint AS amount
        FROM "DiningSession" s
        LEFT JOIN "DiningTicket" t ON t."sessionId" = s.id AND t."branchId" = s."branchId"
        LEFT JOIN "DiningTicketItem" i ON i."ticketId" = t.id
        WHERE s."branchId" = ${branchId}::uuid AND s.status = 'CLOSED'
          AND s."closedAt" >= ${start} AND s."closedAt" < ${end}
        GROUP BY s.id, s."closedAt"
      ),
      invoice_by_day AS (
        SELECT day, count(*) FILTER (WHERE amount > 0)::bigint AS count,
          coalesce(sum(amount), 0)::bigint AS amount FROM invoices GROUP BY day
      ),
      ticket_by_day AS (
        SELECT (t."createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          count(*)::bigint AS count
        FROM "DiningTicket" t
        WHERE t."branchId" = ${branchId}::uuid
          AND t."createdAt" >= ${start} AND t."createdAt" < ${end}
        GROUP BY 1
      ),
      rejected_by_day AS (
        SELECT (t."reviewedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          count(*)::bigint AS count
        FROM "DiningTicket" t
        WHERE t."branchId" = ${branchId}::uuid AND t.source = 'QR'
          AND t.status = 'REJECTED'
          AND t."reviewedAt" >= ${start} AND t."reviewedAt" < ${end}
        GROUP BY 1
      ),
      collected AS (
        SELECT (p."confirmedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          coalesce(sum(p."amountVnd") FILTER (WHERE p.method = 'CASH'), 0)::bigint AS cash,
          coalesce(sum(p."amountVnd") FILTER (WHERE p.method = 'QR'), 0)::bigint AS qr
        FROM "DiningPayment" p
        WHERE p."branchId" = ${branchId}::uuid AND p."confirmedAt" IS NOT NULL
          AND p."confirmedAt" >= ${start} AND p."confirmedAt" < ${end}
          AND p.status IN ('CONFIRMED', 'REFUNDED')
        GROUP BY 1
      ),
      pending_qr AS (
        SELECT (p."createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          coalesce(sum(p."amountVnd"), 0)::bigint AS amount
        FROM "DiningPayment" p
        WHERE p."branchId" = ${branchId}::uuid AND p.method = 'QR'
          AND p.status = 'PENDING' AND p."createdAt" >= ${start} AND p."createdAt" < ${end}
        GROUP BY 1
      ),
      refunds AS (
        SELECT (a."createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          coalesce(sum(p."amountVnd"), 0)::bigint AS amount
        FROM "DiningAuditEvent" a
        JOIN "DiningPayment" p ON p.id::text = a.details->>'paymentId'
          AND p."branchId" = a."branchId" AND p."sessionId" = a."sessionId"
        WHERE a."branchId" = ${branchId}::uuid AND a.action = 'PAYMENT_REFUNDED'
          AND a."createdAt" >= ${start} AND a."createdAt" < ${end}
        GROUP BY 1
      ),
      voids AS (
        SELECT (a."createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day,
          count(*) FILTER (WHERE a.action = 'TICKET_VOIDED')::bigint AS tickets,
          count(*) FILTER (WHERE a.action = 'QR_PAYMENT_VOIDED')::bigint AS qr
        FROM "DiningAuditEvent" a
        WHERE a."branchId" = ${branchId}::uuid
          AND a.action IN ('TICKET_VOIDED', 'QR_PAYMENT_VOIDED')
          AND a."createdAt" >= ${start} AND a."createdAt" < ${end}
        GROUP BY 1
      )
      SELECT d.day,
        coalesce(i.count, 0)::bigint AS "settledSessionCount",
        coalesce(i.amount, 0)::bigint AS "closedInvoiceVnd",
        coalesce(t.count, 0)::bigint AS "ticketCount",
        coalesce(q.count, 0)::bigint AS "rejectedQrCount",
        coalesce(v.tickets, 0)::bigint AS "voidedTicketCount",
        coalesce(c.cash, 0)::bigint AS "cashCollectedVnd",
        coalesce(c.qr, 0)::bigint AS "qrCollectedVnd",
        coalesce(f.amount, 0)::bigint AS "refundedVnd",
        coalesce(p.amount, 0)::bigint AS "pendingQrVnd",
        coalesce(v.qr, 0)::bigint AS "voidedQrCount"
      FROM days d
      LEFT JOIN invoice_by_day i ON i.day = d.day
      LEFT JOIN ticket_by_day t ON t.day = d.day
      LEFT JOIN rejected_by_day q ON q.day = d.day
      LEFT JOIN collected c ON c.day = d.day
      LEFT JOIN refunds f ON f.day = d.day
      LEFT JOIN pending_qr p ON p.day = d.day
      LEFT JOIN voids v ON v.day = d.day
      ORDER BY d.day ASC
    `);
    const count = await this.prisma.database.diningSession.count({
      where: { branchId, closedAt: null },
    });
    const days = rows.map(row => ({
      day: dayKey(row.day),
      settledSessionCount: safeNumber(row.settledSessionCount),
      closedInvoiceVnd: safeNumber(row.closedInvoiceVnd),
      ticketCount: safeNumber(row.ticketCount),
      rejectedQrCount: safeNumber(row.rejectedQrCount),
      voidedTicketCount: safeNumber(row.voidedTicketCount),
      cashCollectedVnd: safeNumber(row.cashCollectedVnd),
      qrCollectedVnd: safeNumber(row.qrCollectedVnd),
      refundedVnd: safeNumber(row.refundedVnd),
      pendingQrVnd: safeNumber(row.pendingQrVnd),
      voidedQrCount: safeNumber(row.voidedQrCount),
      netCollectedVnd: safeNumber(row.cashCollectedVnd + row.qrCollectedVnd - row.refundedVnd),
    }));
    const fields = ["settledSessionCount", "closedInvoiceVnd", "ticketCount",
      "rejectedQrCount", "voidedTicketCount", "cashCollectedVnd", "qrCollectedVnd",
      "refundedVnd", "pendingQrVnd", "voidedQrCount", "netCollectedVnd"] as const;
    const totals = Object.fromEntries(fields.map(key => [
      key, days.reduce((sum, day) => sum + day[key], 0),
    ]));
    return { from, to, timezone: TZ, invoiceDateField: "closedAt",
      collectedDateField: "confirmedAt", refundDateField: "DiningAuditEvent.createdAt",
      shiftBasis: "NOT_AVAILABLE" as const, openTableCountNow: count,
      days, totals };
  }

  async products(auth: string | undefined, branchId: string, from: string, to: string,
    page = 0, limit = 20) {
    await this.scope(auth, branchId);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new BadRequestException("DINING_REPORT_PAGE_INVALID");
    const { start, end } = vietnamDateWindow(from, to);
    const entries = await this.prisma.database.$queryRaw<ProductRow[]>(Prisma.sql`
      SELECT i."productName", i."variantName",
        sum(i.quantity)::bigint AS quantity, sum(i."lineTotalVnd")::bigint AS "amountVnd"
      FROM "DiningTicketItem" i
      JOIN "DiningTicket" t ON t.id = i."ticketId"
      JOIN "DiningSession" s ON s.id = t."sessionId" AND s."branchId" = t."branchId"
      WHERE s."branchId" = ${branchId}::uuid AND s.status = 'CLOSED'
        AND s."closedAt" >= ${start} AND s."closedAt" < ${end}
        AND t.status IN ('APPROVED', 'PREPARING', 'READY', 'SERVED')
      GROUP BY i."productName", i."variantName"
      ORDER BY "amountVnd" DESC, i."productName" ASC, i."variantName" ASC NULLS FIRST
      LIMIT ${limit + 1} OFFSET ${page * limit}
    `);
    return { page, limit, items: entries.slice(0, limit).map(row => ({
      productName: row.productName, variantName: row.variantName,
      quantity: safeNumber(row.quantity), amountVnd: safeNumber(row.amountVnd),
    })), hasMore: entries.length > limit,
      basis: "CLOSED_SESSION_ITEM_SNAPSHOT" as const,
      note: "Giá dòng món đã gồm lựa chọn/topping; không nhân đôi topping." };
  }

  async collectors(auth: string | undefined, branchId: string, from: string, to: string,
    page = 0, limit = 20) {
    await this.scope(auth, branchId);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new BadRequestException("DINING_REPORT_PAGE_INVALID");
    const { start, end } = vietnamDateWindow(from, to);
    const entries = await this.prisma.database.$queryRaw<StaffRow[]>(Prisma.sql`
      SELECT p."confirmedById" AS "staffId", p.method::text AS method,
        count(*)::bigint AS "paymentCount",
        coalesce(sum(p."amountVnd"), 0)::bigint AS "collectedVnd"
      FROM "DiningPayment" p
      WHERE p."branchId" = ${branchId}::uuid AND p."confirmedAt" IS NOT NULL
        AND p."confirmedAt" >= ${start} AND p."confirmedAt" < ${end}
        AND p.status IN ('CONFIRMED', 'REFUNDED')
      GROUP BY p."confirmedById", p.method
      ORDER BY "collectedVnd" DESC, p."confirmedById" ASC, p.method ASC
      LIMIT ${limit + 1} OFFSET ${page * limit}
    `);
    return { page, limit, items: entries.slice(0, limit).map(row => ({
      staffId: row.staffId, method: row.method,
      paymentCount: safeNumber(row.paymentCount), collectedVnd: safeNumber(row.collectedVnd),
    })), hasMore: entries.length > limit, basis: "CONFIRMED_AT_NO_SHIFTS" as const,
      note: "Theo nhân viên xác nhận thu, chưa phải báo cáo ca; khoản hoàn trừ riêng theo ngày hoàn." };
  }
}
