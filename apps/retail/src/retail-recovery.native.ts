import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FrozenPayment, FrozenTicket } from "./retail-recovery";

const TICKET_KEY = "hotpot.retail.uncertain-ticket.v1";
const PAYMENT_PREFIX = "hotpot.retail.uncertain-payment.v1.";
let ticketWrites: Promise<void> = Promise.resolve();
function isTicket(value: unknown): value is FrozenTicket {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<FrozenTicket>;
  return typeof t.staffId === "string" && typeof t.branchId === "string" &&
    typeof t.tableId === "string" && typeof t.sessionId === "string" &&
    typeof t.payload?.idempotencyKey === "string" && Array.isArray(t.payload.items) &&
    Array.isArray(t.cart) && typeof t.note === "string";
}
function isPayment(value: unknown, sessionId: string): value is FrozenPayment {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<FrozenPayment>;
  return t.sessionId === sessionId && typeof t.key === "string" && t.key.length > 0 &&
    (t.method === "CASH" || t.method === "QR") &&
    Number.isSafeInteger(t.amountVnd) && (t.amountVnd ?? 0) > 0;
}
function paymentKey(branchId: string, sessionId: string): string {
  return PAYMENT_PREFIX + encodeURIComponent(branchId) + "." + encodeURIComponent(sessionId);
}
/** These are business request drafts only. JWT/refresh credentials use SecureStore. */
export async function loadFrozenTicket(): Promise<FrozenTicket | null> {
  await ticketWrites;
  const raw = await AsyncStorage.getItem(TICKET_KEY);
  if (!raw) return null;
  try { const candidate: unknown = JSON.parse(raw); if (isTicket(candidate)) return candidate; }
  catch { /* never overwrite an uncertain submitted ticket */ }
  throw new Error("Phiếu gửi Bếp đã lưu bị lỗi. Không thể phát sinh mã mới tự động.");
}
export function writeFrozenTicket(ticket: FrozenTicket | null): Promise<void> {
  ticketWrites = ticketWrites.catch(() => undefined).then(async () => {
    if (ticket) await AsyncStorage.setItem(TICKET_KEY, JSON.stringify(ticket));
    else await AsyncStorage.removeItem(TICKET_KEY);
  });
  return ticketWrites;
}
export async function loadFrozenPayment(branchId: string, sessionId: string): Promise<FrozenPayment | null> {
  const raw = await AsyncStorage.getItem(paymentKey(branchId, sessionId));
  if (!raw) return null;
  try { const candidate: unknown = JSON.parse(raw); if (isPayment(candidate, sessionId)) return candidate; }
  catch { /* block new payment when stored request cannot be trusted */ }
  throw new Error("Phiếu thu tiền chưa rõ kết quả có dữ liệu không hợp lệ.");
}
export async function writeFrozenPayment(branchId: string, sessionId: string,
  payment: FrozenPayment | null): Promise<void> {
  const key = paymentKey(branchId, sessionId);
  if (payment) await AsyncStorage.setItem(key, JSON.stringify(payment));
  else await AsyncStorage.removeItem(key);
}
