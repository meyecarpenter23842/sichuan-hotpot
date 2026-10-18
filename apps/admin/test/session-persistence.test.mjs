import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("Admin native persists refresh credentials only in SecureStore", () => {
  assert.match(api, /SecureStore\.setItemAsync\(REFRESH_KEY, refreshToken\)/);
  assert.match(api, /SecureStore\.getItemAsync\(REFRESH_KEY\)/);
  assert.match(api, /SecureStore\.deleteItemAsync\(REFRESH_KEY\)/);
  assert.doesNotMatch(api, /AsyncStorage\.setItem\(REFRESH_KEY/);
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
