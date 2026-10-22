import * as SecureStore from "expo-secure-store";
import type { Tokens } from "./pos-api";

const STORAGE_KEY = "hotpot.retail.staff-session.v1";
function valid(value: unknown): value is Tokens {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return typeof t.accessToken === "string" && t.accessToken.length > 0 &&
    typeof t.refreshToken === "string" && t.refreshToken.length > 0 &&
    typeof t.accessTokenExpiresInSeconds === "number";
}
/** Android KeyStore-backed credential persistence. Never use AsyncStorage for JWT. */
export async function loadStoredSession(): Promise<Tokens | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (valid(parsed)) return parsed;
  } catch { /* clear corrupted entries */ }
  await SecureStore.deleteItemAsync(STORAGE_KEY);
  return null;
}
export async function writeStoredSession(tokens: Tokens | null): Promise<void> {
  if (tokens) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(tokens),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
}
