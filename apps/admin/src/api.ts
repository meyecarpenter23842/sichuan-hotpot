import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

export type StaffRole = "OWNER" | "MANAGER" | "KITCHEN" | "DRIVER" | "CUSTOMER";
export interface Principal { id: string; role: StaffRole }
export interface AuthTokens {
  accessToken: string; refreshToken: string; accessTokenExpiresInSeconds: number;
}
export interface Branch { id: string; code: string; name: string; address: string | null;
  latitude: string | number; longitude: string | number; isActive: boolean; staffRole?: StaffRole }
export interface CatalogOption { id: string; name: string; priceDeltaVnd: number; isAvailable: boolean }
export type CatalogVariant = CatalogOption;
export interface CatalogGroup {
  id: string; name: string; minSelect: number; maxSelect: number; sortOrder: number;
  options: CatalogOption[];
}
export interface CatalogProduct {
  id: string; categoryId: string; name: string; priceVnd: number; isAvailable: boolean;
  isFeatured: boolean; sortOrder: number; soldCount: number;
  imageKey: string | null; variants: CatalogVariant[]; modifierGroups: CatalogGroup[];
}
export interface CatalogCategory {
  id: string; name: string; sortOrder: number; products: CatalogProduct[];
}
export interface OpeningHour {
  weekday: number; opensAt: string; closesAt: string; isClosed: boolean;
}
export interface AdminCatalog extends Branch {
  categories: CatalogCategory[]; openingHours: OpeningHour[]; catalogRevision: number;
}
const REFRESH_KEY = "sichuan.admin.refresh.v1";
const WEB_SESSION_MARKER = "sichuan.admin.pwa.session-present.v1";
const rawOrigin = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

function apiOrigin(): string {
  const origin = rawOrigin.trim().replace(/\/$/, "");
  let url: URL;
  try { url = new URL(origin); } catch { throw Error("Chưa cấu hình máy chủ API Admin."); }
  const development = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((!development && url.protocol !== "https:") || url.origin !== origin) {
    throw Error("Địa chỉ API Admin phải là HTTPS hợp lệ.");
  }
  return origin;
}
export class AdminApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
export async function request<T>(path: string, token?: string, method = "GET",
  body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(apiOrigin() + path, {
      method, signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error("Không kết nối được API. Kiểm tra mạng rồi thử lại.");
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const serverMessage = data && typeof data === "object" && "message" in data
      && typeof data.message === "string" ? data.message : null;
    // Login 401 means invalid credentials, NOT an expired session.
    // Reserve the session-expired message for authenticated refresh/API calls.
    const message = response.status === 401 && path === "/auth/login"
      ? "Tên đăng nhập hoặc mật khẩu không đúng."
      : serverMessage ?? (
        response.status === 401 ? "Phiên đăng nhập đã hết hạn." :
        response.status === 403 ? "Tài khoản không có quyền quản trị chi nhánh này." :
        "Yêu cầu thất bại (" + response.status + ").");
    throw new AdminApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
async function webSession<T>(step: "start" | "refresh" | "logout", body?: object) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/api/session/" + step, {
      method: "POST", credentials: "same-origin", signal: controller.signal,
      headers: { Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) throw new AdminApiError("Phiên đăng nhập đã hết hạn.", 401);
    if (!response.ok) throw Error("Dịch vụ đăng nhập Admin đang gián đoạn.");
    return response.json() as Promise<T>;
  } finally { clearTimeout(timer); }
}
export async function rememberSession(refreshToken: string): Promise<void> {
  if (Platform.OS === "web") {
    await webSession("start", { refreshToken });
    await AsyncStorage.setItem(WEB_SESSION_MARKER, "1");
  } else await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
}
export async function refreshSession(): Promise<AuthTokens | null> {
  if (Platform.OS === "web") {
    if (await AsyncStorage.getItem(WEB_SESSION_MARKER) !== "1") return null;
    const result = await webSession<Omit<AuthTokens, "refreshToken">>("refresh");
    return { ...result, refreshToken: "" };
  }
  const old = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!old) return null;
  const next = await request<AuthTokens>("/auth/refresh", undefined, "POST", { refreshToken: old });
  await rememberSession(next.refreshToken);
  return next;
}
export async function forgetSession(token: string | null): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(WEB_SESSION_MARKER);
    await webSession("logout").catch(() => undefined);
  } else {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    if (token) await request("/auth/logout", token, "POST").catch(() => undefined);
  }
}
export function imageUrl(key: string | null): string | null {
  if (!key || !/^products-image\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)*\.(?:png|webp|jpe?g)$/i.test(key)
    || key.includes("..")) return null;
  return "https://pub-63ed7b1c33514906ab6e2d82f41bffce.r2.dev/" + key;
}
