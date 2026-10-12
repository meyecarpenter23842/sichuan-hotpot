export interface BranchSummary {
  id: string;
  code: string;
  name: string;
}
export interface Variant {
  id: string;
  name: string;
  priceDeltaVnd: number;
  isAvailable: boolean;
}
export interface Product {
  id: string;
  name: string;
  priceVnd: number;
  isAvailable: boolean;
  variants: Variant[];
}
export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  products: Product[];
}
export interface BranchMenu extends BranchSummary {
  categories: Category[];
}
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
}
export interface Principal {
  id: string;
  role: string;
}

const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ?? "";
const localApi = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/;
const validApi = /^https:\/\/[a-z\d.-]+(?::\d+)?(?:\/.*)?$/i;

export function apiBaseUrl(): string {
  if (!configured || (!validApi.test(configured) && !localApi.test(configured))) {
    throw new Error("Chưa cấu hình HTTPS EXPO_PUBLIC_API_BASE_URL cho ứng dụng.");
  }
  return configured.replace(/\/+$/, "");
}

export async function apiRequest<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; accessToken?: string; signal?: AbortSignal } = {},
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
      if (response.status === 401) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
      if (response.status === 409) throw new Error("Tên đăng nhập đã được sử dụng.");
      if (response.status === 429) throw new Error("Thao tác quá nhanh. Vui lòng thử lại sau.");
      if (response.status === 404) throw new Error("Dữ liệu chưa có hoặc chi nhánh không khả dụng.");
      if (response.status >= 500) throw new Error("Máy chủ đang gặp sự cố. Vui lòng thử lại.");
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
