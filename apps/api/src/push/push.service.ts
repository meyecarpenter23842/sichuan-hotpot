import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import type { OrderStatus, PushScope, PushTransport } from "@prisma/client";
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
  kind: "NEW_ORDER" | "ORDER_CONFIRMED" | "ORDER_STATUS" | "TEST";
  orderId?: string;
  testId?: string;
  url: string;
};

const STAFF_ROLES = ["OWNER", "MANAGER"] as const;
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
// Mirrors apps/admin/src/push-client.native.ts. See native-order-sound contract test.
const ADMIN_ORDER_CHANNEL_ID = "new-orders-v3";
const ADMIN_ORDER_SOUND_FILE = "new_order_alert.mp3";
// Customer push is intentionally quiet: CONFIRMED uses notifyCustomerConfirmed,
// while only CANCELED and DELIVERING produce generic status notifications.
// Cooking, ready, delivered and delivery-failed remain visible via order sync.
const customerStatusText: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  DELIVERING: { title: "Đơn hàng đang được giao", body: "Cửa hàng đang giao món đến bạn." },
  CANCELED: { title: "Đơn hàng đã bị hủy", body: "Cửa hàng đã hủy đơn hàng của bạn." },
};

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private fcmAuth: GoogleAuth | null | undefined;
  private readonly testCooldowns = new Map<string, number>();
  private readonly testReceipts = new Map<string, { userId: string; token: string; createdAt: number; receivedAt: number | null;
    status: "scheduled" | "sent_to_fcm" | "failed" | "received_on_device"; failureCode: string | null }>();

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


  // Sends only to the token owned by the authenticated session. No Order records are touched.
  async sendTest(authorization: string | undefined, tokenInput: string, delaySeconds = 0) {
    const principal = await this.authService.principal(authorization);
    const token = tokenInput.trim();
    if (token.length < 16 || token.length > 4096) throw new BadRequestException("PUSH_TOKEN_INVALID");
    const endpoint = await this.prisma.database.pushEndpoint.findFirst({
      where: { userId: principal.id, token },
    });
    if (!endpoint) throw new ForbiddenException("PUSH_DEVICE_NOT_REGISTERED_FOR_USER");
    await this.authorizeRegistration(authorization, {
      scope: endpoint.scope, transport: endpoint.transport, token,
      branchId: endpoint.branchId,
    });
    if (endpoint.transport !== "FCM") throw new BadRequestException("FCM_TEST_REQUIRES_ANDROID");

    const now = Date.now();
    // Bound memory even on a long-running VPS process; no migration needed.
    for (const [key, value] of this.testCooldowns) {
      if (now - value > 60_000) this.testCooldowns.delete(key);
    }
    for (const [key, value] of this.testReceipts) {
      if (now - value.createdAt > 600_000) this.testReceipts.delete(key);
    }
    const cooldownKey = principal.id + ":" + endpoint.id;
    if (now - (this.testCooldowns.get(cooldownKey) ?? 0) < 30_000) {
      throw new HttpException("PUSH_TEST_RATE_LIMIT_30_SECONDS", 429);
    }
    this.testCooldowns.set(cooldownKey, now);
    const testId = randomUUID();
    const entry: { userId: string; token: string; createdAt: number; receivedAt: number | null;
      status: "scheduled" | "sent_to_fcm" | "failed" | "received_on_device"; failureCode: string | null } = {
      userId: principal.id, token, createdAt: now, receivedAt: null,
      status: delaySeconds > 0 ? "scheduled" : "sent_to_fcm", failureCode: null,
    };
    this.testReceipts.set(testId, entry);
    const deliver = async () => {
      try {
        await this.sendFcm(endpoint, {
        title: "Kiểm tra thông báo Sichuan Hotpot",
        body: "Đây là thông báo thử, không tạo đơn hàng.",
        kind: "TEST", testId, url: "/",
        }, endpoint.scope === "STAFF");
        if (entry.status === "scheduled") entry.status = "sent_to_fcm";
      } catch (error) {
        entry.status = "failed";
        // Only allowlisted diagnostics: no raw FCM payload, credentials or token.
        const code = error instanceof Error ? error.message : "";
        entry.failureCode = [
          "FCM_SERVER_NOT_CONFIGURED",
          "FCM_SERVER_CREDENTIALS_OR_PERMISSION_INVALID",
          "FCM_DEVICE_TOKEN_EXPIRED",
          "FCM_RELAY_NOT_CONFIGURED",
          "FCM_RELAY_SEND_FAILED",
          "FCM_RELAY_PROVIDER_REJECTED",
        ].includes(code) ? code : code.startsWith("FCM_SEND_FAILED_HTTP_")
          ? "FCM_PROVIDER_REJECTED" : "FCM_SEND_FAILED";
        this.logger.warn("FCM test send failed: " + entry.failureCode);
        throw error;
      }
    };
    if (delaySeconds > 0) {
      // Run on the backend so Android can be backgrounded or closed before FCM sends.
      setTimeout(() => { void deliver().catch(() => undefined); }, delaySeconds * 1000);
      return { status: "scheduled" as const, testId, received: false, delaySeconds };
    }
    await deliver();
    return { status: "sent_to_fcm" as const, testId, received: false };
  }

  async acknowledgeTest(authorization: string | undefined, testId: string, token: string) {
    const principal = await this.authService.principal(authorization);
    const item = this.testReceipts.get(testId);
    if (!item || item.userId !== principal.id || item.token !== token ||
      Date.now() - item.createdAt > 600_000) {
      throw new ForbiddenException("PUSH_TEST_RECEIPT_FORBIDDEN_OR_EXPIRED");
    }
    item.receivedAt = Date.now();
    item.status = "received_on_device";
    return { status: "received_on_device" as const, receivedAt: new Date(item.receivedAt).toISOString() };
  }

  async testStatus(authorization: string | undefined, testId: string) {
    const principal = await this.authService.principal(authorization);
    const item = this.testReceipts.get(testId);
    if (!item || item.userId !== principal.id || Date.now() - item.createdAt > 600_000) {
      throw new ForbiddenException("PUSH_TEST_NOT_FOUND_OR_EXPIRED");
    }
    return { status: item.status, received: item.receivedAt !== null,
      failureCode: item.failureCode };
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

  async notifyCustomerStatus(
    customerId: string, orderId: string, status: OrderStatus, reason?: string | null,
  ): Promise<void> {
    const message = customerStatusText[status];
    if (!message) return;
    const endpoints = await this.prisma.database.pushEndpoint.findMany({
      where: { scope: "CUSTOMER", userId: customerId },
    });
    const note = status === "CANCELED" && reason?.trim()
      ? " Lý do: " + reason.trim().slice(0, 120) : "";
    await this.deliver(endpoints, {
      ...message, body: message.body + note, kind: "ORDER_STATUS",
      orderId, url: "/?order=" + encodeURIComponent(orderId),
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
    const results = await Promise.allSettled(endpoints.map(endpoint =>
      endpoint.transport === "WEB_PUSH"
        ? this.sendWebPush(endpoint, payload)
        : this.sendFcm(endpoint, payload, admin),
    ));
    const failed = results.filter(result => result.status === "rejected").length;
    if (failed > 0) {
      // Never log device tokens, credentials, user addresses or notification content.
      this.logger.warn("Push " + payload.kind + ": " + failed + "/" + results.length
        + " device deliveries failed; check FCM/Web Push configuration.");
    }
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
    const message = {
      token: endpoint.token,
      notification: { title: payload.title, body: payload.body },
      data: { kind: payload.kind, orderId: payload.orderId ?? "",
        testId: payload.testId ?? "", url: payload.url },
      android: {
        priority: "HIGH",
        notification: {
          channel_id: admin ? ADMIN_ORDER_CHANNEL_ID : "customer-orders-v1",
          sound: admin ? ADMIN_ORDER_SOUND_FILE : "default",
          notification_priority: "PRIORITY_MAX",
        },
      },
    };

    const relayUrl = process.env.FCM_RELAY_URL?.trim() || "";
    const relaySecret = process.env.FCM_RELAY_SECRET_HEX?.trim() || "";
    if (relayUrl || relaySecret) {
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(relayUrl)
          || !/^[a-f0-9]{64}$/i.test(relaySecret)) {
        throw new ServiceUnavailableException("FCM_RELAY_NOT_CONFIGURED");
      }
      // Google Apps Script executes as the operator; only HMAC-authenticated
      // short-lived requests may cause the app script to send an FCM message.
      const signedPayload = Buffer.from(JSON.stringify({
        ts: Date.now(), nonce: randomUUID(), message,
      }), "utf8").toString("base64url");
      const signature = createHmac("sha256", Buffer.from(relaySecret, "hex"))
        .update(signedPayload).digest("base64url");
      let result: Response;
      try {
        result = await fetch(relayUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: signedPayload, signature }),
          signal: AbortSignal.timeout(15_000),
          redirect: "follow",
        });
      } catch {
        throw new ServiceUnavailableException("FCM_RELAY_SEND_FAILED");
      }
      if (!result.ok) throw new ServiceUnavailableException("FCM_RELAY_SEND_FAILED");
      // Apps Script web apps send HTTP 200 for business errors. Inspect body.
      const answer: unknown = await result.json().catch(() => null);
      if (answer && typeof answer === "object" && "ok" in answer && answer.ok === true) return;
      if (answer && typeof answer === "object" && "code" in answer
        && answer.code === "TOKEN_EXPIRED") {
        await this.prisma.database.pushEndpoint.deleteMany({ where: { id: endpoint.id } });
        throw new BadRequestException("FCM_DEVICE_TOKEN_EXPIRED");
      }
      throw new ServiceUnavailableException("FCM_RELAY_PROVIDER_REJECTED");
    }

    // Original private service-account HTTP v1 path remains available.
    const auth = await this.fcmAccessToken();
    if (!auth) throw new ServiceUnavailableException("FCM_SERVER_NOT_CONFIGURED");
    const response = await fetch(
      "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(auth.projectId) + "/messages:send",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + auth.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      },
    );
    if (response.ok) return;
    const body = await response.text().catch(() => "");
    if (/UNREGISTERED|registration-token-not-registered/i.test(body)) {
      await this.prisma.database.pushEndpoint.deleteMany({ where: { id: endpoint.id } });
      throw new BadRequestException("FCM_DEVICE_TOKEN_EXPIRED");
    }
    if (response.status === 401 || response.status === 403) {
      throw new ServiceUnavailableException("FCM_SERVER_CREDENTIALS_OR_PERMISSION_INVALID");
    }
    throw new ServiceUnavailableException("FCM_SEND_FAILED_HTTP_" + response.status);
  }
}
