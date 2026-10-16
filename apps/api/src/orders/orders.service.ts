import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, UnprocessableEntityException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { quoteDelivery, quoteZoneDelivery, DeliveryQuoteError, validateAdministrativeSelection } from "@hotpot/shared";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import type { DeliveryCartItem } from "../delivery/delivery-quote.service";
import { DeliveryQuoteService } from "../delivery/delivery-quote.service";
import { priceCart, productSelect } from "../delivery/pricing";
import { configuredQr, qrInstructions } from "../payments/vietqr";
import { OrderRealtimeService } from "./order-realtime.service";

export interface CheckoutRequest {
  branchId: string;
  addressId: string;
  idempotencyKey: string;
  paymentMethod: "COD" | "QR";
  items: DeliveryCartItem[];
}
const existingSelect = {
  id: true, requestHash: true, status: true, totalVnd: true,
  payment: { select: { method: true, status: true,
    qrBankBin: true, qrAccountNo: true, qrAccountName: true } },
} as const satisfies Prisma.OrderSelect;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly quote: DeliveryQuoteService,
    private readonly realtime: OrderRealtimeService,
  ) {}

  paymentMethods() { return { codAvailable: true, qrAvailable: configuredQr() !== null }; }

  private async customerId(authorization: string | undefined): Promise<string> {
    const user = await this.auth.principal(authorization);
    if (user.role !== "CUSTOMER") throw new ForbiddenException("CUSTOMER_REQUIRED");
    return user.id;
  }

  private requestHash(input: CheckoutRequest): string {
    if (!["COD", "QR"].includes(input.paymentMethod)
      || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
      throw new BadRequestException("INVALID_CHECKOUT");
    }
    const normalized = input.items.map(item => ({
      productId: item.productId,
      variantId: item.variantId,
      modifierIds: [...item.modifierIds].sort(),
      ...(item.comboOptionIds?.length
        ? { comboOptionIds: [...item.comboOptionIds].sort() }
        : {}),
      quantity: item.quantity,
      // Preserve pre-release legacy idempotency hashes for in-flight retries.
      ...(item.pricingMode === "SEPARATE" ? {pricingMode:"SEPARATE" as const} : {}),
    }));
    normalized.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const fingerprint = JSON.stringify({
      branchId: input.branchId, addressId: input.addressId,
      method: input.paymentMethod, items: normalized,
    });
    return createHash("sha256").update(fingerprint).digest("hex");
  }

  private replay(row: {
    id: string; requestHash: string | null; status: string; totalVnd: number;
    payment: { method: string; status: string;
      qrBankBin: string | null; qrAccountNo: string | null; qrAccountName: string | null } | null;
  }, hash: string, replayed: boolean) {
    if (row.requestHash !== hash) throw new ConflictException("IDEMPOTENCY_KEY_REUSED");
    if (!row.payment) throw new ConflictException("INCOMPLETE_ORDER");
    return {
      orderId: row.id, status: row.status, totalVnd: row.totalVnd,
      paymentMethod: row.payment.method, paymentStatus: row.payment.status,
      replayed, qr: qrInstructions(row.id, row.totalVnd, row.payment),
    };
  }

  async checkout(authorization: string | undefined, input: CheckoutRequest) {
    const customerId = await this.customerId(authorization);
    const hash = this.requestHash(input);
    const key = { customerId, idempotencyKey: input.idempotencyKey };
    const db = this.prisma.database;
    // Fast retry: don't reroute/reprice after a successful checkout.
    const previous = await db.order.findUnique({
      where: { customerId_idempotencyKey: key }, select: existingSelect,
    });
    if (previous) return this.replay(previous, hash, true);
    const qrBeneficiary = input.paymentMethod === "QR" ? configuredQr() : null;
    if (input.paymentMethod === "QR" && !qrBeneficiary) {
      throw new UnprocessableEntityException("QR_NOT_CONFIGURED");
    }

    // Quotes are not trusted: reprice from DB for each NEW request; in zone mode
    // routing is never invoked and a changed address/policy blocks checkout.
    const quote = await this.quote.calculate(authorization, input);
    // Serializable isolation can abort overlapping first-time checkouts; retry the
    // full transaction after checking whether another request already committed.
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const created = await db.$transaction(async tx => {
          const existing = await tx.order.findUnique({
            where: { customerId_idempotencyKey: key }, select: existingSelect,
          });
          if (existing) return this.replay(existing, hash, true);
          const [branch, address, user, policy, products] = await Promise.all([
            tx.branch.findFirst({
              where: { id: input.branchId, isActive: true },
              select: { id: true, latitude: true, longitude: true },
            }),
            tx.address.findFirst({
              where: { id: input.addressId, userId: customerId },
              select: { id: true, line1: true, latitude: true, longitude: true,
                catalogVersion: true, provinceCode: true, wardCode: true },
            }),
            tx.user.findUnique({
              where: { id: customerId }, select: { phoneE164: true },
            }),
            tx.deliveryPolicyVersion.findFirst({
              where: { branchId: input.branchId }, orderBy: { version: "desc" },
            }),
            tx.product.findMany({
              where: {
                id: { in: [...new Set(input.items.map(item => item.productId))] },
                category: { is: { branchId: input.branchId } },
              },
              select: productSelect,
            }),
          ]);
          if (!branch || !address || !policy) throw new ConflictException("QUOTE_STALE_RETRY");
          if (!user?.phoneE164 || !/^\+84[35789]\d{8}$/.test(user.phoneE164)) {
            throw new UnprocessableEntityException("PHONE_REQUIRED");
          }
          const priced = priceCart(input.items, products);
          if (policy.id !== quote.policyVersionId
            || priced.subtotalVnd !== quote.subtotalVnd
            || Date.parse(quote.quoteExpiresAt) <= Date.now()) {
            throw new ConflictException("QUOTE_STALE_RETRY");
          }
          let currentFee;
          try {
            if (policy.pricingMode === "ZONE") {
              if (!validateAdministrativeSelection(address)) throw new ConflictException("QUOTE_STALE_RETRY");
              const zones = await tx.deliveryZone.findMany({
                where: { policyVersionId: policy.id },
              });
              currentFee = quoteZoneDelivery(priced.subtotalVnd, address, zones, {
                versionId: policy.id, acceptingOrders: policy.acceptingOrders,
                minSubtotalVnd: policy.minSubtotalVnd,
                freeDeliveryAtSubtotalVnd: policy.freeDeliveryAtSubtotalVnd,
              });
              if (currentFee.zoneId !== quote.zoneId || quote.pricingMode !== "ZONE") {
                throw new ConflictException("QUOTE_STALE_RETRY");
              }
            } else {
              if (quote.pricingMode !== "DISTANCE") throw new ConflictException("QUOTE_STALE_RETRY");
              currentFee = quoteDelivery(priced.subtotalVnd, quote.routeDistanceMeters, {
                versionId: policy.id, acceptingOrders: policy.acceptingOrders,
                baseMeters: policy.baseMeters ?? -1, baseFeeVnd: policy.baseFeeVnd ?? -1,
                extraStepMeters: policy.extraStepMeters ?? -1,
                extraStepFeeVnd: policy.extraStepFeeVnd ?? -1,
                maxRoadMeters: policy.maxRoadMeters ?? -1,
                minSubtotalVnd: policy.minSubtotalVnd,
                freeDeliveryAtSubtotalVnd: policy.freeDeliveryAtSubtotalVnd,
              });
            }
          } catch (error) {
            if (error instanceof DeliveryQuoteError) throw new ConflictException("QUOTE_STALE_RETRY");
            throw error;
          }
          if (currentFee.feeVnd !== quote.feeVnd
            || currentFee.totalVnd !== quote.totalVnd) {
            throw new ConflictException("QUOTE_STALE_RETRY");
          }
          // In-memory estimates are not reusable for another destination.
          // Saved Address coordinates cannot be edited, but deletion is rechecked above.
          const saved = await tx.order.create({
            data: {
              branchId: input.branchId, customerId,
              deliveryPolicyVersionId: policy.id,
              idempotencyKey: input.idempotencyKey, requestHash: hash,
              phoneSnapshot: user.phoneE164, status: "PENDING",
              subtotalVnd: priced.subtotalVnd, deliveryFeeVnd: currentFee.feeVnd,
              totalVnd: currentFee.totalVnd,
              pricingMode: policy.pricingMode,
              roadDistanceMeters: policy.pricingMode === "ZONE" ? null : quote.routeDistanceMeters,
              zoneId: policy.pricingMode === "ZONE" ? quote.zoneId : null,
              zoneNameSnapshot: policy.pricingMode === "ZONE" ? quote.zoneName : null,
              provinceCodeSnapshot: policy.pricingMode === "ZONE" ? quote.provinceCode : null,
              wardCodeSnapshot: policy.pricingMode === "ZONE" ? quote.wardCode : null,
              catalogVersionSnapshot: policy.pricingMode === "ZONE" ? quote.catalogVersion : null,
              addressLineSnapshot: address.line1,
              latitudeSnapshot: address.latitude, longitudeSnapshot: address.longitude,
              items: {
                create: priced.lines.map(line => ({
                  productId: line.productId, productName: line.productName,
                  variantId: line.variantId, variantName: line.variantName,
                  pricingMode: line.pricingMode, quantity: line.quantity,
                  unitPriceVnd: line.unitPriceVnd, lineTotalVnd: line.lineTotalVnd,
                  modifiers: { create: line.modifiers.map(modifier => ({
                    optionId: modifier.optionId, name: modifier.name, priceVnd: modifier.priceVnd,
                  })) },
                })),
              },
              statusHistory: { create: { toStatus: "PENDING", actorId: customerId } },
              // QR is MANUAL verification: never auto-confirm because client shows a QR/screenshot.
              payment: { create: {
                method: input.paymentMethod, status: "PENDING", amountVnd: currentFee.totalVnd,
                qrBankBin: qrBeneficiary?.bankBin ?? null,
                qrAccountNo: qrBeneficiary?.accountNo ?? null,
                qrAccountName: qrBeneficiary?.accountName ?? null,
              } },
            },
            select: existingSelect,
          });
          return this.replay(saved, hash, false);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
        if (!created.replayed) {
          void this.realtime.publish({
            type: "order.created", orderId: created.orderId, branchId: input.branchId,
            customerId, status: "PENDING",
          });
        }
        return created;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === "P2002" || error.code === "P2034") {
            // Unique-key races and PostgreSQL serialization aborts are expected
            // when several identical requests arrive at once. A committed winner
            // is authoritative; do not create a second order or change its price.
            const row = await db.order.findUnique({
              where: { customerId_idempotencyKey: key }, select: existingSelect,
            });
            if (row) return this.replay(row, hash, true);
            if (attempt < maxAttempts - 1) {
              // Bounded exponential delay allows the winning transaction to
              // commit before retrying with a new Serializable snapshot.
              await new Promise(resolve => setTimeout(resolve, Math.min(240, 15 * 2 ** attempt)));
              continue;
            }
            throw new ConflictException("CHECKOUT_CONFLICT_RETRY");
          }
        }
        throw error;
      }
    }
    throw new ConflictException("CHECKOUT_CONFLICT_RETRY");
  }

  async list(authorization: string | undefined) {
    const customerId = await this.customerId(authorization);
    return this.prisma.database.order.findMany({
      where: { customerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true, branchId: true, status: true, createdAt: true,
        subtotalVnd: true, deliveryFeeVnd: true, totalVnd: true,
        payment: { select: { method: true, status: true } },
      },
    });
  }

  async detail(authorization: string | undefined, orderId: string) {
    const customerId = await this.customerId(authorization);
    const order = await this.prisma.database.order.findFirst({
      where: { id: orderId, customerId },
      select: {
        id: true, branchId: true, status: true, createdAt: true,
        subtotalVnd: true, deliveryFeeVnd: true, totalVnd: true,
        roadDistanceMeters: true, addressLineSnapshot: true,
        pricingMode: true, zoneNameSnapshot: true, provinceCodeSnapshot: true,
        wardCodeSnapshot: true, catalogVersionSnapshot: true,
        payment: { select: { method: true, status: true, amountVnd: true,
          qrBankBin: true, qrAccountNo: true, qrAccountName: true } },
        items: { select: {
          productId: true, productName: true, variantName: true, quantity: true,
          unitPriceVnd: true, lineTotalVnd: true,
          modifiers: { select: { name: true, priceVnd: true } },
        } },
        statusHistory: { orderBy: { createdAt: "asc" },
          select: { fromStatus: true, toStatus: true, createdAt: true, reason: true } },
      },
    });
    if (!order) throw new NotFoundException("ORDER_NOT_FOUND");
    const qr = order.payment
      ? qrInstructions(order.id, order.payment.amountVnd, order.payment) : null;
    return {
      ...order,
      payment: order.payment ? {
        method: order.payment.method, status: order.payment.status,
        amountVnd: order.payment.amountVnd, qr,
      } : null,
    };
  }
}
