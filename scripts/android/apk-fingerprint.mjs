import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const app = process.argv[2];
if (!["customer", "admin"].includes(app)) {
  throw new Error("Usage: node scripts/android/apk-fingerprint.mjs customer|admin");
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDir = join(root, "apps", app, "android");
const apk = join(appDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!existsSync(apk)) throw new Error(`APK not found for ${app}. Build release first.`);

const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk"),
].filter(Boolean);
let signer;
for (const sdk of sdkCandidates) {
  const tools = join(sdk, "build-tools");
  if (!existsSync(tools)) continue;
  const versions = readdirSync(tools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const apkSignerJar = join(tools, version, "lib", "apksigner.jar");
    if (existsSync(apkSignerJar)) { signer = apkSignerJar; break; }
  }
  if (signer) break;
}
if (!signer) {
  throw new Error("Android SDK build-tools/lib/apksigner.jar not found. Set ANDROID_HOME or ANDROID_SDK_ROOT.");
}
// Invoke the SDK tool's Java entrypoint directly. Windows cmd.exe quoting
// of apksigner.bat breaks when Node passes /s /c args; Java argv is portable.
const java = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java")
  : "java";
const verify = spawnSync(java, [
  "-cp", signer, "com.android.apksigner.ApkSignerTool",
  "verify", "--print-certs", apk,
], { encoding: "utf8" });
if (verify.error || verify.status !== 0) {
  const details = String(verify.stderr || verify.error?.message || verify.stdout || "").trim().slice(0, 600);
  throw new Error("APK signature verification failed: " + (details || "apksigner returned exit code " + verify.status));
}
const sha1 = verify.stdout.match(/Signer #1 certificate SHA-1 digest:\s*([0-9a-f:]+)/i)?.[1];
const sha256 = verify.stdout.match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-f:]+)/i)?.[1];
if (!sha1 || !sha256) throw new Error("No APK signing certificate fingerprint found.");
console.log(`Android app: ${app}`);
console.log(`APK certificate SHA-1: ${sha1.toUpperCase()}`);
console.log(`APK certificate SHA-256: ${sha256.toUpperCase()}`);
const gradle = readFileSync(join(appDir, "app", "build.gradle"), "utf8");
if (/release\s*\{[^}]*signingConfig\s+signingConfigs\.debug/s.test(gradle)) {
  console.log("WARNING: This release APK is signed with a DEBUG key. Do not distribute as the final store release.");
}
console.log("Google Android OAuth requires the package name + SHA-1 of THIS installed APK's signer.");
console.log("Google Play App Signing uses the Play app-signing certificate SHA-1 instead.");
