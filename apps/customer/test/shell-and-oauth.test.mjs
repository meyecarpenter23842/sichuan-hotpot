import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/screens/AuthScreen.tsx", import.meta.url), "utf8");
const nativeGoogle = readFileSync(new URL("../src/auth/google-login.native.ts", import.meta.url), "utf8");
const webGoogle = readFileSync(new URL("../src/auth/google-login.web.ts", import.meta.url), "utf8");
const viewport = readFileSync(new URL("../scripts/lock-pwa-viewport.mjs", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const appConfig = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));

test("Google auth is platform-correct on web and Android", () => {
  assert.match(webGoogle, /Google\.useIdTokenAuthRequest/);
  assert.match(webGoogle, /window\.location\.origin \+ "\/"/);
  assert.match(nativeGoogle, /GoogleSignin\.configure/);
  assert.match(nativeGoogle, /GoogleSignin\.signIn\(\)/);
  assert.doesNotMatch(nativeGoogle, /oauthredirect|expo-auth-session/);
  assert.equal(appConfig.expo.android.package, "vn.sichuanhotpot.customer");
  assert.ok(appConfig.expo.plugins.includes("@react-native-google-signin/google-signin"));
  assert.ok(Array.isArray(appConfig.expo.scheme));
  assert.ok(appConfig.expo.scheme.includes("sichuanhotpot"));
  assert.ok(appConfig.expo.scheme.includes("vn.sichuanhotpot.customer"));
});

test("Google cancel/config errors and Android API origin have explicit guards", () => {
  assert.match(auth, /response\.type === "cancel"/);
  assert.match(auth, /Bạn đã hủy đăng nhập Google/);
  assert.match(nativeGoogle, /DEVELOPER_ERROR/);
  assert.match(nativeGoogle, /package\/SHA-1/);
  assert.match(api, /Platform\.OS !== "web" && isLocal/);
  assert.match(api, /không dùng localhost/);
});

test("homepage is search-free while Menu retains search", () => {
  assert.doesNotMatch(app, /<View style=\{styles\.homeSearch\}>/);
  assert.match(app, /case "menu":/);
  assert.match(app, /<Field label="Tìm món ăn, trà sữa"/);
});

test("bottom nav is viewport anchored with only content scrolling", () => {
  assert.match(app, /bottomNavigation: \{ position: "absolute", left: 0, right: 0, bottom: 0/);
  assert.match(app, /body: \{ flex: 1, minHeight: 0, paddingBottom: 58 \}/);
  assert.match(viewport, /#root\{height:100dvh;min-height:0\}/);
  assert.match(viewport, /overflow:hidden/);
});
