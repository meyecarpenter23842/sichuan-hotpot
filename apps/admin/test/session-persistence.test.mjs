import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("Admin native persists refresh credentials only in SecureStore", () => {
  assert.match(api, /await persistNativeRefresh\(refreshToken\)/);
  assert.match(api, /SecureStore\.setItemAsync\(REFRESH_KEY, value\)/);
  assert.match(api, /SecureStore\.getItemAsync\(REFRESH_KEY\)/);
  assert.match(api, /SecureStore\.deleteItemAsync\(REFRESH_KEY\)/);
  assert.doesNotMatch(api, /AsyncStorage\.setItem\(REFRESH_KEY/);
});
test("Android keystore invalidation clears only unreadable refresh credential", () => {
  assert.match(api, /Could not decrypt the value/);
  assert.match(api, /Keystore operation failed/);
  assert.match(api, /if \(!invalidKey\) throw error/);
  assert.match(api, /SecureStore\.deleteItemAsync\(REFRESH_KEY\)/);
  assert.match(api, /return null; \/\/ the user must authenticate again/);
  assert.doesNotMatch(api, /AsyncStorage\.setItem\(REFRESH_KEY/);
  assert.match(app, /const nextAccess = await recoverAccess\(token\)/);
  assert.match(app, /if \(!nextAccess && epoch === sessionGeneration.current\)/);
});
test("Admin serializes one-time refresh rotation, does not replay ambiguous failures", () => {
  assert.match(api, /if \(refreshPending\) return refreshPending/);
  assert.match(api, /if \(refreshPending === work\) refreshPending = null/);
  assert.match(api, /response\.status === 401 && token && sessionRecovery/);
  assert.match(api, /refreshed && refreshed !== token/);
  assert.doesNotMatch(api, /response\.status >= 500 && sessionRecovery/);
});
test("Admin updates live token after refresh, reconnects order feeds and never clears session on network faults", () => {
  assert.match(app, /setAdminSessionRecovery\(recoverAccess\)/);
  assert.match(app, /liveAccess\.current = next\.accessToken/);
  assert.match(app, /setToken\(next\.accessToken\)/);
  assert.match(app, /setRestoreAttempt\(n => n \+ 1\)/);
  assert.match(app, /error instanceof AdminApiError && \(error\.status === 401 \|\| error\.status === 403\)/);
});

test("Admin Android persists one-time rotated successor before next refresh and never resurrects after logout", () => {
  assert.match(api, /activeNativeRefresh = next\.refreshToken/);
  assert.match(api, /await persistNativeRefresh\(next\.refreshToken\)/);
  assert.match(api, /if \(!old\) old = await SecureStore\.getItemAsync\(REFRESH_KEY\)/);
  assert.match(api, /if \(pendingNativePersistence\) await persistNativeRefresh\(old\)/);
  assert.match(api, /activeNativeRefresh = value/);
  assert.match(api, /if \(attempt < 2\) await new Promise/);
  assert.match(api, /if \(refreshPending\) await refreshPending\.catch/);
  assert.match(api, /activeNativeRefresh = null/);
  assert.doesNotMatch(api, /AsyncStorage\.setItem\(REFRESH_KEY/);
});
