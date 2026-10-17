import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

const authScreen = read("../src/screens/AuthScreen.tsx");
const nativeGoogle = read("../src/auth/google-login.native.ts");
const webGoogle = read("../src/auth/google-login.web.ts");
const pushNative = read("../src/push-client.native.ts");
const app = JSON.parse(read("../app.json"));
const pkg = JSON.parse(read("../package.json"));

test("Android Google login uses native Google Sign-In, never browser custom redirect", () => {
  assert.equal(pkg.dependencies["@react-native-google-signin/google-signin"], "16.1.5");
  assert.ok(app.expo.plugins.includes("@react-native-google-signin/google-signin"));
  assert.match(nativeGoogle, /GoogleSignin\.configure/);
  assert.match(nativeGoogle, /GoogleSignin\.signIn\(\)/);
  assert.match(nativeGoogle, /webClientId: googleWebId/);
  assert.match(nativeGoogle, /package\/SHA-1/);
  assert.doesNotMatch(nativeGoogle, /expo-auth-session/);
  assert.doesNotMatch(nativeGoogle, /oauthredirect/);
  assert.match(authScreen, /useGoogleLogin/);
  assert.doesNotMatch(authScreen, /expo-auth-session\/providers\/google/);
  assert.doesNotMatch(authScreen, /googleAndroidRedirect/);
});

test("PWA keeps browser Google AuthSession isolated to web adapter", () => {
  assert.match(webGoogle, /expo-auth-session\/providers\/google/);
  assert.match(webGoogle, /useIdTokenAuthRequest/);
  assert.match(webGoogle, /window\.location\.origin/);
});

test("native push reports missing Firebase descriptor as configuration error", () => {
  assert.match(pushNative, /getDevicePushTokenAsync/);
  assert.match(pushNative, /google-services/);
  assert.match(pushNative, /vn\.sichuanhotpot\.customer/);
  assert.match(pushNative, /chưa có cấu hình Firebase Push/);
});
