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
