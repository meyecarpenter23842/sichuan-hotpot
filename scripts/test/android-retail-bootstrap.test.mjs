import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identities } from "../android/release-identity.mjs";
import { isRetailCiFixture, assertRetailSigningEnvironment, patchRetailSigningGradle } from "../android/retail-signing.mjs";
import { assertAndroidReleaseEnv } from "../android/release-env.mjs";

test("Retail identity stays separate from Admin and Customer", () => {
  const config = JSON.parse(new TextDecoder().decode(
    // import assertion would tie this test to a TypeScript/ESM mode.
    readFileSync(new URL("../../apps/retail/app.json", import.meta.url))
  )).expo;
  assert.equal(config.android.package, "vn.sichuanhotpot.retail");
  assert.equal(config.name, identities.retail.label);
  assert.equal(config.scheme, "sichuanhotpotretail");
  assert.equal(new Set(Object.values(identities).map(x => x.packageId)).size, 3);
});
test("Retail Android release env requires real HTTPS origin outside CI", () => {
  assert.throws(() => assertAndroidReleaseEnv("retail", {}), /EXPO_PUBLIC_API_BASE_URL/);
  assert.deepEqual(assertAndroidReleaseEnv("retail", { CI: "1",
    EXPO_PUBLIC_API_BASE_URL: "https://api-ci.invalid" }), { isCiPlaceholder: true });
});
test("Retail signing cannot silently rotate or reuse a debug key", () => {
  assert.ok(isRetailCiFixture({CI:"1",HOTPOT_FIREBASE_CI_FIXTURE:"1"}));
  assert.throws(() => assertRetailSigningEnvironment({CI:"1"}), /keystore/);
  const dir = mkdtempSync(join(tmpdir(), "hotpot-retail-sign-"));
  const keystore = join(dir, "retail.jks");
  try {
    writeFileSync(keystore, "test-placeholder-only");
    const keys = { HOTPOT_RETAIL_KEYSTORE_PATH: keystore,
      HOTPOT_RETAIL_KEYSTORE_PASSWORD:"secret", HOTPOT_RETAIL_KEY_ALIAS:"retail",
      HOTPOT_RETAIL_KEY_PASSWORD:"secret" };
    assert.throws(() => assertRetailSigningEnvironment(keys), /SHA-256/);
    assert.deepEqual(assertRetailSigningEnvironment({
      ...keys, HOTPOT_RETAIL_EXPECTED_SHA256: "f".repeat(64) }), { ciFixture: false });
  } finally { rmSync(dir, {recursive:true,force:true}); }
});
test("Retail signer patches only release, not debug, and preserves existing work", () => {
  const source = `android { signingConfigs {
    debug { storePassword "android" }
  }
  buildTypes {
    debug { signingConfig signingConfigs.debug }
    release {
      signingConfig signingConfigs.debug
    }
  }
}`;
  const patched = patchRetailSigningGradle(source);
  assert.match(patched, /RETAIL_SIGNING_CONTRACT_V1/);
  assert.equal((patched.match(/signingConfigs\.retailRelease/g) || []).length, 1);
  assert.equal(patchRetailSigningGradle(patched), patched);
  assert.throws(() => patchRetailSigningGradle(source.replace("signingConfigs.debug", "signingConfigs.another")), /layout/);
});

test("Retail preflight uses the same effective API/signing environment in Gradle", () => {
  const code = readFileSync(new URL("../android/build-release.mjs", import.meta.url), "utf8");
  assert.match(code, /spawnSync\(command, args, \{ cwd: gradleDirectory, stdio: "inherit", env: buildEnvironment \}\)/);
  assert.match(code, /spawnSync\(process\.execPath, \[join\(repoRoot, "scripts", "android", "apk-fingerprint\.mjs"\), app\],[\s\S]*?env: buildEnvironment/);
});

test("Retail distribution occurs only after certificate verification succeeds", () => {
  const code = readFileSync(new URL("../android/build-release.mjs", import.meta.url), "utf8");
  const apkSigner = code.indexOf('join(repoRoot, "scripts", "android", "apk-fingerprint.mjs")');
  const checkResult = code.indexOf('if (checked.status !== 0) throw new Error');
  const publish = code.indexOf('copyFileSync(apk, namedApk)');
  assert.ok(apkSigner > 0 && checkResult > apkSigner && publish > checkResult,
    "A failed Retail signature must abort before writing dist/android");
  assert.match(code, /if \(app === "retail"\) \{\s+const checked/);
});

test("Android emulator tablet mode uses portrait-native base dimensions before rotation", () => {
  const script = readFileSync(new URL("../qa/retail-native-emulator-qa.sh", import.meta.url), "utf8");
  assert.doesNotMatch(script, /^adb shell wm size 1280x800$/m,
    "wm size is unrotated; landscape-size input plus rotation=1 makes a portrait screenshot");
  assert.match(script, /adb shell wm size 800x1280\s+adb shell wm density 160\s+adb shell settings put system user_rotation 1\s+sleep 5\s+verify_login tablet-landscape/);
  assert.match(script, /verify_login tablet-landscape\s+adb shell settings put system user_rotation 0\s+sleep 5\s+verify_login tablet-portrait/);
});
