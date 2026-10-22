import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = path => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
test("Native Retail session uses device-keystore SecureStore, never plaintext AsyncStorage", () => {
  const native = source("session-storage.native.ts");
  assert.match(native, /expo-secure-store/);
  assert.match(native, /SecureStore\.getItemAsync/);
  assert.match(native, /SecureStore\.deleteItemAsync/);
  assert.match(native, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.doesNotMatch(native, /AsyncStorage|localStorage/);
});
test("Web session remains memory only and refresh rotation persists on native", () => {
  const web = source("session-storage.ts");
  const api = source("pos-api.ts");
  assert.doesNotMatch(web, /localStorage\.|sessionStorage\./);
  assert.match(api, /if \(active === original\) setSession\(next\)/);
  assert.match(api, /await writeTask\.catch/);
  assert.match(api, /restoreSession/);
});
test("Retail login restores only verified staff scope before showing POS", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /const existing = await restoreSession\(\)/);
  assert.match(app, /await activateStaff\(existing\)/);
  assert.match(app, /const allowed = scoped\.filter/);
  assert.match(app, /setToken\(currentSession\(\)\?\.accessToken/);
});
