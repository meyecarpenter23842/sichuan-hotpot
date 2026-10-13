import { ApiRequestError } from "../api";

export interface BrowserAccessSession {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
}

async function sessionPost<T>(path: "start" | "refresh" | "logout", body?: unknown): Promise<T> {
  // Vercel same-origin /api/session rewrite keeps the rotating refresh secret in
  // a Secure, HttpOnly, host-only cookie (never localStorage/AsyncStorage).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch("/api/session/" + path, {
      method: "POST", credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error("Không kết nối được phiên đăng nhập. Vui lòng kiểm tra mạng.");
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 401) {
    throw new ApiRequestError("Phiên đăng nhập không còn hợp lệ.", 401);
  }
  if (!response.ok) throw new Error("Không thể kết nối phiên đăng nhập. Vui lòng thử lại.");
  return response.json() as Promise<T>;
}

export async function startBrowserSession(refreshToken: string): Promise<void> {
  await sessionPost("start", { refreshToken });
}
export async function refreshBrowserSession(): Promise<BrowserAccessSession> {
  return sessionPost<BrowserAccessSession>("refresh");
}
export async function endBrowserSession(): Promise<void> {
  await sessionPost("logout");
}
