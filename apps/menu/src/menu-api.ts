import { API_ORIGIN, isValidApiOrigin } from "./api-origin";

export type Option = { id: string; name: string; priceDeltaVnd: number; isAvailable: boolean; imageKey?: string | null };
export type Group = { id: string; name: string; minSelect: number; maxSelect: number; options: Option[]; isAvailable?: boolean };
export type ComboOption = { id: string; priceDeltaVnd: number; quantity: number; variant: Option | null; childProduct: { name: string; isAvailable: boolean } };
export type ComboModifier = { id: string; priceDeltaVnd: number; quantity: number; modifierOption: Option & { group: { name: string; isAvailable: boolean } } };
export type ComboGroup = { id: string; name: string; minSelect: number; maxSelect: number; options: ComboOption[]; modifierOptions: ComboModifier[] };
export type Product = { id: string; categoryId?: string; name: string; description: string | null; imageKey: string | null; priceVnd: number;
  kind: "STANDARD" | "COMBO"; isAvailable: boolean; variants: Option[]; modifierGroups: Group[];
  comboGroups: ComboGroup[]; comboFixedItems: { id: string; quantity: number; variant: Option | null; childProduct: { name: string; isAvailable: boolean } }[];
};
export type Category = { id: string; name: string; imageKey?: string | null; products: Product[] };
export type Menu = { id: string; name: string; isActive: boolean; categories: Category[] };
export type Locator = { table: string; code: string; area: string; branch: string; branchId: string };
export type GuestGrant = { credential: string; expiresAt: string; sessionId: string };
export type GuestTicket = { id: string; status: string; source: "QR" | "STAFF"; createdAt: string;
  customerNote: string | null; rejectionReason: string | null; items: { id: string; productName: string;
    variantName: string | null; quantity: number; lineTotalVnd: number }[];
};
export type GuestBill = { status: string; subtotalVnd: number; tickets: {
  id: string; status: string; createdAt: string;
  items: { productName: string; variantName: string | null; quantity: number; lineTotalVnd: number }[];
}[] };
export type ItemInput = { productId: string; variantId: string | null; modifierIds: string[]; comboOptionIds: string[];
  quantity: number; note: string };
export type CartLine = { id: string; name: string; variantName?: string; previewVnd: number; item: ItemInput };
export type Submission = { idempotencyKey: string; customerNote?: string; items: ItemInput[] };
export type Receipt = { ticketId: string; status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED"; replayed: boolean };

export class MenuApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const knownErrors: Record<string, string> = {
  DINING_QR_NOT_FOUND: "Mã QR này đã bị thu hồi hoặc không còn hợp lệ. Vui lòng báo nhân viên.",
  DINING_TABLE_NOT_OPEN: "Bàn chưa được nhân viên mở. Vui lòng gọi nhân viên hỗ trợ.",
  DINING_SESSION_CLOSED: "Phiên bàn đã kết thúc. Vui lòng báo nhân viên.",
  DINING_SESSION_NOT_OPEN: "Bàn đã đóng hoặc đang chuyển bàn. Không thể gửi yêu cầu.",
  DINING_GUEST_EXPIRED: "Phiên xem món đã hết hạn. Vui lòng tải lại từ mã QR trên bàn.",
  DINING_GUEST_GRANT_LIMIT: "Đã có quá nhiều lần kết nối bàn. Vui lòng nhờ nhân viên hỗ trợ.",
  DINING_TICKET_RATE_LIMIT: "Bàn đã gửi nhiều yêu cầu gần đây. Vui lòng đợi nhân viên xử lý.",
  DINING_IDEMPOTENCY_REUSED: "Phiếu này đã được dùng cho một nội dung khác. Vui lòng báo nhân viên.",
  PRODUCT_UNAVAILABLE: "Một món trong giỏ vừa hết hàng. Vui lòng chọn lại.",
  INVALID_MODIFIERS: "Size, topping hoặc độ cay chưa hợp lệ. Vui lòng kiểm tra món.",
  INVALID_COMBO_SELECTION: "Lựa chọn trong combo chưa hợp lệ. Vui lòng kiểm tra lại.",
};
export async function getApi<T>(path: string, credential?: string, method: "GET" | "POST" = "GET",
  body?: unknown, signal?: AbortSignal): Promise<T> {
  if (!isValidApiOrigin(API_ORIGIN)) throw new MenuApiError("Chưa thiết lập máy chủ an toàn.", 0);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12_000);
  const onAbort = () => abort.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  let response: Response;
  try {
    response = await fetch(API_ORIGIN + path, {
      method, cache: "no-store", signal: abort.signal,
      headers: { "Accept": "application/json", ...(credential ? { "Authorization": "Dining " + credential } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new MenuApiError("Kết nối gián đoạn hoặc hết thời gian chờ. Nếu đã gửi món, hãy kiểm tra trạng thái trước khi thử tiếp.", 0);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const err = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const raw = err.message ?? err.error;
    const code = typeof raw === "string" ? raw : "";
    throw new MenuApiError(knownErrors[code] ??
      (response.status === 401 ? "Quyền xem bàn đã hết hạn. Vui lòng quét lại." :
      response.status === 404 ? "Không tìm thấy bàn hoặc mã QR đã bị thay." :
      response.status === 409 ? "Bàn hoặc món đã thay đổi. Vui lòng kiểm tra lại." :
      response.status === 429 ? "Thao tác quá nhiều. Vui lòng thử lại sau." :
      response.status >= 500 ? "Máy chủ đang bận, thử lại sau." :
      "Không thể xử lý yêu cầu. Vui lòng thử lại."), response.status);
  }
  return data as T;
}
export function readQrHandle(search: string): string | null {
  const params = new URLSearchParams(search);
  const values = params.getAll("table");
  const value = values[0];
  if (values.length !== 1 || value === undefined || !/^[a-zA-Z0-9_-]{16,64}$/.test(value)) return null;
  return value;
}
export function productImage(key: string | null): string | null {
  if (!key || !/^(?:products-image|catalog-media)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*\.(?:png|webp|jpe?g)$/i.test(key) || key.includes("..")) return null;
  return "https://pub-63ed7b1c33514906ab6e2d82f41bffce.r2.dev/" + key;
}
export const money = (n: number) => new Intl.NumberFormat("vi-VN").format(n) + "đ";
