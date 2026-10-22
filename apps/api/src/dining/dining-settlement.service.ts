import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { OrderRealtimeService } from "../orders/order-realtime.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import type { DiningPaymentInput } from "./dining.controller";
import { configuredQr, qrInstructions } from "../payments/vietqr";

type CashierRole = "OWNER" | "MANAGER" | "CASHIER" | "WAITER";
const BILLABLE = ["APPROVED", "PREPARING", "READY", "SERVED"] as const;

/**
 * All changes to a bill/payment are serialized on DiningSession (updatedAt),
 * using Serializable transactions. Never trust a client-supplied due amount.
 * QR is only a payment REQUEST until an authorized cashier confirms it manually.
 */
@Injectable()
export class DiningSettlementService {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService,
    private readonly realtime: OrderRealtimeService) {}

  private async actor(auth: string | undefined, branchId: string,
    roles: readonly CashierRole[]) {
    const principal = await this.auth.principal(auth);
    const branch = await this.prisma.database.branch.findUnique({
      where: { id: branchId }, select: { id: true },
    });
    if (!branch) throw new NotFoundException("DINING_BRANCH_NOT_FOUND");
    if (principal.role === "OWNER") {
      if (!roles.includes("OWNER")) throw new ForbiddenException("DINING_ROLE_FORBIDDEN");
      return { id: principal.id, role: "OWNER" as const };
    }
    const membership = await this.prisma.database.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId: principal.id } },
      select: { role: true },
    });
    if (!membership || !roles.includes(membership.role as CashierRole))
      throw new ForbiddenException("DINING_BRANCH_FORBIDDEN");
    return { id: principal.id, role: membership.role };
  }

  private async transact<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await this.prisma.database.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000,
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError)
          || !["P2034", "P2002"].includes(error.code)) throw error;
        if (attempt === 5) throw new ConflictException("DINING_CONCURRENT_RETRY");
      }
    }
    throw new ConflictException("DINING_CONCURRENT_RETRY");
  }

  private async lock(tx: Prisma.TransactionClient, branchId: string, sessionId: string) {
    const changed = await tx.diningSession.updateMany({
      where: { id: sessionId, branchId, closedAt: null,
        status: { in: ["OPEN", "CHECKOUT"] } },
      data: { updatedAt: new Date() },
    });
    if (changed.count !== 1) throw new ConflictException("DINING_SESSION_NOT_OPEN");
  }

  /** Full refunds are allowed after a settled session closes. Keep the invoice
   * immutable while serializing competing refund requests on its session row.
   * Only reverse(REFUNDED) may use this lock; new collections still require OPEN/CHECKOUT. */
  private async lockForRefund(tx: Prisma.TransactionClient, branchId: string, sessionId: string) {
    const changed = await tx.diningSession.updateMany({
      where: { id: sessionId, branchId, status: { in: ["OPEN", "CHECKOUT", "CLOSED"] } },
      data: { updatedAt: new Date() },
    });
    if (changed.count !== 1) throw new ConflictException("DINING_SESSION_NOT_FOUND");
  }

  private async amounts(tx: Prisma.TransactionClient, branchId: string, sessionId: string) {
    const [items, payments] = await Promise.all([
      tx.diningTicketItem.aggregate({ where: {
        ticket: { branchId, sessionId, status: { in: [...BILLABLE] } },
      }, _sum: { lineTotalVnd: true } }),
      tx.diningPayment.aggregate({ where: { branchId, sessionId, status: "CONFIRMED" },
        _sum: { amountVnd: true } }),
    ]);
    const subtotalVnd = items._sum.lineTotalVnd ?? 0;
    const paidVnd = payments._sum.amountVnd ?? 0;
    return { subtotalVnd, paidVnd, dueVnd: Math.max(0, subtotalVnd - paidVnd) };
  }

  private async noPending(tx: Prisma.TransactionClient, branchId: string, sessionId: string) {
    const count = await tx.diningTicket.count({
      where: { branchId, sessionId, status: "PENDING_APPROVAL" },
    });
    if (count) throw new ConflictException("DINING_PENDING_QR_TICKETS");
  }

  async checkout(auth: string | undefined, branchId: string, sessionId: string) {
    const actor = await this.actor(auth, branchId, ["OWNER", "MANAGER", "WAITER", "CASHIER"]);
    return this.transact(async tx => {
      await this.lock(tx, branchId, sessionId);
      await this.noPending(tx, branchId, sessionId);
      const session = await tx.diningSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (session.status === "CHECKOUT")
        return { sessionId, status: "CHECKOUT" as const, replayed: true };
      const amounts = await this.amounts(tx, branchId, sessionId);
      await tx.diningSession.update({ where: { id: sessionId }, data: { status: "CHECKOUT" } });
      await tx.diningAuditEvent.create({ data: {
        branchId, sessionId, actorId: actor.id, action: "SESSION_CHECKOUT",
        details: amounts,
      } });
      return { sessionId, status: "CHECKOUT" as const, replayed: false };
    });
  }

  async record(auth: string | undefined, branchId: string, sessionId: string,
    input: DiningPaymentInput) {
    const actor = await this.actor(auth, branchId, ["OWNER", "MANAGER", "CASHIER"]);
    if (!Number.isSafeInteger(input.amountVnd) || input.amountVnd <= 0 || input.amountVnd > 2_000_000_000)
      throw new BadRequestException("DINING_AMOUNT_INVALID");
    if (input.method === "CASH") {
      if (!Number.isSafeInteger(input.cashReceivedVnd) || input.cashReceivedVnd! < input.amountVnd
        || input.cashReceivedVnd! > 2_000_000_000)
        throw new BadRequestException("DINING_CASH_TENDER_INVALID");
    } else if (input.method !== "QR" || input.cashReceivedVnd !== undefined) {
      throw new BadRequestException("DINING_PAYMENT_METHOD_INVALID");
    }
    const beneficiary = input.method === "QR" ? configuredQr() : null;
    return this.transact(async tx => {
      await this.lock(tx, branchId, sessionId);
      const previous = await tx.diningPayment.findUnique({
        where: { sessionId_idempotencyKey: { sessionId, idempotencyKey: input.idempotencyKey } },
      });
      if (previous) {
        if (previous.method !== input.method || previous.amountVnd !== input.amountVnd
          || (input.method === "CASH" && previous.cashReceivedVnd !== input.cashReceivedVnd))
          throw new ConflictException("DINING_PAYMENT_KEY_REUSED");
        return { paymentId: previous.id, status: previous.status, amountVnd: previous.amountVnd,
          qr: qrInstructions(previous.id, previous.amountVnd, {
            method: previous.method, qrBankBin: previous.qrBankBin,
            qrAccountNo: previous.qrAccountNo, qrAccountName: previous.qrAccountName,
          }), replayed: true };
      }
      if (input.method === "QR" && !beneficiary)
        throw new ConflictException("DINING_QR_BENEFICIARY_NOT_CONFIGURED");
      await this.noPending(tx, branchId, sessionId);
      const row = await tx.diningSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (row.status !== "CHECKOUT") throw new ConflictException("DINING_CHECKOUT_REQUIRED");
      if (await tx.diningPayment.count({ where: { sessionId, branchId, status: "PENDING" } }))
        throw new ConflictException("DINING_QR_PAYMENT_PENDING");
      const amounts = await this.amounts(tx, branchId, sessionId);
      if (input.amountVnd > amounts.dueVnd) throw new ConflictException("DINING_PAYMENT_EXCEEDS_DUE");
      const status = input.method === "CASH" ? "CONFIRMED" as const : "PENDING" as const;
      const pay = await tx.diningPayment.create({ data: {
        branchId, sessionId, method: input.method, status, amountVnd: input.amountVnd,
        idempotencyKey: input.idempotencyKey, recordedById: actor.id,
        ...(input.method === "CASH" ? { cashReceivedVnd: input.cashReceivedVnd } : {}),
        ...(beneficiary ? { qrBankBin: beneficiary.bankBin, qrAccountNo: beneficiary.accountNo,
          qrAccountName: beneficiary.accountName } : {}),
        ...(status === "CONFIRMED" ? { confirmedAt: new Date(), confirmedById: actor.id } : {}),
      }, select: { id: true } });
      await tx.diningAuditEvent.create({ data: {
        branchId, sessionId, actorId: actor.id, action: "PAYMENT_RECORDED",
        details: { paymentId: pay.id, method: input.method, status, amountVnd: input.amountVnd,
          cashReceivedVnd: input.method === "CASH" ? input.cashReceivedVnd : null,
          cashChangeVnd: input.method === "CASH" ? input.cashReceivedVnd! - input.amountVnd : null,
          previousPaidVnd: amounts.paidVnd,
          nextPaidVnd: amounts.paidVnd + (status === "CONFIRMED" ? input.amountVnd : 0) },
      } });
      return { paymentId: pay.id, status, amountVnd: input.amountVnd,
        qr: beneficiary ? qrInstructions(pay.id, input.amountVnd, {
          method: "QR", qrBankBin: beneficiary.bankBin,
          qrAccountNo: beneficiary.accountNo, qrAccountName: beneficiary.accountName,
        }) : null, replayed: false };
    });
  }

  async confirm(auth: string | undefined, branchId: string, paymentId: string) {
    const actor = await this.actor(auth, branchId, ["OWNER", "MANAGER", "CASHIER"]);
    return this.transact(async tx => {
      const payment = await tx.diningPayment.findFirst({ where: { id: paymentId, branchId } });
      if (!payment) throw new NotFoundException("DINING_PAYMENT_NOT_FOUND");
      await this.lock(tx, branchId, payment.sessionId);
      if (payment.status === "CONFIRMED")
        return { paymentId, status: "CONFIRMED" as const, replayed: true };
      if (payment.method !== "QR" || payment.status !== "PENDING")
        throw new ConflictException("DINING_PAYMENT_NOT_PENDING");
      const amounts = await this.amounts(tx, branchId, payment.sessionId);
      if (payment.amountVnd > amounts.dueVnd)
        throw new ConflictException("DINING_PAYMENT_EXCEEDS_DUE");
      const changed = await tx.diningPayment.updateMany({
        where: { id: paymentId, branchId, status: "PENDING" },
        data: { status: "CONFIRMED", confirmedById: actor.id, confirmedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException("DINING_PAYMENT_STALE");
      await tx.diningAuditEvent.create({ data: {
        branchId, sessionId: payment.sessionId, actorId: actor.id,
        action: "QR_TRANSFER_MANUALLY_CONFIRMED",
        details: { paymentId, amountVnd: payment.amountVnd, previousPaidVnd: amounts.paidVnd,
          nextPaidVnd: amounts.paidVnd + payment.amountVnd },
      } });
      return { paymentId, status: "CONFIRMED" as const, replayed: false };
    });
  }

  async reverse(auth: string | undefined, branchId: string, paymentId: string,
    status: "VOIDED" | "REFUNDED", reason: string) {
    const actor = await this.actor(auth, branchId, ["OWNER", "MANAGER"]);
    const note = reason.trim();
    if (note.length < 3 || note.length > 500) throw new BadRequestException("DINING_REASON_REQUIRED");
    return this.transact(async tx => {
      const payment = await tx.diningPayment.findFirst({ where: { id: paymentId, branchId } });
      if (!payment) throw new NotFoundException("DINING_PAYMENT_NOT_FOUND");
      if (status === "REFUNDED") await this.lockForRefund(tx, branchId, payment.sessionId);
      else await this.lock(tx, branchId, payment.sessionId);
      if (payment.status === status) return { paymentId, status, replayed: true };
      if (payment.status !== (status === "VOIDED" ? "PENDING" : "CONFIRMED"))
        throw new ConflictException("DINING_PAYMENT_REVERSAL_INVALID");
      await tx.diningPayment.update({ where: { id: paymentId }, data: { status } });
      await tx.diningAuditEvent.create({ data: {
        branchId, sessionId: payment.sessionId, actorId: actor.id,
        action: status === "VOIDED" ? "QR_PAYMENT_VOIDED" : "PAYMENT_REFUNDED",
        details: { paymentId, method: payment.method, amountVnd: payment.amountVnd,
          beforeStatus: payment.status, afterStatus: status, reason: note },
      } });
      return { paymentId, status, replayed: false };
    });
  }

  async voidTicket(auth: string | undefined, branchId: string, ticketId: string,
    reason: string) {
    const actor = await this.actor(auth, branchId, ["OWNER", "MANAGER"]);
    const note = reason.trim();
    if (note.length < 3 || note.length > 500) throw new BadRequestException("DINING_REASON_REQUIRED");
    const result = await this.transact(async tx => {
      const ticket = await tx.diningTicket.findFirst({
        where: { id: ticketId, branchId }, select: { sessionId: true, status: true },
      });
      if (!ticket) throw new NotFoundException("DINING_TICKET_NOT_FOUND");
      await this.lock(tx, branchId, ticket.sessionId);
      const session = await tx.diningSession.findUniqueOrThrow({
        where: { id: ticket.sessionId }, select: { status: true },
      });
      if (session.status !== "OPEN") throw new ConflictException("DINING_CHECKOUT_ALREADY_STARTED");
      if (ticket.status === "CANCELED") return { ticketId, status: "CANCELED" as const,
        sessionId: ticket.sessionId, replayed: true };
      // Prepared/served dishes cannot be erased; owner can issue audited refunds separately.
      if (ticket.status !== "APPROVED") throw new ConflictException("DINING_TICKET_ALREADY_PREPARING");
      const items = await tx.diningTicketItem.findMany({
        where: { ticketId }, select: { id: true, productName: true, quantity: true,
          lineTotalVnd: true },
      });
      const before = await this.amounts(tx, branchId, ticket.sessionId);
      const removedVnd = items.reduce((n, x) => n + x.lineTotalVnd, 0);
      if (before.paidVnd > before.subtotalVnd - removedVnd)
        throw new ConflictException("DINING_REFUND_BEFORE_VOID");
      await tx.diningTicket.update({ where: { id: ticketId }, data: { status: "CANCELED" } });
      await tx.diningAuditEvent.create({ data: {
        branchId, sessionId: ticket.sessionId, actorId: actor.id, action: "TICKET_VOIDED",
        details: { ticketId, reason: note, beforeSubtotalVnd: before.subtotalVnd,
          afterSubtotalVnd: before.subtotalVnd - removedVnd, items },
      } });
      return { ticketId, status: "CANCELED" as const, replayed: false,
        sessionId: ticket.sessionId };
    });
    if (!result.replayed) await Promise.allSettled([this.realtime.publishDining({
      type: "dining.ticket", branchId, sessionId: result.sessionId,
      ticketId, status: "CANCELED",
    })]);
    return { ticketId: result.ticketId, status: result.status, replayed: result.replayed };
  }

  async cleaned(auth: string | undefined, branchId: string, tableId: string) {
    const actor = await this.actor(auth, branchId, ["OWNER", "MANAGER", "WAITER"]);
    return this.transact(async tx => {
      const table = await tx.diningTable.findFirst({ where: { id: tableId, branchId },
        select: { id: true, needsCleaning: true } });
      if (!table) throw new NotFoundException("DINING_TABLE_NOT_FOUND");
      const occupied = await tx.diningSession.findFirst({ where: {
        tableId, branchId, closedAt: null }, select: { id: true } });
      if (occupied) throw new ConflictException("DINING_TABLE_OCCUPIED");
      if (!table.needsCleaning) return { tableId, needsCleaning: false, replayed: true };
      const changed = await tx.diningTable.updateMany({
        where: { id: tableId, branchId, needsCleaning: true }, data: { needsCleaning: false },
      });
      if (changed.count !== 1) throw new ConflictException("DINING_TABLE_STALE");
      const previous = await tx.diningSession.findFirst({ where: { tableId, branchId,
        closedAt: { not: null } }, orderBy: { closedAt: "desc" }, select: { id: true } });
      if (previous) await tx.diningAuditEvent.create({ data: {
        branchId, sessionId: previous.id, actorId: actor.id, action: "TABLE_CLEANED",
        details: { tableId },
      } });
      return { tableId, needsCleaning: false, replayed: false };
    });
  }
}
