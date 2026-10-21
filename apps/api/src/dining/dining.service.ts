import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { priceCart, productSelect } from "../delivery/pricing";
import type { DiningAreaCreateInput, DiningAreaUpdateInput, DiningTableCreateInput,
  DiningTableUpdateInput, DiningTicketEditInput, DiningTicketInput } from "./dining.controller";

type Role = "OWNER" | "MANAGER" | "WAITER" | "CASHIER" | "KITCHEN";
type Actor = { id: string; role: Role };
const SERVER_ROLES: Role[] = ["OWNER", "MANAGER", "WAITER", "CASHIER", "KITCHEN"];
const ACTIVE_KITCHEN = ["APPROVED", "PREPARING", "READY", "SERVED"] as const;
const ticketSelect = {
  id: true, sessionId: true, source: true, status: true,
  createdAt: true, reviewedAt: true, customerNote: true, rejectionReason: true,
  items: { select: {
    id: true, productName: true, variantName: true,
    quantity: true, unitPriceVnd: true, lineTotalVnd: true,
    selectionSnapshot: true,
  } },
} as const satisfies Prisma.DiningTicketSelect;

function fingerprint(actor: string, items: DiningTicketInput["items"], note: string | null): string {
  return createHash("sha256").update(JSON.stringify({ actor, items: items.map(item => ({
    productId: item.productId, variantId: item.variantId ?? null,
    modifierIds: [...item.modifierIds].sort(),
    comboOptionIds: [...(item.comboOptionIds ?? [])].sort(),
    quantity: item.quantity, note: cleanNote(item.note) ?? null,
  })), note })).digest("hex");
}
function cleanNote(note?: string | null): string | null {
  if (note == null) return null;
  const normalized = note.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (Array.from(normalized).length > 500
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) {
    throw new BadRequestException("INVALID_DINING_NOTE");
  }
  return normalized || null;
}
function replayable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && ["P2034", "P2002"].includes(error.code);
}
/** Retry only entire Serializable transactions: no external side effects inside them. */
async function serializable<T>(
  db: PrismaService["database"],
  body: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let n = 0; n < 6; n++) {
    try {
      return await db.$transaction(body, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15_000,
      });
    } catch (error) {
      if (!replayable(error)) throw error;
      if (n === 5) throw new ConflictException("DINING_CONCURRENT_RETRY");
    }
  }
  throw new ConflictException("DINING_CONCURRENT_RETRY");
}

@Injectable()
export class DiningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private async staff(auth: string | undefined, branchId: string, allowed: readonly Role[]): Promise<Actor> {
    const principal = await this.auth.principal(auth);
    const branch = await this.prisma.database.branch.findUnique({
      where: { id: branchId }, select: { id: true },
    });
    if (!branch) throw new NotFoundException("DINING_BRANCH_NOT_FOUND");
    if (principal.role === "OWNER") {
      if (!allowed.includes("OWNER")) throw new ForbiddenException("DINING_ROLE_FORBIDDEN");
      return { id: principal.id, role: "OWNER" };
    }
    const membership = await this.prisma.database.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId: principal.id } },
      select: { role: true },
    });
    if (!membership || !SERVER_ROLES.includes(membership.role as Role)
      || !allowed.includes(membership.role as Role)) {
      throw new ForbiddenException("DINING_BRANCH_FORBIDDEN");
    }
    return { id: principal.id, role: membership.role as Role };
  }

  async areas(auth: string | undefined, branchId: string) {
    await this.staff(auth, branchId, SERVER_ROLES);
    return this.prisma.database.diningArea.findMany({
      where: { branchId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, sortOrder: true, isActive: true },
    });
  }

  async tables(auth: string | undefined, branchId: string) {
    await this.staff(auth, branchId, SERVER_ROLES);
    return this.prisma.database.diningTable.findMany({
      where: { branchId }, orderBy: [{ area: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: {
        id: true, code: true, name: true, areaId: true, isActive: true, sortOrder: true,
        sessions: { where: { closedAt: null }, take: 1,
          select: { id: true, status: true, guestCount: true, openedAt: true,
            _count: { select: { tickets: { where: { status: "PENDING_APPROVAL" } } } } } },
      },
    });
  }

  private cleanLabel(name: string): string {
    const cleaned = name.normalize("NFC").trim().replace(/\s+/g, " ");
    if (!cleaned || /[\u0000-\u001F\u007F]/u.test(cleaned)) {
      throw new BadRequestException("DINING_INVALID_NAME");
    }
    return cleaned;
  }

  async configuration(auth: string | undefined, branchId: string) {
    await this.staff(auth, branchId, ["OWNER", "MANAGER"]);
    const [areas, tables] = await Promise.all([
      this.prisma.database.diningArea.findMany({
        where: { branchId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, sortOrder: true, isActive: true },
      }),
      this.prisma.database.diningTable.findMany({
        where: { branchId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { id: true, areaId: true, code: true, name: true, sortOrder: true,
          qrHandle: true, isActive: true, sessions: {
            where: { closedAt: null }, select: { id: true }, take: 1 },
        },
      }),
    ]);
    return { areas, tables };
  }

  async createArea(auth: string | undefined, branchId: string, input: DiningAreaCreateInput) {
    await this.staff(auth, branchId, ["OWNER", "MANAGER"]);
    const name = this.cleanLabel(input.name);
    return this.prisma.database.diningArea.create({
      data: { branchId, name, sortOrder: input.sortOrder },
      select: { id: true, name: true, sortOrder: true, isActive: true },
    }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new ConflictException("DINING_AREA_EXISTS");
      throw error;
    });
  }

  async editArea(auth: string | undefined, branchId: string, areaId: string, input: DiningAreaUpdateInput) {
    await this.staff(auth, branchId, ["OWNER", "MANAGER"]);
    if (!Object.keys(input).length) throw new BadRequestException("DINING_NO_CHANGES");
    const name = input.name === undefined ? undefined : this.cleanLabel(input.name);
    try {
      return await serializable(this.prisma.database, async tx => {
        const area = await tx.diningArea.findFirst({
          where: { id: areaId, branchId }, select: { id: true, isActive: true },
        });
        if (!area) throw new NotFoundException("DINING_AREA_NOT_FOUND");
        if (input.isActive === false && area.isActive) {
          const active = await tx.diningSession.count({
            where: { branchId, table: { areaId }, closedAt: null },
          });
          if (active) throw new ConflictException("DINING_AREA_HAS_OPEN_TABLES");
        }
        await tx.diningArea.updateMany({
          where: { id: areaId, branchId },
          data: { ...(name !== undefined ? { name } : {}),
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) },
        });
        return tx.diningArea.findUniqueOrThrow({
          where: { id: areaId }, select: { id: true, name: true, sortOrder: true, isActive: true },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new ConflictException("DINING_AREA_EXISTS");
      throw error;
    }
  }

  async createTable(auth: string | undefined, branchId: string, input: DiningTableCreateInput) {
    await this.staff(auth, branchId, ["OWNER", "MANAGER"]);
    const name = this.cleanLabel(input.name);
    const code = this.cleanLabel(input.code).toUpperCase();
    const area = await this.prisma.database.diningArea.findFirst({
      where: { id: input.areaId, branchId, isActive: true }, select: { id: true },
    });
    if (!area) throw new NotFoundException("DINING_AREA_UNAVAILABLE");
    try {
      return await this.prisma.database.diningTable.create({
        data: { areaId: area.id, branchId, code, name, sortOrder: input.sortOrder,
          qrHandle: randomBytes(24).toString("base64url") },
        select: { id: true, areaId: true, code: true, name: true, sortOrder: true,
          qrHandle: true, isActive: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new ConflictException("DINING_TABLE_CODE_EXISTS");
      throw error;
    }
  }

  async editTable(auth: string | undefined, branchId: string, tableId: string, input: DiningTableUpdateInput) {
    await this.staff(auth, branchId, ["OWNER", "MANAGER"]);
    if (!Object.keys(input).length) throw new BadRequestException("DINING_NO_CHANGES");
    const name = input.name === undefined ? undefined : this.cleanLabel(input.name);
    const code = input.code === undefined ? undefined : this.cleanLabel(input.code).toUpperCase();
    try {
      return await serializable(this.prisma.database, async tx => {
        const table = await tx.diningTable.findFirst({
          where: { id: tableId, branchId }, select: { id: true, areaId: true, code: true, isActive: true },
        });
        if (!table) throw new NotFoundException("DINING_TABLE_NOT_FOUND");
        if (input.areaId !== undefined && input.areaId !== table.areaId) {
          const area = await tx.diningArea.findFirst({
            where: { id: input.areaId, branchId, isActive: true }, select: { id: true },
          });
          if (!area) throw new NotFoundException("DINING_AREA_UNAVAILABLE");
        }
        // Do not change the physical table identity/area or deactivate a live session.
        if ((input.areaId !== undefined && input.areaId !== table.areaId)
          || input.isActive === false || (code !== undefined && code !== table.code)) {
          const active = await tx.diningSession.count({
            where: { tableId, branchId, closedAt: null },
          });
          if (active) throw new ConflictException("DINING_TABLE_HAS_OPEN_SESSION");
        }
        await tx.diningTable.updateMany({
          where: { id: tableId, branchId },
          data: { ...(name !== undefined ? { name } : {}),
            ...(code !== undefined ? { code } : {}),
            ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
            ...(input.areaId !== undefined ? { areaId: input.areaId } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) },
        });
        return tx.diningTable.findUniqueOrThrow({
          where: { id: tableId },
          select: { id: true, areaId: true, name: true, code: true,
            sortOrder: true, isActive: true, qrHandle: true },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new ConflictException("DINING_TABLE_CODE_EXISTS");
      throw error;
    }
  }

  async rotateQr(auth: string | undefined, branchId: string, tableId: string) {
    const actor = await this.staff(auth, branchId, ["OWNER", "MANAGER"]);
    return serializable(this.prisma.database, async tx => {
      const table = await tx.diningTable.findFirst({
        where: { id: tableId, branchId }, select: { id: true, qrHandle: true },
      });
      if (!table) throw new NotFoundException("DINING_TABLE_NOT_FOUND");
      const active = await tx.diningSession.findFirst({
        where: { tableId, branchId, closedAt: null }, select: { id: true },
      });
      // Updating the session row serializes this operation with guest ticket creation.
      if (active) {
        const changed = await tx.diningSession.updateMany({
          where: { id: active.id, branchId, closedAt: null },
          data: { updatedAt: new Date() },
        });
        if (changed.count !== 1) throw new ConflictException("DINING_SESSION_CLOSED");
      }
      const handle = randomBytes(24).toString("base64url");
      await tx.diningTable.update({
        where: { id: tableId }, data: { qrHandle: handle },
      });
      if (active) {
        await tx.diningGuestGrant.updateMany({
          where: { sessionId: active.id, branchId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.diningTicket.updateMany({
          where: { sessionId: active.id, branchId,
            source: "QR", status: "PENDING_APPROVAL" },
          data: { status: "REJECTED", reviewedById: actor.id, reviewedAt: new Date(),
            rejectionReason: "QR_ROTATED" },
        });
        await tx.diningAuditEvent.create({ data: {
          branchId, sessionId: active.id, actorId: actor.id,
          action: "QR_ROTATED", details: { tableId },
        } });
      }
      return { tableId, qrHandle: handle, oldHandleRevoked: true };
    });
  }

  async open(auth: string | undefined, branchId: string, tableId: string, guestCount?: number) {
    const actor = await this.staff(auth, branchId, ["OWNER", "MANAGER", "WAITER"]);
    if (guestCount != null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 100)) {
      throw new BadRequestException("DINING_GUEST_COUNT_INVALID");
    }
    try {
      return await serializable(this.prisma.database, async tx => {
        const table = await tx.diningTable.findFirst({
          where: { id: tableId, branchId, isActive: true, area: { isActive: true },
            branch: { isActive: true } }, select: { id: true },
        });
        if (!table) throw new NotFoundException("DINING_TABLE_UNAVAILABLE");
        const existing = await tx.diningSession.findFirst({
          where: { tableId, branchId, closedAt: null }, select: { id: true },
        });
        if (existing) throw new ConflictException("DINING_TABLE_OCCUPIED");
        const session = await tx.diningSession.create({
          data: { branchId, tableId, openedById: actor.id, ...(guestCount != null ? { guestCount } : {}) },
          select: { id: true, branchId: true, tableId: true, status: true, openedAt: true },
        });
        await tx.diningAuditEvent.create({ data: {
          branchId, sessionId: session.id, actorId: actor.id,
          action: "SESSION_OPENED", details: { guestCount: guestCount ?? null },
        } });
        return session;
      });
    } catch (error) {
      if (error instanceof ConflictException && error.message === "DINING_CONCURRENT_RETRY")
        throw new ConflictException("DINING_TABLE_OCCUPIED");
      throw error;
    }
  }

  async close(auth: string | undefined, branchId: string, sessionId: string) {
    const actor = await this.staff(auth, branchId, ["OWNER", "MANAGER", "CASHIER"]);
    return serializable(this.prisma.database, async tx => {
      const session = await tx.diningSession.findFirst({
        where: { id: sessionId, branchId }, select: { status: true, closedAt: true },
      });
      if (!session) throw new NotFoundException("DINING_SESSION_NOT_FOUND");
      if (session.closedAt) throw new ConflictException("DINING_SESSION_CLOSED");
      // L07 settlement may add payment flows; never let close erase an unpaid bill.
      const [eligible, paid] = await Promise.all([
        tx.diningTicketItem.aggregate({
          where: { ticket: { sessionId, branchId, status: { in: [...ACTIVE_KITCHEN] } } },
          _sum: { lineTotalVnd: true },
        }),
        tx.diningPayment.aggregate({
          where: { sessionId, branchId, status: "CONFIRMED" },
          _sum: { amountVnd: true },
        }),
      ]);
      if ((eligible._sum.lineTotalVnd ?? 0) > (paid._sum.amountVnd ?? 0)) {
        throw new ConflictException("DINING_BILL_UNPAID");
      }
      const closed = await tx.diningSession.updateMany({
        where: { id: sessionId, branchId, closedAt: null },
        data: { status: "CLOSED", closedAt: new Date(), closedById: actor.id },
      });
      if (closed.count !== 1) throw new ConflictException("DINING_SESSION_CLOSED");
      await tx.diningGuestGrant.updateMany({
        where: { sessionId, branchId, revokedAt: null }, data: { revokedAt: new Date() },
      });
      await tx.diningTicket.updateMany({
        where: { sessionId, branchId, status: "PENDING_APPROVAL" },
        data: { status: "REJECTED", reviewedById: actor.id, reviewedAt: new Date(),
          rejectionReason: "SESSION_CLOSED" },
      });
      await tx.diningAuditEvent.create({ data: {
        branchId, sessionId, actorId: actor.id, action: "SESSION_CLOSED", details: {},
      } });
      return { sessionId, status: "CLOSED" as const };
    });
  }

  async transfer(auth: string | undefined, branchId: string, sessionId: string, expectedTableId: string, targetTableId: string) {
    const actor = await this.staff(auth, branchId, ["OWNER", "MANAGER", "WAITER"]);
    return serializable(this.prisma.database, async tx => {
      const session = await tx.diningSession.findFirst({
        where: { id: sessionId, branchId }, select: { tableId: true, status: true, closedAt: true },
      });
      if (!session || session.status !== "OPEN" || session.closedAt)
        throw new ConflictException("DINING_SESSION_NOT_OPEN");
      if (session.tableId !== expectedTableId) throw new ConflictException("DINING_TABLE_MOVED");
      if (session.tableId === targetTableId)
        return { sessionId, tableId: targetTableId, replayed: true };
      const destination = await tx.diningTable.findFirst({ where: {
        id: targetTableId, branchId, isActive: true, area: { isActive: true },
      }, select: { id: true } });
      if (!destination) throw new NotFoundException("DINING_TABLE_UNAVAILABLE");
      const occupied = await tx.diningSession.findFirst({
        where: { tableId: targetTableId, closedAt: null }, select: { id: true },
      });
      if (occupied) throw new ConflictException("DINING_TABLE_OCCUPIED");
      const moved = await tx.diningSession.updateMany({
        where: { id: sessionId, branchId, tableId: session.tableId, status: "OPEN", closedAt: null },
        data: { tableId: targetTableId },
      });
      if (moved.count !== 1) throw new ConflictException("DINING_SESSION_MOVED");
      await tx.diningGuestGrant.updateMany({
        where: { sessionId, branchId, revokedAt: null }, data: { revokedAt: new Date() },
      });
      // Old printed QR/guest credentials must not keep submitting after reassignment.
      await tx.diningTicket.updateMany({
        where: { sessionId, branchId, source: "QR", status: "PENDING_APPROVAL" },
        data: { status: "REJECTED", reviewedAt: new Date(), reviewedById: actor.id,
          rejectionReason: "TABLE_TRANSFERRED" },
      });
      await tx.diningAuditEvent.create({ data: {
        branchId, sessionId, actorId: actor.id,
        action: "TABLE_TRANSFERRED", details: { fromTableId: session.tableId, toTableId: targetTableId },
      } });
      return { sessionId, tableId: targetTableId, replayed: false };
    });
  }

  async editPending(auth: string | undefined, branchId: string, ticketId: string,
    input: DiningTicketEditInput) {
    const actor = await this.staff(auth, branchId, ["OWNER", "MANAGER", "WAITER"]);
    return serializable(this.prisma.database, async tx => {
      const ticket = await tx.diningTicket.findFirst({
        where: { id: ticketId, branchId, source: "QR" },
        select: { id: true, sessionId: true, status: true, updatedAt: true, customerNote: true },
      });
      if (!ticket) throw new NotFoundException("DINING_TICKET_NOT_FOUND");
      if (ticket.status !== "PENDING_APPROVAL")
        throw new ConflictException("DINING_TICKET_ALREADY_REVIEWED");
      if (ticket.updatedAt.toISOString() !== input.expectedUpdatedAt)
        throw new ConflictException("DINING_TICKET_STALE");
      const locked = await tx.diningSession.updateMany({
        where: { id: ticket.sessionId, branchId, status: "OPEN", closedAt: null },
        data: { updatedAt: new Date() },
      });
      if (locked.count !== 1) throw new ConflictException("DINING_SESSION_NOT_OPEN");
      const old = await tx.diningTicketItem.aggregate({
        where: { ticketId }, _sum: { lineTotalVnd: true },
      });
      const products = await tx.product.findMany({
        where: { id: { in: [...new Set(input.items.map(x => x.productId))] },
          category: { branchId, isPublished: true } },
        select: productSelect,
      });
      const price = priceCart(input.items.map(x => ({
        productId: x.productId, variantId: x.variantId ?? null,
        modifierIds: x.modifierIds, comboOptionIds: x.comboOptionIds ?? [], quantity: x.quantity,
      })), products);
      const changed = await tx.diningTicket.updateMany({
        where: { id: ticketId, branchId, status: "PENDING_APPROVAL", updatedAt: ticket.updatedAt },
        data: { customerNote: input.customerNote === undefined
          ? ticket.customerNote : cleanNote(input.customerNote) },
      });
      if (changed.count !== 1) throw new ConflictException("DINING_TICKET_STALE");
      await tx.diningTicketItem.deleteMany({ where: { ticketId } });
      await tx.diningTicketItem.createMany({ data: price.lines.map((line, index) => ({
        ticketId, productId: line.productId, variantId: line.variantId,
        productName: line.productName, variantName: line.variantName,
        quantity: line.quantity, unitPriceVnd: line.unitPriceVnd,
        lineTotalVnd: line.lineTotalVnd,
        selectionSnapshot: JSON.parse(JSON.stringify({
          pricingMode: line.pricingMode, modifiers: line.modifiers,
          comboItems: line.comboItems, note: cleanNote(input.items[index]?.note),
        })) as Prisma.InputJsonValue,
      })) });
      await tx.diningAuditEvent.create({ data: {
        branchId, sessionId: ticket.sessionId, actorId: actor.id,
        action: "QR_TICKET_EDITED",
        details: { ticketId, oldTotalVnd: old._sum.lineTotalVnd ?? 0,
          newTotalVnd: price.subtotalVnd },
      } });
      const updated = await tx.diningTicket.findUniqueOrThrow({
        where: { id: ticketId }, select: { updatedAt: true },
      });
      return { ticketId, status: "PENDING_APPROVAL" as const, updatedAt: updated.updatedAt };
    });
  }

  async locator(qrHandle: string) {
    if (!/^[a-zA-Z0-9_-]{16,64}$/.test(qrHandle)) throw new NotFoundException("DINING_QR_NOT_FOUND");
    const table = await this.prisma.database.diningTable.findUnique({
      where: { qrHandle }, select: { name: true, code: true, isActive: true,
        area: { select: { name: true, isActive: true } },
        branch: { select: { name: true, isActive: true } } },
    });
    if (!table || !table.isActive || !table.branch.isActive || !table.area.isActive)
      throw new NotFoundException("DINING_QR_NOT_FOUND");
    return { table: table.name, code: table.code, area: table.area.name,
      branch: table.branch.name };
  }

  async issueGrant(qrHandle: string) {
    if (!/^[a-zA-Z0-9_-]{16,64}$/.test(qrHandle)) throw new NotFoundException("DINING_QR_NOT_FOUND");
    return serializable(this.prisma.database, async tx => {
      const table = await tx.diningTable.findUnique({
        where: { qrHandle }, select: { id: true, branchId: true, isActive: true,
          area: { select: { isActive: true } }, branch: { select: { isActive: true } } },
      });
      if (!table?.isActive || !table.area.isActive || !table.branch.isActive)
        throw new NotFoundException("DINING_QR_NOT_FOUND");
      const session = await tx.diningSession.findFirst({
        where: { tableId: table.id, branchId: table.branchId, status: "OPEN", closedAt: null },
        select: { id: true },
      });
      if (!session) throw new ConflictException("DINING_TABLE_NOT_OPEN");
      // Update session row to serialize grant issuance with close and other issuances.
      const locked = await tx.diningSession.updateMany({
        where: { id: session.id, status: "OPEN", closedAt: null }, data: { updatedAt: new Date() },
      });
      if (locked.count !== 1) throw new ConflictException("DINING_SESSION_CLOSED");
      const recent = await tx.diningGuestGrant.count({
        where: { sessionId: session.id, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
      });
      if (recent >= 20) throw new ConflictException("DINING_GUEST_GRANT_LIMIT");
      const credential = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 15 * 60_000);
      await tx.diningGuestGrant.create({ data: {
        branchId: table.branchId, sessionId: session.id,
        tokenHash: createHash("sha256").update(credential).digest("hex"), expiresAt,
      } });
      // Only the caller gets the opaque credential. It must live in memory / secure app state,
      // never in QR URL, analytics, query params, audit event, or database as plaintext.
      return { credential, expiresAt, sessionId: session.id };
    });
  }

  private async guest(authorization: string | undefined) {
    const credential = authorization?.match(/^Dining ([A-Za-z0-9_-]{40,128})$/)?.[1];
    if (!credential) throw new UnauthorizedException("DINING_GUEST_AUTH_REQUIRED");
    const tokenHash = createHash("sha256").update(credential).digest("hex");
    const grant = await this.prisma.database.diningGuestGrant.findUnique({
      where: { tokenHash }, select: { id: true, branchId: true, sessionId: true,
        revokedAt: true, expiresAt: true,
        session: { select: { status: true, closedAt: true } } },
    });
    if (!grant || grant.revokedAt || grant.expiresAt.getTime() <= Date.now()
      || grant.session.status !== "OPEN" || grant.session.closedAt) {
      throw new UnauthorizedException("DINING_GUEST_EXPIRED");
    }
    return grant;
  }

  private async submit(sessionId: string, branchId: string, source: "QR" | "STAFF",
    actorId: string, guestGrantId: string | null, input: DiningTicketInput) {
    const note = cleanNote(input.customerNote);
    const hash = fingerprint(actorId, input.items, note);
    const key = { sessionId, source, idempotencyKey: input.idempotencyKey };
    return serializable(this.prisma.database, async tx => {
      const previous = await tx.diningTicket.findUnique({
        where: { sessionId_source_idempotencyKey: key }, select: {
          id: true, requestHash: true, createdById: true, guestGrantId: true, status: true,
        },
      });
      if (previous) {
        if (previous.requestHash !== hash
          || (source === "STAFF" ? previous.createdById !== actorId : previous.guestGrantId !== guestGrantId)) {
          throw new ConflictException("DINING_IDEMPOTENCY_REUSED");
        }
        return { ticketId: previous.id, status: previous.status, replayed: true };
      }
      const changed = await tx.diningSession.updateMany({
        where: { id: sessionId, branchId, status: "OPEN", closedAt: null },
        data: { updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException("DINING_SESSION_NOT_OPEN");
      if (source === "QR") {
        const valid = await tx.diningGuestGrant.findFirst({ where: {
          id: guestGrantId!, sessionId, branchId,
          revokedAt: null, expiresAt: { gt: new Date() },
        }, select: { id: true } });
        if (!valid) throw new UnauthorizedException("DINING_GUEST_EXPIRED");
        const [guestCount, tableCount] = await Promise.all([
          tx.diningTicket.count({ where: { guestGrantId, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } }),
          tx.diningTicket.count({ where: { sessionId, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } }),
        ]);
        if (guestCount >= 20 || tableCount >= 120) throw new ConflictException("DINING_TICKET_RATE_LIMIT");
      }
      const products = await tx.product.findMany({
        where: { id: { in: [...new Set(input.items.map(x => x.productId))] },
          category: { branchId, isPublished: true } },
        select: productSelect,
      });
      const price = priceCart(input.items.map(x => ({
        productId: x.productId, variantId: x.variantId ?? null,
        modifierIds: x.modifierIds, comboOptionIds: x.comboOptionIds ?? [], quantity: x.quantity,
      })), products);
      // Price and snapshot are computed exclusively inside the transaction.
      const ticket = await tx.diningTicket.create({
        data: {
          branchId, sessionId, source, idempotencyKey: input.idempotencyKey,
          requestHash: hash, customerNote: note,
          guestGrantId, createdById: source === "STAFF" ? actorId : null,
          status: source === "QR" ? "PENDING_APPROVAL" : "APPROVED",
          items: { create: price.lines.map((line, index) => ({
            productId: line.productId, variantId: line.variantId,
            productName: line.productName, variantName: line.variantName,
            quantity: line.quantity, unitPriceVnd: line.unitPriceVnd,
            lineTotalVnd: line.lineTotalVnd,
            selectionSnapshot: JSON.parse(JSON.stringify({
              pricingMode: line.pricingMode, modifiers: line.modifiers,
              comboItems: line.comboItems, note: cleanNote(input.items[index]?.note),
            })) as Prisma.InputJsonValue,
          })) },
        },
        select: { id: true, status: true },
      });
      await tx.diningAuditEvent.create({ data: {
        branchId, sessionId, actorId: source === "STAFF" ? actorId : null,
        action: source === "QR" ? "QR_TICKET_PENDING" : "STAFF_TICKET_APPROVED",
        details: { ticketId: ticket.id, source, subtotalVnd: price.subtotalVnd },
      } });
      // Kitchen work-item identity is ticket.id itself. Pending QR is never eligible.
      // A future realtime publisher must observe committed APPROVED rows, not create another order.
      return { ticketId: ticket.id, status: ticket.status, replayed: false };
    });
  }

  async staffTicket(auth: string | undefined, branchId: string, sessionId: string, input: DiningTicketInput) {
    const actor = await this.staff(auth, branchId, ["OWNER", "MANAGER", "WAITER"]);
    return this.submit(sessionId, branchId, "STAFF", actor.id, null, input);
  }

  async guestTicket(authorization: string | undefined, input: DiningTicketInput) {
    const grant = await this.guest(authorization);
    return this.submit(grant.sessionId, grant.branchId, "QR", grant.id, grant.id, input);
  }

  async guestTickets(authorization: string | undefined) {
    const grant = await this.guest(authorization);
    return this.prisma.database.diningTicket.findMany({
      where: { sessionId: grant.sessionId, branchId: grant.branchId, guestGrantId: grant.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: ticketSelect,
    });
  }

  private async bill(sessionId: string, branchId: string, includePending: boolean) {
    const session = await this.prisma.database.diningSession.findFirst({
      where: { id: sessionId, branchId },
      select: { id: true, tableId: true, status: true, guestCount: true, openedAt: true,
        tickets: { orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          where: includePending ? {} : { status: { in: [...ACTIVE_KITCHEN] } },
          select: ticketSelect },
        payments: { where: { status: "CONFIRMED" }, select: { amountVnd: true } },
      },
    });
    if (!session) throw new NotFoundException("DINING_SESSION_NOT_FOUND");
    const subtotalVnd = session.tickets.filter(t => ACTIVE_KITCHEN.some(s => s === t.status))
      .reduce((sum, ticket) => sum + ticket.items.reduce((s, line) => s + line.lineTotalVnd, 0), 0);
    const paidVnd = session.payments.reduce((s, p) => s + p.amountVnd, 0);
    return { ...session, payments: undefined, subtotalVnd, paidVnd,
      dueVnd: Math.max(0, subtotalVnd - paidVnd) };
  }

  async staffBill(auth: string | undefined, branchId: string, sessionId: string) {
    await this.staff(auth, branchId, ["OWNER", "MANAGER", "WAITER", "CASHIER"]);
    return this.bill(sessionId, branchId, true);
  }

  async guestBill(authorization: string | undefined) {
    const grant = await this.guest(authorization);
    return this.bill(grant.sessionId, grant.branchId, false);
  }

  async approvals(auth: string | undefined, branchId: string) {
    await this.staff(auth, branchId, ["OWNER", "MANAGER", "WAITER"]);
    return this.prisma.database.diningTicket.findMany({
      where: { branchId, status: "PENDING_APPROVAL", source: "QR",
        session: { closedAt: null, status: "OPEN" } },
      take: 100, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { ...ticketSelect, session: { select: {
        table: { select: { code: true, name: true, areaId: true } },
      } } },
    });
  }

  async review(auth: string | undefined, branchId: string, ticketId: string,
    decision: "APPROVED" | "REJECTED", reason?: string) {
    const actor = await this.staff(auth, branchId, ["OWNER", "MANAGER", "WAITER"]);
    const cleanReason = decision === "REJECTED" ? cleanNote(reason) : null;
    if (decision === "REJECTED" && (!cleanReason || cleanReason.length < 3))
      throw new BadRequestException("DINING_REJECTION_REASON_REQUIRED");
    return serializable(this.prisma.database, async tx => {
      const ticket = await tx.diningTicket.findFirst({
        where: { id: ticketId, branchId, source: "QR" },
        select: { id: true, sessionId: true, status: true },
      });
      if (!ticket) throw new NotFoundException("DINING_TICKET_NOT_FOUND");
      if (ticket.status !== "PENDING_APPROVAL") {
        if (ticket.status === decision) return { ticketId, status: decision, replayed: true };
        throw new ConflictException("DINING_TICKET_ALREADY_REVIEWED");
      }
      const locked = await tx.diningSession.updateMany({
        where: { id: ticket.sessionId, branchId, status: "OPEN", closedAt: null },
        data: { updatedAt: new Date() },
      });
      if (locked.count !== 1) throw new ConflictException("DINING_SESSION_NOT_OPEN");
      const updated = await tx.diningTicket.updateMany({
        where: { id: ticketId, branchId, source: "QR", status: "PENDING_APPROVAL" },
        data: { status: decision, reviewedById: actor.id, reviewedAt: new Date(),
          rejectionReason: cleanReason },
      });
      if (updated.count !== 1) throw new ConflictException("DINING_TICKET_ALREADY_REVIEWED");
      await tx.diningAuditEvent.create({ data: {
        branchId, sessionId: ticket.sessionId, actorId: actor.id,
        action: decision === "APPROVED" ? "QR_TICKET_APPROVED" : "QR_TICKET_REJECTED",
        details: { ticketId, reason: cleanReason },
      } });
      return { ticketId, status: decision, replayed: false };
    });
  }

  async kitchen(auth: string | undefined, branchId: string) {
    await this.staff(auth, branchId, ["OWNER", "MANAGER", "WAITER", "KITCHEN"]);
    // Ticket.id is the only kitchen work-item identifier. Never expose
    // bill prices, payment information, actor identity, or QR grants to KITCHEN.
    const tickets = await this.prisma.database.diningTicket.findMany({
      where: { branchId, status: { in: [...ACTIVE_KITCHEN] } },
      take: 100, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, status: true, createdAt: true, customerNote: true,
        session: { select: { table: { select: { code: true, name: true } } } },
        items: { select: { productName: true, variantName: true, quantity: true,
          selectionSnapshot: true } } },
    });
    return tickets.map(ticket => ({
      ...ticket, items: ticket.items.map(item => {
        const snap = item.selectionSnapshot as {
          modifiers?: { name?: string }[];
          comboItems?: { productName?: string; variantName?: string | null; quantity?: number }[];
          note?: string | null;
        } | null;
        return {
          productName: item.productName, variantName: item.variantName,
          quantity: item.quantity, note: snap?.note ?? null,
          modifiers: (snap?.modifiers ?? []).map(option => ({ name: option.name ?? "" })),
          comboItems: (snap?.comboItems ?? []).map(option => ({
            productName: option.productName ?? "", variantName: option.variantName ?? null,
            quantity: option.quantity ?? 1,
          })),
        };
      }),
    }));
  }
}
