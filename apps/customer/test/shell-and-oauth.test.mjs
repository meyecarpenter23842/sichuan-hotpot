import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/screens/AuthScreen.tsx", import.meta.url), "utf8");
const viewport = readFileSync(new URL("../scripts/lock-pwa-viewport.mjs", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
const appConfig = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));

test("Google OAuth callbacks are stable on web and Android", () => {
  assert.match(auth, /redirectUri: Platform\.OS === "web" \? window\.location\.origin \+ "\/" : googleAndroidRedirect/);
  assert.match(auth, /const googleAndroidRedirect = "vn\.sichuanhotpot\.customer:\/oauthredirect"/);
  assert.match(auth, /Google\.useIdTokenAuthRequest/);
  assert.equal(appConfig.expo.android.package, "vn.sichuanhotpot.customer");
  assert.ok(Array.isArray(appConfig.expo.scheme));
  assert.ok(appConfig.expo.scheme.includes("sichuanhotpot"));
  assert.ok(appConfig.expo.scheme.includes("vn.sichuanhotpot.customer"));
});

test("Google cancel/error states and Android API origin have explicit guards", () => {
  assert.match(auth, /googleResponse\.type === "cancel" \|\| googleResponse\.type === "dismiss"/);
  assert.match(auth, /setGoogleBusy\(false\)/);
  assert.match(auth, /Bạn đã hủy đăng nhập Google/);
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
