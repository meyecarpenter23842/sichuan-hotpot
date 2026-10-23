// Use this instead of calling Gradle directly on a possibly stale Expo
// prebuild. Existing native files are preserved; only the known Gradle
// release-bundling contract is upgraded before assembling an APK.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureGeneratedAndroid } from "./release-gradle.mjs";
import { synchronizeAndroidIdentity } from "./release-identity.mjs";
import { assertAndroidReleaseEnv, resolveAndroidReleaseEnv } from "./release-env.mjs";
import { assertFirebaseConfig } from "./firebase-config.mjs";
import { readFileSync } from "node:fs";
import { assertRetailSigningEnvironment, configureRetailSigning } from "./retail-signing.mjs";

const require = createRequire(import.meta.url);
const app = process.argv[2];
if (!["customer", "admin", "retail"].includes(app) || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/android/build-release.mjs customer|admin|retail");
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDirectory = join(repoRoot, "apps", app);

// Prevent stale native projects from producing APKs with missing/wrong Google Services setup.
const firebase = assertFirebaseConfig(appDirectory, app);
const nativeGoogleServices = join(appDirectory, "android", "app", "google-services.json");
if (!existsSync(nativeGoogleServices) ||
    readFileSync(nativeGoogleServices, "utf8") !== readFileSync(firebase.file, "utf8")) {
  throw new Error("Generated Android Firebase config is missing/stale. Run npm run android:prebuild --workspace @hotpot/" + app + " again.");
}
if (firebase.fixture) console.warn("CI FIREBASE FIXTURE: nonfunctional APK for Gradle/Metro checks only; NEVER distribute.");

// Under NODE_ENV=production, npm ci silently omits dev dependencies even
// though Expo's Metro bundler needs them to build release JS.
try {
  require.resolve("object.assign/polyfill");
  require.resolve("expo/scripts/resolveAppEntry");
} catch (error) {
  throw new Error(
    "Incomplete npm dependencies for Android bundling. Run " +
    "'npm ci --include=dev --ignore-scripts --no-audit --no-fund' at repo root. " +
    "Original error: " + error.message,
  );
}

// Refuse to produce an installable-but-offline APK with empty or placeholder
// runtime configuration. Expo inlines EXPO_PUBLIC_* at bundle creation time.
const { environment: buildEnvironment, inheritedFromCustomer } =
  resolveAndroidReleaseEnv(repoRoot, app);
const runtime = assertAndroidReleaseEnv(app, buildEnvironment);
if (app === "retail") assertRetailSigningEnvironment(buildEnvironment);
if (inheritedFromCustomer) {
  process.env.EXPO_PUBLIC_API_BASE_URL = buildEnvironment.EXPO_PUBLIC_API_BASE_URL;
  console.log("Admin Android: using the shared Customer API origin (no Admin override found).");
}
if (runtime.isCiPlaceholder) {
  console.log("CI-only APK: placeholder API/OAuth values, not a production distribution build.");
}

// Validates Expo's entry file, refuses unexpected Gradle customizations,
// and repairs an existing #186 native project without --clean/prebuild.
configureGeneratedAndroid(appDirectory);
synchronizeAndroidIdentity(appDirectory, app);
if (app === "retail") configureRetailSigning(appDirectory);

const gradleDirectory = join(appDirectory, "android");
const isWindows = process.platform === "win32";
const command = isWindows ? (process.env.ComSpec || "cmd.exe") : "./gradlew";
const args = isWindows
  ? ["/d", "/s", "/c", "gradlew.bat :app:assembleRelease --no-daemon"]
  : [":app:assembleRelease", "--no-daemon"];
console.log(`Building ${app} Android release APK using verified Expo Gradle configuration...`);
const build = spawnSync(command, args, { cwd: gradleDirectory, stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exitCode = build.status ?? 1;
else {
  const apk = join(gradleDirectory, "app", "build", "outputs", "apk", "release", "app-release.apk");
  if (!existsSync(apk)) throw new Error("Gradle reported success but release APK was not found.");
  // Publish stable app-specific file names. Android installs by applicationId,
  // not the source filename, but copying two generic app-release.apk files
  // into one folder can silently overwrite one of them.
  // Validate the freshly built Retail APK before publishing it into dist/android.
  // A failed signature check must not copy a wrong-key APK to the release path.
  if (app === "retail") {
    const checked = spawnSync(process.execPath, [join(repoRoot, "scripts", "android", "apk-fingerprint.mjs"), app],
      { cwd: repoRoot, stdio: "inherit", env: buildEnvironment });
    if (checked.error) throw checked.error;
    if (checked.status !== 0) throw new Error("Retail APK signing certificate did not match the pinned release identity.");
  }
  const dist = join(repoRoot, "dist", "android");
  mkdirSync(dist, { recursive: true });
  const namedApk = join(dist, `sichuan-hotpot-${app}-release.apk`);
  copyFileSync(apk, namedApk);
  console.log(`Release APK (${app}): ${namedApk}`);
}
