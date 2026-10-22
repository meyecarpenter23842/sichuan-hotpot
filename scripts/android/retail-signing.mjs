import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** CI APKs use a disposable debug certificate and MUST NEVER be distributed. */
export function isRetailCiFixture(env = process.env) {
  return env.CI === "1" && env.HOTPOT_FIREBASE_CI_FIXTURE === "1";
}

export function assertRetailSigningEnvironment(env = process.env) {
  if (isRetailCiFixture(env)) return { ciFixture: true };
  const keyPath = String(env.HOTPOT_RETAIL_KEYSTORE_PATH || "").trim();
  if (!keyPath || !isAbsolute(keyPath) || !existsSync(keyPath)) {
    throw new Error("Retail release keystore missing. Set HOTPOT_RETAIL_KEYSTORE_PATH to the existing fixed keystore.");
  }
  for (const key of ["HOTPOT_RETAIL_KEYSTORE_PASSWORD", "HOTPOT_RETAIL_KEY_ALIAS", "HOTPOT_RETAIL_KEY_PASSWORD"]) {
    if (!String(env[key] || "").trim()) throw new Error("Missing Retail signing environment key: " + key);
  }
  if (!/^[0-9a-fA-F:]{64,95}$/.test(String(env.HOTPOT_RETAIL_EXPECTED_SHA256 || "")) ||
      String(env.HOTPOT_RETAIL_EXPECTED_SHA256).replaceAll(":", "").length !== 64) {
    throw new Error("Retail fixed certificate SHA-256 not pinned in HOTPOT_RETAIL_EXPECTED_SHA256.");
  }
  return { ciFixture: false };
}

const releaseConfig = `
        // RETAIL_SIGNING_CONTRACT_V1: CI fixture is never a production signature.
        retailRelease {
            if (System.getenv("CI") == "1" && System.getenv("HOTPOT_FIREBASE_CI_FIXTURE") == "1") {
                storeFile file("debug.keystore")
                storePassword "android"
                keyAlias "androiddebugkey"
                keyPassword "android"
            } else {
                storeFile System.getenv("HOTPOT_RETAIL_KEYSTORE_PATH") ? file(System.getenv("HOTPOT_RETAIL_KEYSTORE_PATH")) : null
                storePassword System.getenv("HOTPOT_RETAIL_KEYSTORE_PASSWORD")
                keyAlias System.getenv("HOTPOT_RETAIL_KEY_ALIAS")
                keyPassword System.getenv("HOTPOT_RETAIL_KEY_PASSWORD")
            }
        }`;

export function patchRetailSigningGradle(source) {
  if (source.includes("RETAIL_SIGNING_CONTRACT_V1")) {
    if (!/signingConfig\s+signingConfigs\.retailRelease/.test(source)) throw new Error("Retail Gradle signer was changed.");
    return source;
  }
  if ((source.match(/signingConfigs\s*\{/g) || []).length !== 1) {
    throw new Error("Unexpected Retail Gradle signingConfigs block.");
  }
  if ((source.match(/signingConfig\s+signingConfigs\.debug/g) || []).length !== 2) {
    throw new Error("Unexpected Retail Gradle debug/release signing layout; inspect generated project.");
  }
  const withSigner = source.replace(/(signingConfigs\s*\{)/, "$1\n" + releaseConfig);
  const replaced = withSigner.replace(
    /(\brelease\s*\{[\s\S]*?\bsigningConfig\s+)signingConfigs\.debug/,
    "$1signingConfigs.retailRelease",
  );
  if ((replaced.match(/signingConfig\s+signingConfigs\.retailRelease/g) || []).length !== 1 ||
      (replaced.match(/signingConfig\s+signingConfigs\.debug/g) || []).length !== 1) {
    throw new Error("Cannot safely select Retail release signing config.");
  }
  return replaced;
}

export function configureRetailSigning(appDirectory) {
  const file = join(appDirectory, "android", "app", "build.gradle");
  const previous = readFileSync(file, "utf8");
  const patched = patchRetailSigningGradle(previous);
  if (patched !== previous) writeFileSync(file, patched);
}
