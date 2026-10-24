import { API_ORIGIN, isValidApiOrigin } from "./api-origin";
import { loadStoredSession, writeStoredSession } from "./session-storage";

export type Role = "OWNER" | "MANAGER" | "WAITER" | "CASHIER" | "KITCHEN" | "DRIVER" | "CUSTOMER";
export type Principal = { id: string; role: Role };
export type Tokens = { accessToken: string; refreshToken: string; accessTokenExpiresInSeconds: number };
export type Branch = { id: string; name: string; code: string; isActive: boolean; staffRole?: Role };
export type Area = { id: string; name: string; sortOrder: number; isActive: boolean };
export type DiningSession = { id: string; status: string; guestCount: number | null; openedAt: string; _count: { tickets: number } };
export type Table = { id: string; code: string; name: string; areaId: string; isActive: boolean; needsCleaning: boolean;
  floorRow: number | null; floorColumn: number | null; sessions: DiningSession[] };
export type Option = { id: string; name: string; priceDeltaVnd: number; isAvailable: boolean; imageKey?: string | null };
export type Group = { id: string; name: string; minSelect: number; maxSelect: number; options: Option[]; isAvailable?: boolean };
export type ComboOption = { id: string; priceDeltaVnd: number; quantity: number; variant: Option | null;
  childProduct: { name: string; isAvailable: boolean }; };
export type ComboModifier = { id: string; priceDeltaVnd: number; quantity: number;
  modifierOption: Option & { group: { name: string; isAvailable: boolean } }; };
export type ComboGroup = { id: string; name: string; minSelect: number; maxSelect: number;
  options: ComboOption[]; modifierOptions: ComboModifier[] };
export type StandaloneTopping = { id: string; groupId: string; groupName: string;
  name: string; priceVnd: number; imageKey: string | null; isAvailable: boolean };
export type Product = { id: string; categoryId?: string; standaloneTopping?: boolean; name: string; description: string | null;
  imageKey: string | null; priceVnd: number; kind: "STANDARD" | "COMBO"; isAvailable: boolean;
  variants: Option[]; modifierGroups: Group[]; comboGroups: ComboGroup[];
  comboFixedItems: { id: string; quantity: number; variant: Option | null;
    childProduct: { name: string; isAvailable: boolean } }[];
};
export type Category = { id: string; name: string; products: Product[] };
export type Menu = { id: string; name: string; categories: Category[]; standaloneToppings?: StandaloneTopping[] };
export type TicketItem = { id: string; productId: string | null; productName: string; variantName: string | null;
  quantity: number; unitPriceVnd: number; lineTotalVnd: number; selectionSnapshot: unknown };
export type Ticket = { id: string; sessionId: string; source: "QR" | "STAFF"; status: string;
  createdAt: string; reviewedAt: string | null; customerNote: string | null;
  items: TicketItem[]; session?: { table: { code: string; name: string } } };
export type DiningPayment = { id: string; method: "CASH" | "QR";
  status: "PENDING" | "CONFIRMED" | "VOIDED" | "REFUNDED";
  amountVnd: number; cashReceivedVnd: number | null;
  createdAt: string; confirmedAt: string | null;
  recordedById: string; confirmedById: string | null;
  qr: { bankBin: string; accountNo: string; accountName: string;
    transferReference: string; imageUrl: string; amountVnd: number } | null };
export type Bill = { id: string; status: "OPEN" | "CHECKOUT" | "CLOSED";
  subtotalVnd: number; paidVnd: number; dueVnd: number; openedAt: string;
  closedAt: string | null; branch: { name: string }; table: { code: string; name: string };
  payments: DiningPayment[]; tickets: Ticket[] };
export type ItemInput = { productId: string; standaloneTopping?: boolean; variantId: string | null; modifierIds: string[];
  comboOptionIds: string[]; quantity: number; note: string };
export type CartLine = { id: string; name: string; variantName?: string; previewVnd: number; item: ItemInput };
export type Submission = { idempotencyKey: string; customerNote?: string; items: ItemInput[] };
export type Receipt = { ticketId: string; status: string; replayed: boolean };

const names: Record<string, string> = {
  DINING_TABLE_OCCUPIED: "Bàn đã được mở trên thiết bị khác. Tải lại trạng thái bàn.",
  DINING_TABLE_NOT_OPEN: "Bàn chưa mở phiên. Hãy chọn mở bàn trước.",
  DINING_SESSION_NOT_OPEN: "Phiên bàn đã đóng hoặc chuyển. Vui lòng chọn bàn lại.",
  DINING_SESSION_MOVED: "Phiên đã chuyển bàn. Tải lại sơ đồ.",
  DINING_BILL_UNPAID: "Bàn vẫn còn tiền chưa thanh toán.",
  DINING_CHECKOUT_REQUIRED: "Chốt hóa đơn trước khi thu tiền hoặc đóng bàn.",
  DINING_PENDING_QR_TICKETS: "Còn yêu cầu QR chờ duyệt. Xử lý trước khi chốt, chuyển hoặc đóng bàn.",
  DINING_QR_PAYMENT_PENDING: "Có chuyển khoản QR chưa xác nhận. Xác nhận hoặc hủy trước.",
  DINING_PAYMENT_EXCEEDS_DUE: "Số tiền lớn hơn số cần thu hoặc hóa đơn đã thay đổi.",
  DINING_QR_BENEFICIARY_NOT_CONFIGURED: "Quán chưa cấu hình tài khoản ngân hàng VietQR.",
  DINING_CASH_TENDER_INVALID: "Tiền khách đưa không hợp lệ hoặc chưa đủ.",
  DINING_TABLE_UNAVAILABLE: "Bàn đang khóa hoặc chờ dọn.",
  DINING_FLOOR_STALE: "Sơ đồ vừa được thay đổi trên thiết bị khác. Đã tải lại để chọn vị trí mới.",
  DINING_FLOOR_OCCUPIED: "Vị trí này đã có bàn. Tải lại sơ đồ rồi chọn ô khác.",
  DINING_FLOOR_POSITION_INVALID: "Vị trí bàn không hợp lệ.",
  DINING_TICKET_STALE: "Yêu cầu món đã thay đổi trên thiết bị khác.",
  DINING_TICKET_ALREADY_REVIEWED: "Yêu cầu này đã được nhân viên xử lý.",
  DINING_IDEMPOTENCY_REUSED: "Phiếu này đã được gửi với nội dung khác. Kiểm tra và thử lại.",
  DINING_BRANCH_FORBIDDEN: "Anh/chị không có quyền thao tác ở chi nhánh này.",
  DINING_TICKET_RATE_LIMIT: "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
  PRODUCT_UNAVAILABLE: "Có món vừa hết hàng. Vui lòng tải lại thực đơn.",
  VARIANT_UNAVAILABLE: "Size đã hết. Vui lòng chọn lại.",
  INVALID_MODIFIERS: "Tùy chọn topping/độ cay chưa hợp lệ.",
  INVALID_COMBO_SELECTION: "Hãy kiểm tra các lựa chọn trong combo.",
};
export class PosApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
/** Web sessions stay in memory; Android persists encrypted credentials via SecureStore. */
let active: Tokens | null = null;
let rotation: Promise<Tokens | null> | null = null;
// Serialize writes to prevent an old login from overwriting a later logout/rotation.
let writeTask: Promise<void> = Promise.resolve();
export function setSession(tokens: Tokens | null) {
  active = tokens;
  writeTask = writeTask.catch(() => undefined).then(() => writeStoredSession(tokens));
}
export function currentSession() { return active; }
export async function restoreSession(): Promise<Tokens | null> {
  await writeTask.catch(() => undefined);
  if (active) return active;
  const saved = await loadStoredSession();
  if (!active) active = saved;
  return active;
}
async function rotate(): Promise<Tokens | null> {
  if (!active?.refreshToken) return null;
  if (rotation) return rotation;
  const original = active;
  rotation = (async () => {
    try {
      const next = await api<Tokens>("/auth/refresh", { method: "POST",
        body: { refreshToken: original.refreshToken }, anonymous: true });
      if (active === original) setSession(next);
      return active;
    } catch { if (active === original) setSession(null); return null; }
  })();
  try { return await rotation; } finally { rotation = null; }
}
export async function api<T>(path: string, opts: { method?: "GET" | "POST" | "PATCH";
  body?: unknown; anonymous?: boolean } = {}): Promise<T> {
  if (!isValidApiOrigin(API_ORIGIN)) throw new PosApiError("Chưa cấu hình API HTTPS hợp lệ.", 0);
  const send = (token: string | null) => fetch(API_ORIGIN + path, {
    method: opts.method ?? "GET", cache: "no-store",
    headers: { Accept: "application/json", ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: "Bearer " + token } : {}) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const controller = new AbortController();
  // No implicit replay of uncertain POSTs. A user retry uses the same idempotency key.
  let response: Response;
  try {
    response = await send(opts.anonymous ? null : active?.accessToken ?? null);
    if (response.status === 401 && !opts.anonymous && active && opts.method !== "POST") {
      const refreshed = await rotate();
      if (refreshed) response = await send(refreshed.accessToken);
    }
  } catch { throw new PosApiError("Không có kết nối máy chủ. Phiếu chưa được xác nhận; hãy thử lại.", 0); }
  finally { controller.abort(); }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const raw = body.message ?? (body.error && typeof body.error === "object"
      ? (body.error as Record<string, unknown>).code : body.error);
    const code = typeof raw === "string" ? raw : "";
    const text = names[code] ?? (
      response.status === 401 ? "Phiên đã hết hạn. Đăng nhập lại." :
      response.status === 403 ? "Tài khoản không được phép thao tác." :
      response.status === 409 ? "Dữ liệu đã thay đổi trên thiết bị khác. Hãy làm mới." :
      response.status === 422 ? "Món hoặc tùy chọn không còn hợp lệ." :
      response.status === 429 ? "Thao tác quá nhanh. Thử lại sau." :
      response.status >= 500 ? "Máy chủ đang gặp sự cố." : "Không thể hoàn tất thao tác.");
    throw new PosApiError(text, response.status);
  }
  return data as T;
}
export const branchPath = (id: string) => "/dining/branches/" + encodeURIComponent(id);
export function productImage(key: string | null): string | null {
  if (!key || !/^(?:products-image|catalog-media)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*\.(?:png|webp|jpe?g)$/i.test(key)
    || key.includes("..")) return null;
  return "https://pub-63ed7b1c33514906ab6e2d82f41bffce.r2.dev/" + key;
}
export const money = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + "đ";
