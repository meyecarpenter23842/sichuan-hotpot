import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

const DAY_MS = 86400000;
const VIETNAM_OFFSET_MS = 7 * 3600000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_CODE = /^[0-9a-f]{8}$/i;

function parseVietnamDay(value: string): number {
  if (!DAY.test(value)) throw new BadRequestException("INVALID_ORDER_DATE");
  const [year, month, day] = value.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  if (year < 2000 || year > 2100 ||
    new Date(utc).toISOString().slice(0, 10) !== value) {
    throw new BadRequestException("INVALID_ORDER_DATE");
  }
  return utc - VIETNAM_OFFSET_MS;
}

/** Inclusive business-day endpoints, converted to half-open UTC timestamps. */
export function orderCreatedBetween(from?: string, to?: string):
  Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  if (!from || !to) throw new BadRequestException("INCOMPLETE_ORDER_DATE");
  const start = parseVietnamDay(from);
  const last = parseVietnamDay(to);
  const days = Math.round((last - start) / DAY_MS) + 1;
  if (days < 1 || days > 366) {
    throw new BadRequestException("INVALID_ORDER_DATE_RANGE");
  }
  return { gte: new Date(start), lt: new Date(last + DAY_MS) };
}

function formatUUID(hex: string): string {
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32)].join("-");
}

/**
 * Btree UUID primary-key range. A displayed #XXXXXXXX code is its first
 * 8 hex digits; no unindexed cast(id AS text) LIKE scan on production.
 */
export function orderIdMatch(raw?: string): Prisma.StringFilter | undefined {
  if (raw === undefined) return undefined;
  const code = raw.trim().replace(/^#/, "");
  if (FULL_UUID.test(code)) return { equals: code.toLowerCase() };
  if (!SHORT_CODE.test(code)) throw new BadRequestException("INVALID_ORDER_CODE");
  const prefix = code.toLowerCase();
  return {
    gte: formatUUID(prefix + "0".repeat(24)),
    lte: formatUUID(prefix + "f".repeat(24)),
  };
}
