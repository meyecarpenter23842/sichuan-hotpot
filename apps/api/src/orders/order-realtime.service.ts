import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { AuthService } from "../auth/auth.service";
import { allowedCorsOrigins } from "../bootstrap";
import { PrismaService } from "../database/prisma.service";


type Status = "PENDING" | "CONFIRMED" | "PREPARING" | "READY" |
  "DELIVERING" | "DELIVERED" | "CANCELED" | "DELIVERY_FAILED";
export interface OrderChange {
  type: "order.created" | "order.status" | "order.updated" | "order.overdue";
  orderId: string; branchId: string; customerId: string; status: Status;
}

// ws is an explicit production dependency. These are the minimal server interfaces
// needed here; the Android/PWA clients use their platform WebSocket implementation.
interface Socket {
  readyState: number;
  on(event: "message", cb: (payload: unknown) => void): void;
  on(event: "pong" | "close" | "error", cb: () => void): void;
  send(value: string): void;
  ping(): void;
  close(code?: number): void;
  terminate(): void;
}
interface SocketServer {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, cb: (socket: Socket) => void): void;
  close(): void;
}
const SocketServerCtor = (require("ws") as {
  Server: new (options: { noServer: boolean; maxPayload: number; perMessageDeflate: boolean }) => SocketServer;
}).Server;
type Subscription = { authorization: string; actorId: string; role: string; branchId?: string;
  sessionId?: string; grantId?: string };
export interface DiningChange {
  type: "dining.pending" | "dining.ticket" | "dining.kitchen";
  branchId: string; sessionId: string; ticketId: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PREPARING" | "READY" | "SERVED";
}
type Client = { socket: Socket; subscription: Subscription | null; alive: boolean; lastAuth: number };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Transport-only realtime hints: no order contents, addresses, phone numbers or prices.
 * HTTP and PostgreSQL are authoritative; all clients re-fetch on connect and hints.
 * Single VPS API process; multi-instance deployments need a shared event bus.
 */
@Injectable()
export class OrderRealtimeService implements OnModuleDestroy {
  private readonly server: SocketServer = new SocketServerCtor({
    noServer: true, maxPayload: 2048, perMessageDeflate: false,
  });
  private readonly clients = new Set<Client>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private overdueTimer?: ReturnType<typeof setInterval>;
  private readonly overdueSent = new Map<string, number>();

  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  attach(server: Server): void {
    const origins = allowedCorsOrigins();
    server.on("upgrade", (req, socket, head) => {
      if (req.url?.split("?")[0] !== "/realtime") {
        socket.destroy(); return;
      }
      // Browser Origin is mandatory and must be allowlisted. Native clients
      // normally omit Origin and still authenticate using the first message.
      const origin = req.headers.origin;
      if ((origin && !origins.has(origin)) || this.clients.size >= 300) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy(); return;
      }
      this.server.handleUpgrade(req, socket, head, ws => this.connected(ws));
    });
    this.heartbeat = setInterval(() => this.ping(), 30000);
    this.heartbeat.unref?.();
    this.overdueTimer = setInterval(() => { void this.remindOverdue(); }, 60000);
    this.overdueTimer.unref?.();
  }

  private connected(socket: Socket): void {
    const client: Client = { socket, subscription: null, alive: true, lastAuth: 0 };
    this.clients.add(client);
    const deadline = setTimeout(() => {
      if (!client.subscription) socket.close(1008);
    }, 5000);
    deadline.unref?.();
    socket.on("pong", () => { client.alive = true; });
    socket.on("error", () => this.clients.delete(client));
    socket.on("close", () => { clearTimeout(deadline); this.clients.delete(client); });
    socket.on("message", payload => {
      if (client.subscription) { socket.close(1008); return; }
      void this.subscribe(client, payload).then(() => clearTimeout(deadline))
        .catch(() => socket.close(1008));
    });
  }

  private async subscribe(client: Client, payload: unknown): Promise<void> {
    const raw = typeof payload === "string" ? payload
      : Buffer.isBuffer(payload) ? payload.toString("utf8") : "";
    if (raw.length > 2048) throw new Error("BAD_SUBSCRIBE");
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== "object") throw new Error("BAD_SUBSCRIBE");
    const value = input as Record<string, unknown>;
    if (value.type !== "subscribe" || typeof value.token !== "string" ||
      value.token.length < 10 || value.token.length > 4096 ||
      !["staff", "customer", "dining_guest"].includes(String(value.scope))) {
      throw new Error("BAD_SUBSCRIBE");
    }
    if (value.scope === "dining_guest") {
      if (!/^[A-Za-z0-9_-]{40,128}$/.test(value.token)) throw new Error("BAD_GUEST_GRANT");
      const tokenHash = createHash("sha256").update(value.token).digest("hex");
      const grant = await this.prisma.database.diningGuestGrant.findUnique({
        where: { tokenHash },
        select: { id: true, branchId: true, sessionId: true, expiresAt: true,
          revokedAt: true, session: { select: { status: true, closedAt: true } } },
      });
      if (!grant || grant.revokedAt || grant.expiresAt.getTime() <= Date.now()
        || grant.session.status !== "OPEN" || grant.session.closedAt) {
        throw new Error("GUEST_GRANT_EXPIRED");
      }
      client.subscription = { authorization: value.token, actorId: grant.id,
        role: "DINING_GUEST", branchId: grant.branchId,
        sessionId: grant.sessionId, grantId: grant.id };
      client.lastAuth = Date.now();
      if (client.socket.readyState === 1) client.socket.send(JSON.stringify({ type: "ready" }));
      return;
    }
    const authorization = "Bearer " + value.token;
    const principal = await this.auth.principal(authorization);
    if (value.scope === "staff") {
      if (typeof value.branchId !== "string" || !uuid.test(value.branchId)) {
        throw new Error("BAD_BRANCH");
      }
      const staff = await this.authorizeStaff(authorization, value.branchId);
      client.subscription = {
        authorization, actorId: staff.actorId, role: staff.role, branchId: value.branchId,
      };
    } else {
      if (principal.role !== "CUSTOMER") throw new Error("CUSTOMER_REQUIRED");
      client.subscription = { authorization, actorId: principal.id, role: "CUSTOMER" };
    }
    client.lastAuth = Date.now();
    if (client.socket.readyState === 1) {
      client.socket.send(JSON.stringify({ type: "ready" }));
    }
  }

  private async authorizeStaff(authorization: string, branchId: string) {
    const principal = await this.auth.principal(authorization);
    const branch = await this.prisma.database.branch.findUnique({
      where: { id: branchId }, select: { id: true },
    });
    if (!branch) throw new Error("BRANCH_NOT_FOUND");
    if (principal.role === "OWNER") return { actorId: principal.id, role: "OWNER" };
    const membership = await this.prisma.database.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId: principal.id } },
      select: { role: true },
    });
    if (!membership || !["OWNER", "MANAGER", "KITCHEN", "DRIVER", "WAITER", "CASHIER"].includes(membership.role)) {
      throw new Error("BRANCH_FORBIDDEN");
    }
    return { actorId: principal.id, role: membership.role };
  }

  private ping(): void {
    for (const client of this.clients) {
      if (!client.alive) { client.socket.terminate(); this.clients.delete(client); continue; }
      client.alive = false;
      if (client.socket.readyState === 1) client.socket.ping();
    }
  }

  async publish(change: OrderChange): Promise<void> {
    const message = JSON.stringify({
      type: change.type, eventId: randomUUID(), orderId: change.orderId,
      branchId: change.branchId, status: change.status, at: new Date().toISOString(),
    });
    await Promise.all([...this.clients].map(async client => {
      const subscription = client.subscription;
      if (!subscription || client.socket.readyState !== 1) return;
      if (subscription.role === "DINING_GUEST") return;
      if (subscription.role === "CUSTOMER") {
        if (subscription.actorId !== change.customerId || change.type === "order.overdue") return;
      } else {
        if (subscription.branchId !== change.branchId) return;
        if (["WAITER", "CASHIER"].includes(subscription.role)) return;
        if (subscription.role === "KITCHEN" && change.status === "PENDING") return;
        if (subscription.role === "DRIVER" && change.type === "order.overdue") return;
      }
      try {
        // Revoked sessions and changed branch memberships must not retain access.
        const current = await this.auth.principal(subscription.authorization);
        if (current.id !== subscription.actorId) throw new Error("SESSION_CHANGED");
        if (subscription.role !== "CUSTOMER") {
          const staff = await this.authorizeStaff(subscription.authorization, change.branchId);
          if (staff.actorId !== subscription.actorId) throw new Error("ROLE_CHANGED");
          if (["WAITER", "CASHIER"].includes(staff.role)) return;
           if (staff.role === "KITCHEN" && change.status === "PENDING") return;
          if (staff.role === "DRIVER") {
            // Assignment may be revoked at any time. Never stream even order IDs
            // from other customers/branches to unassigned delivery personnel.
            const assigned = await this.prisma.database.deliveryAssignment.findFirst({
              where: { orderId: change.orderId, driverId: subscription.actorId },
              select: { id: true },
            });
            if (!assigned) return;
          }
        }
        if (client.socket.readyState === 1) client.socket.send(message);
      } catch {
        client.socket.close(1008);
      }
    }));
  }

  /** No prices/phone/customer fields ever traverse realtime; database remains authoritative. */
  async publishDining(change: DiningChange): Promise<void> {
    const staffHint = JSON.stringify({ ...change, eventId: randomUUID() });
    const guestHint = JSON.stringify({ type: "dining.changed", branchId: change.branchId,
      sessionId: change.sessionId, eventId: randomUUID() });
    await Promise.all([...this.clients].map(async client => {
      const sub = client.subscription;
      if (!sub || client.socket.readyState !== 1 || sub.branchId !== change.branchId) return;
      try {
        if (sub.role === "DINING_GUEST") {
          if (sub.sessionId !== change.sessionId || !sub.grantId) return;
          const grant = await this.prisma.database.diningGuestGrant.findFirst({
            where: { id: sub.grantId, sessionId: change.sessionId, branchId: change.branchId,
              revokedAt: null, expiresAt: { gt: new Date() },
              session: { status: "OPEN", closedAt: null } },
            select: { id: true },
          });
          if (!grant) { client.socket.close(1008); return; }
          if (client.socket.readyState === 1) client.socket.send(guestHint);
          return;
        }
        if (sub.role === "CUSTOMER" || sub.role === "DRIVER") return;
        if (sub.role === "KITCHEN" && change.status === "PENDING_APPROVAL") return;
        if (sub.role === "CASHIER" && change.status === "PENDING_APPROVAL") return;
        const current = await this.auth.principal(sub.authorization);
        if (current.id !== sub.actorId) throw new Error("SESSION_CHANGED");
        const staff = await this.authorizeStaff(sub.authorization, change.branchId);
        if (staff.actorId !== sub.actorId) throw new Error("ROLE_CHANGED");
        if (staff.role === "DRIVER" || staff.role === "CASHIER"
          || (staff.role === "KITCHEN" && change.status === "PENDING_APPROVAL")) return;
        if (client.socket.readyState === 1) client.socket.send(staffHint);
      } catch { client.socket.close(1008); }
    }));
  }

  private async remindOverdue(): Promise<void> {
    try {
      const overdue = await this.prisma.database.order.findMany({
        where: { status: "PENDING", createdAt: { lte: new Date(Date.now() - 5 * 60000) } },
        select: { id: true, branchId: true, customerId: true }, take: 200,
        orderBy: { createdAt: "asc" },
      });
      const now = Date.now();
      for (const row of overdue) {
        if (now - (this.overdueSent.get(row.id) ?? 0) < 5 * 60000) continue;
        this.overdueSent.set(row.id, now);
        await this.publish({
          type: "order.overdue", orderId: row.id, branchId: row.branchId,
          customerId: row.customerId, status: "PENDING",
        });
      }
      for (const [id, time] of this.overdueSent) {
        if (now - time > 3600000 || this.overdueSent.size > 1000) this.overdueSent.delete(id);
      }
    } catch {
      // Database outage never interrupts order writes; HTTP sync remains available.
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.overdueTimer) clearInterval(this.overdueTimer);
    for (const client of this.clients) client.socket.close(1001);
    this.clients.clear();
    this.server.close();
  }
}
