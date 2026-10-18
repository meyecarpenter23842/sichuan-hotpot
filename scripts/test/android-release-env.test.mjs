import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertAndroidReleaseEnv, loadReleaseEnv, resolveAndroidReleaseEnv } from "../android/release-env.mjs";

const valid = {
  EXPO_PUBLIC_API_BASE_URL: "https://api.example.com",
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "123456.apps.googleusercontent.com",
};

test("Expo release env honors process values and production dotenv priority", () => {
  const dir = mkdtempSync(join(tmpdir(), "hotpot-android-env-"));
  try {
    writeFileSync(join(dir, ".env"), "EXPO_PUBLIC_API_BASE_URL=https://fallback.example.com\n");
    writeFileSync(join(dir, ".env.production"), "EXPO_PUBLIC_API_BASE_URL=https://production.example.com\n");
    writeFileSync(join(dir, ".env.local"), "EXPO_PUBLIC_API_BASE_URL=https://local.example.com\n");
    writeFileSync(join(dir, ".env.production.local"), "EXPO_PUBLIC_API_BASE_URL=https://highest.example.com\n");
    assert.equal(loadReleaseEnv(dir, {}).EXPO_PUBLIC_API_BASE_URL, "https://highest.example.com");
    assert.equal(loadReleaseEnv(dir, { EXPO_PUBLIC_API_BASE_URL: "https://shell.example.com" }).EXPO_PUBLIC_API_BASE_URL, "https://shell.example.com");
    assert.equal(loadReleaseEnv(dir, { EXPO_NO_DOTENV: "1" }).EXPO_PUBLIC_API_BASE_URL, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Admin inherits Customer HTTPS API only when its own release config is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "hotpot-shared-api-"));
  try {
    mkdirSync(join(root, "apps", "customer"), { recursive: true });
    mkdirSync(join(root, "apps", "admin"), { recursive: true });
    writeFileSync(join(root, "apps", "customer", ".env.local"),
      "EXPO_PUBLIC_API_BASE_URL=https://customer-api.example.com\n");
    const fallback = resolveAndroidReleaseEnv(root, "admin", {});
    assert.equal(fallback.environment.EXPO_PUBLIC_API_BASE_URL, "https://customer-api.example.com");
    assert.equal(fallback.inheritedFromCustomer, true);
    assertAndroidReleaseEnv("admin", fallback.environment);

    writeFileSync(join(root, "apps", "admin", ".env.local"),
      "EXPO_PUBLIC_API_BASE_URL=https://admin-api.example.com\n");
    const override = resolveAndroidReleaseEnv(root, "admin", {});
    assert.equal(override.environment.EXPO_PUBLIC_API_BASE_URL, "https://admin-api.example.com");
    assert.equal(override.inheritedFromCustomer, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("admin/customer releases cannot silently embed an absent, invalid, or CI API", () => {
  for (const base of ["", "http://localhost:3000", "https://api-ci.invalid", "https://api.example.com/auth", "https://api.example.com?x=y"]) {
    assert.throws(() => assertAndroidReleaseEnv("admin", { EXPO_PUBLIC_API_BASE_URL: base }), /EXPO_PUBLIC_API_BASE_URL/);
  }
  assert.deepEqual(assertAndroidReleaseEnv("admin", valid), { isCiPlaceholder: false });
  assert.deepEqual(assertAndroidReleaseEnv("customer", valid), { isCiPlaceholder: false });
});

test("CI Windows APK validation may use explicit placeholders but never implies production OAuth", () => {
  assert.deepEqual(assertAndroidReleaseEnv("customer", {
    CI: "1",
    EXPO_NO_DOTENV: "1",
    EXPO_PUBLIC_API_BASE_URL: "https://api-ci.invalid",
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "ci-web.apps.googleusercontent.com",
  }), { isCiPlaceholder: true });
  assert.throws(() => assertAndroidReleaseEnv("customer", {
    EXPO_PUBLIC_API_BASE_URL: valid.EXPO_PUBLIC_API_BASE_URL,
  }), /GOOGLE_WEB_CLIENT_ID/);
  assert.throws(() => assertAndroidReleaseEnv("customer", {
    ...valid, EXPO_NO_CLIENT_ENV_VARS: "1",
  }), /inlining is disabled/);
});

test("Admin exposes invalid API config instead of mislabeling it as network outage", () => {
  const api = readFileSync(new URL("../../apps/admin/src/api.ts", import.meta.url), "utf8");
  // URL configuration validation happens before the request/retry catch,
  // so malformed EXPO_PUBLIC_API_BASE_URL is never reported as a network outage.
  assert.match(api, /const origin = apiOrigin\(\);/);
  assert.match(api, /const send = \(access\?: string\) => fetch\(origin \+ path/);
  assert.ok(api.indexOf("const origin = apiOrigin();") < api.indexOf("  try {\n    response = await send(token);"));
});

test("release builder validates runtime env and can show signer fingerprint", () => {
  const script = readFileSync(new URL("../android/build-release.mjs", import.meta.url), "utf8");
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(script, /resolveAndroidReleaseEnv\(repoRoot, app\)/);
  assert.match(script, /process\.env\.EXPO_PUBLIC_API_BASE_URL = buildEnvironment\.EXPO_PUBLIC_API_BASE_URL/);
  assert.equal(manifest.scripts["android:sha1:customer"], "node scripts/android/apk-fingerprint.mjs customer");
  assert.equal(manifest.scripts["android:sha1:admin"], "node scripts/android/apk-fingerprint.mjs admin");
});
