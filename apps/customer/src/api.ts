export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
export interface Variant {
  id: string;
  name: string;
  priceDeltaVnd: number;
  isAvailable: boolean;
}
export interface ModifierOption {
  id: string; name: string; priceDeltaVnd: number; isAvailable: boolean;
  imageKey?: string | null;
}
export interface ModifierGroup {
  id: string; name: string; minSelect: number; maxSelect: number;
  imageKey?: string | null;
  options: ModifierOption[];
}
export interface Product {
  id: string;
  name: string;
  priceVnd: number;
  isAvailable: boolean;
  isFeatured: boolean;
  sortOrder: number;
  variants: Variant[];
  modifierGroups: ModifierGroup[];
  imageKey: string | null;
}
export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  imageKey?: string | null;
  products: Product[];
}
/** Public promotion is editorial content, not a cart discount. */
export interface HomeOffer {
  id:string; title:string; summary:string; body:string; imageKey:string;
  ctaTarget:"MENU"|null; startAt:string|null; endAt:string|null; sortOrder:number;
}
export type HomeHeroTransition="fade"|"slide"|"wipe";
export interface HomeHeroSettings {
  autoplay:boolean;dwellMs:number;transitionType:HomeHeroTransition;
  transitionDurationMs:number;revision:number;updatedAt:string|null;
}
export interface HomeHeroSlide {
  id:string;imageKey:string;altText:string;title:string|null;subtitle:string|null;
  ctaTarget:"MENU"|null;sortOrder:number;
}
export interface HomeHeroPayload { settings:HomeHeroSettings; slides:HomeHeroSlide[]; }
export interface BranchMenu extends BranchSummary {
  categories: Category[];
}
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
}
export interface SavedAddress {
  id: string; label: string; line1: string; latitude: string; longitude: string;
  catalogVersion: string | null; provinceCode: string | null; wardCode: string | null;
}
export interface SavedAddresses { phone: string | null; addresses: SavedAddress[]; }

export function safeProductImageUrl(key: string | null | undefined): string | null {
  if (!key || !(/^(?:products-image|catalog-media)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*\.(?:png|webp|jpe?g)$/i.test(key))
    || key.includes("..")) return null;
  return "https://pub-63ed7b1c33514906ab6e2d82f41bffce.r2.dev/" + key;
}
export interface DeliveryQuote {
  branchId: string; addressId: string; policyVersionId: string;
  pricingMode: "ZONE" | "DISTANCE";
  routeDistanceMeters: number | null; subtotalVnd: number; feeVnd: number;
  zoneId: string | null; zoneName: string | null;
  provinceCode: string | null; wardCode: string | null; catalogVersion: string | null;
  extraSteps: number | null; totalVnd: number; freeDeliveryApplied: boolean;
  quoteExpiresAt: string;
}
export interface QrPaymentInstructions {
  bankBin: string; accountNo: string; accountName: string;
  transferReference: string; amountVnd: number; imageUrl: string;
}
export interface PaymentMethods { codAvailable: boolean; qrAvailable: boolean; }
export interface CheckoutReceipt {
  orderId: string; status: string; totalVnd: number;
  paymentMethod: "COD" | "QR"; paymentStatus: string; replayed: boolean;
  qr: QrPaymentInstructions | null;
}
export interface CustomerOrderSummary {
  id: string; branchId: string; status: string; createdAt: string;
  subtotalVnd: number; deliveryFeeVnd: number; totalVnd: number;
  payment: { method: "COD" | "QR"; status: string } | null;
}
export interface CustomerOrderDetail extends CustomerOrderSummary {
  roadDistanceMeters: number | null; pricingMode: "ZONE" | "DISTANCE";
  zoneNameSnapshot: string | null; provinceCodeSnapshot: string | null;
  wardCodeSnapshot: string | null; catalogVersionSnapshot: string | null;
  addressLineSnapshot: string;
  payment: { method: "COD" | "QR"; status: string; amountVnd: number;
    qr: QrPaymentInstructions | null } | null;
  items: {
    productId: string | null; productName: string; variantName: string | null;
    quantity: number; unitPriceVnd: number; lineTotalVnd: number;
    modifiers: { name: string; priceVnd: number }[];
  }[];
  statusHistory: {
    fromStatus: string | null; toStatus: string; createdAt: string; reason: string | null;
  }[];
}
export interface Principal {
  id: string;
  role: string;
}

const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ?? "";
const localApi = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/;
const validApi = /^https:\/\/[a-z\d.-]+(?::\d+)?(?:\/.*)?$/i;
const customerBusinessErrors: Readonly<Record<string, string>> = {
  STORE_CLOSED: "Hiện quán đã nghỉ. Giỏ hàng của bạn vẫn được giữ lại; vui lòng đặt khi quán mở cửa trở lại.",
  BELOW_MINIMUM: "Đơn hàng chưa đạt giá trị tối thiểu để giao.",
  OUT_OF_RANGE: "Địa chỉ ngoài phạm vi giao.",
  ADDRESS_REGION_UNCONFIRMED: "Địa chỉ chưa chọn tỉnh/phường theo danh mục. Vui lòng cập nhật địa chỉ trước khi đặt.",
  ZONE_NOT_SERVED: "Cửa hàng chưa giao đến khu vực hành chính của địa chỉ này.",
  ZONE_RATE_MISSING: "Khu vực chưa được thiết lập phí giao. Không thể đặt đơn lúc này.",
  INVALID_POLICY: "Cấu hình phí giao chưa hợp lệ. Cửa hàng cần kiểm tra lại.",
  INVALID_SUBTOTAL: "Giá trị giỏ hàng không hợp lệ, vui lòng kiểm tra món.",
  ROUTE_UNAVAILABLE: "Không tìm được tuyến đường giao hợp lệ. Hãy chọn lại ghim.",
  QR_NOT_CONFIGURED: "Cửa hàng chưa cấu hình thanh toán QR. Vui lòng dùng COD.",
};

export function apiBaseUrl(): string {
  if (!configured || (!validApi.test(configured) && !localApi.test(configured))) {
    throw new Error("Chưa cấu hình HTTPS EXPO_PUBLIC_API_BASE_URL cho ứng dụng.");
  }
  return configured.replace(/\/+$/, "");
}

export async function apiRequest<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; accessToken?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const url = apiBaseUrl() + path;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const signal = options.signal ?? controller.signal;
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.accessToken ? { Authorization: "Bearer " + options.accessToken } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) {
        if (path === "/auth/login") throw new Error("Tên đăng nhập hoặc mật khẩu không đúng.");
        if (path === "/auth/google") throw new Error("Google chưa xác thực được tài khoản. Vui lòng thử lại.");
        throw new ApiRequestError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.", 401);
      }
      if (response.status === 409) throw new Error(path.startsWith("/customer/")
        ? "Đơn hoặc báo phí đã thay đổi. Kiểm tra lại đơn hàng trước khi thử lại."
        : "Tên đăng nhập hoặc email đã được sử dụng.");
      if (response.status === 429) throw new Error("Thao tác quá nhanh. Vui lòng thử lại sau.");
      if (response.status === 404) throw new Error(path.startsWith("/auth/")
        ? "Chức năng xác thực chưa được cập nhật trên máy chủ."
        : "Dữ liệu chưa có hoặc chi nhánh không khả dụng.");
      if (response.status === 503 && path.startsWith("/auth/"))
        throw new Error("Email xác minh hoặc dịch vụ đăng nhập chưa được cấu hình trên máy chủ.");
      if (response.status === 503 && path.startsWith("/customer/"))
        throw new Error("Chưa cấu hình chính sách phí giao hợp lệ. Cửa hàng chưa thể nhận đơn.");
      if (response.status >= 500) throw new Error("Máy chủ đang gặp sự cố. Vui lòng thử lại.");
      if (response.status === 422 && path.startsWith("/customer/")) {
        const errorPayload = data && typeof data === "object" && "error" in data
          ? (data as { error?: unknown }).error : null;
        const businessCode = errorPayload && typeof errorPayload === "object"
          && "code" in errorPayload ? (errorPayload as { code?: unknown }).code : null;
        if (typeof businessCode === "string" && customerBusinessErrors[businessCode]) {
          throw new Error(customerBusinessErrors[businessCode]);
        }
        throw new Error("Món, giá trị đơn hoặc khu vực giao chưa hợp lệ. Kiểm tra lại trước khi đặt.");
      }
      if (response.status === 400 && (path.endsWith("confirm-code") || path.endsWith("/reset")))
        throw new Error("Mã xác minh không đúng, hết hạn hoặc mật khẩu chưa hợp lệ.");
      throw new Error("Yêu cầu chưa hợp lệ. Vui lòng kiểm tra thông tin.");
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Kết nối quá lâu. Vui lòng thử lại.");
    }
    if (error instanceof TypeError) throw new Error("Không kết nối được máy chủ. Vui lòng kiểm tra mạng.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
