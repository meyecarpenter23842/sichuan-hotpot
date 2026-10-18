import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("Customer refresh session uses SecureStore on native and single-flight rotation", () => {
  assert.match(app, /SecureStore\.getItemAsync\(REFRESH_KEY\)/);
  assert.match(app, /SecureStore\.setItemAsync\(REFRESH_KEY, tokens\.refreshToken\)/);
  assert.match(app, /if \(refreshPending\) return refreshPending/);
  assert.match(app, /if \(refreshPending === work\) refreshPending = null/);
  assert.match(app, /if \(refreshPending\) await refreshPending\.catch/);
});
test("Customer guarded API recovery retries only rejected access JWT", () => {
  assert.match(api, /response\.status === 401 && options\.accessToken && sessionRecovery/);
  assert.match(api, /refreshed && refreshed !== options\.accessToken/);
  assert.match(app, /setCustomerSessionRecovery\(recoverAccess\)/);
  assert.match(app, /liveAccess\.current = tokens\.accessToken/);
  assert.match(app, /setAccessExpiresAt\(Date\.now\(\) \+ tokens\.accessTokenExpiresInSeconds \* 1000\)/);
});
test("Logout invalidates in-flight recovery while retryable network outage retains login", () => {
  assert.match(app, /\+\+storedSessionEpoch/);
  assert.match(app, /authEpoch\.current \+= 1;\s*liveAccess\.current = ""/);
  assert.match(app, /error instanceof ApiRequestError && error\.status === 401/);
  assert.match(app, /setNotice\("Mạng gián đoạn\. Ứng dụng sẽ thử kết nối lại\."\)/);
});
