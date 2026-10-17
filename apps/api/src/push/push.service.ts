import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { PushScope, PushTransport } from "@prisma/client";
import { GoogleAuth } from "google-auth-library";
import webpush from "web-push";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";

export interface PushRegistration {
  scope: PushScope;
  transport: PushTransport;
  token: string;
  branchId?: string | null;
  p256dh?: string | null;
  auth?: string | null;
}

type PushPayload = {
  title: string;
  body: string;
  kind: "NEW_ORDER" | "ORDER_CONFIRMED";
  orderId: string;
  url: string;
};

const STAFF_ROLES = ["OWNER", "MANAGER"] as const;
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

@Injectable()
export class PushService {
  private fcmAuth: GoogleAuth | null | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  publicConfig() {
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || null;
    const configured = Boolean(
      publicKey
      && process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim()
      && process.env.WEB_PUSH_VAPID_SUBJECT?.trim(),
    );
    return { enabled: configured, publicKey: configured ? publicKey : null };
  }

  private async authorizeRegistration(
    authorization: string | undefined,
    input: PushRegistration,
  ): Promise<{ userId: string; branchId: string | null }> {
    const principal = await this.authService.principal(authorization);
    if (input.scope === "CUSTOMER") {
      if (principal.role !== "CUSTOMER") throw new ForbiddenException("CUSTOMER_PUSH_REQUIRED");
      return { userId: principal.id, branchId: null };
    }
    const branchId = input.branchId?.trim();
    if (!branchId) throw new BadRequestException("PUSH_BRANCH_REQUIRED");
    const branch = await this.prisma.database.branch.findUnique({
      where: { id: branchId }, select: { id: true },
    });
    if (!branch) throw new BadRequestException("PUSH_BRANCH_INVALID");
    if (principal.role === "OWNER") return { userId: principal.id, branchId };
    const member = await this.prisma.database.branchMember.findUnique({
      where: { branchId_userId: { branchId, userId: principal.id } },
      select: { role: true },
    });
    if (!member || !STAFF_ROLES.includes(member.role as (typeof STAFF_ROLES)[number])) {
      throw new ForbiddenException("STAFF_PUSH_FORBIDDEN");
    }
    return { userId: principal.id, branchId };
  }

  async register(authorization: string | undefined, input: PushRegistration) {
    const token = input.token.trim();
    if (token.length < 16 || token.length > 4096) throw new BadRequestException("PUSH_TOKEN_INVALID");
    const owner = await this.authorizeRegistration(authorization, input);

    let p256dh: string | null = null;
    let auth: string | null = null;
    if (input.transport === "WEB_PUSH") {
      let endpoint: URL;
      try { endpoint = new URL(token); } catch { throw new BadRequestException("WEB_PUSH_ENDPOINT_INVALID"); }
      if (endpoint.protocol !== "https:") throw new BadRequestException("WEB_PUSH_ENDPOINT_INVALID");
      p256dh = input.p256dh?.trim() || null;
      auth = input.auth?.trim() || null;
      if (!p256dh || !auth || p256dh.length > 256 || auth.length > 128) {
        throw new BadRequestException("WEB_PUSH_KEYS_INVALID");
      }
    }

    await this.prisma.database.pushEndpoint.upsert({
      where: { token },
      update: {
        userId: owner.userId, branchId: owner.branchId, scope: input.scope,
        transport: input.transport, p256dh, auth,
      },
      create: {
        userId: owner.userId, branchId: owner.branchId, scope: input.scope,
        transport: input.transport, token, p256dh, auth,
      },
    });
    return { status: "registered" as const };
  }

  async remove(authorization: string | undefined, tokenInput: string) {
    const principal = await this.authService.principal(authorization);
    const token = tokenInput.trim();
    if (token.length < 16 || token.length > 4096) throw new BadRequestException("PUSH_TOKEN_INVALID");
    await this.prisma.database.pushEndpoint.deleteMany({
      where: { token, userId: principal.id },
    });
    return { status: "removed" as const };
  }

  async notifyStaffNewOrder(branchId: string, orderId: string): Promise<void> {
    const endpoints = await this.prisma.database.pushEndpoint.findMany({
      where: { scope: "STAFF", branchId },
    });
    await this.deliver(endpoints, {
      title: "Có đơn hàng mới",
      body: "Một đơn mới đang chờ xác nhận.",
      kind: "NEW_ORDER",
      orderId,
      url: "/?notification=orders&order=" + encodeURIComponent(orderId),
    }, true);
  }

  async notifyCustomerConfirmed(customerId: string, orderId: string): Promise<void> {
    const endpoints = await this.prisma.database.pushEndpoint.findMany({
      where: { scope: "CUSTOMER", userId: customerId },
    });
    await this.deliver(endpoints, {
      title: "Đơn hàng đã được xác nhận",
      body: "Cửa hàng đã xác nhận đơn của bạn.",
      kind: "ORDER_CONFIRMED",
      orderId,
      url: "/?order=" + encodeURIComponent(orderId),
    }, false);
  }

  private async deliver(
    endpoints: Array<{
      id: string; token: string; transport: PushTransport;
      p256dh: string | null; auth: string | null;
    }>,
    payload: PushPayload,
    admin: boolean,
  ): Promise<void> {
    await Promise.allSettled(endpoints.map(endpoint =>
      endpoint.transport === "WEB_PUSH"
        ? this.sendWebPush(endpoint, payload)
        : this.sendFcm(endpoint, payload, admin),
    ));
  }

  private webPushSettings() {
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
    const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim();
    if (!publicKey || !privateKey || !subject) return null;
    return { publicKey, privateKey, subject };
  }

  private async sendWebPush(
    endpoint: { id: string; token: string; p256dh: string | null; auth: string | null },
    payload: PushPayload,
  ): Promise<void> {
    const settings = this.webPushSettings();
    if (!settings || !endpoint.p256dh || !endpoint.auth) return;
    webpush.setVapidDetails(settings.subject, settings.publicKey, settings.privateKey);
    try {
      await webpush.sendNotification({
        endpoint: endpoint.token,
        keys: { p256dh: endpoint.p256dh, auth: endpoint.auth },
      }, JSON.stringify(payload), { TTL: 300, urgency: "high" });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await this.prisma.database.pushEndpoint.deleteMany({ where: { id: endpoint.id } });
      }
    }
  }

  private fcmSettings() {
    const projectId = process.env.FCM_PROJECT_ID?.trim();
    const clientEmail = process.env.FCM_CLIENT_EMAIL?.trim();
    const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
    if (!projectId || !clientEmail || !privateKey) return null;
    return { projectId, clientEmail, privateKey };
  }

  private async fcmAccessToken(): Promise<{ token: string; projectId: string } | null> {
    const settings = this.fcmSettings();
    if (!settings) return null;
    this.fcmAuth ??= new GoogleAuth({
      credentials: { client_email: settings.clientEmail, private_key: settings.privateKey },
      scopes: [FCM_SCOPE],
    });
    const client = await this.fcmAuth.getClient();
    const access = await client.getAccessToken();
    const token = typeof access === "string" ? access : access?.token;
    return token ? { token, projectId: settings.projectId } : null;
  }

  private async sendFcm(
    endpoint: { id: string; token: string },
    payload: PushPayload,
    admin: boolean,
  ): Promise<void> {
    const auth = await this.fcmAccessToken();
    if (!auth) return;
    const response = await fetch(
      "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(auth.projectId) + "/messages:send",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + auth.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: endpoint.token,
            notification: { title: payload.title, body: payload.body },
            data: { kind: payload.kind, orderId: payload.orderId, url: payload.url },
            android: {
              priority: "HIGH",
              notification: {
                channel_id: admin ? "new-orders-v1" : "customer-orders-v1",
                sound: admin ? "new_order_alert.mp3" : "default",
                notification_priority: "PRIORITY_MAX",
              },
            },
          },
        }),
      },
    );
    if (response.ok) return;
    const body = await response.text().catch(() => "");
    if (response.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(body)) {
      await this.prisma.database.pushEndpoint.deleteMany({ where: { id: endpoint.id } });
    }
  }
}
