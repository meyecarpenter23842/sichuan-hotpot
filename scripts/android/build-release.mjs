// Use this instead of calling Gradle directly on a possibly stale Expo
// prebuild. Existing native files are preserved; only the known Gradle
// release-bundling contract is upgraded before assembling an APK.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureGeneratedAndroid } from "./release-gradle.mjs";
import { assertAndroidReleaseEnv, loadReleaseEnv } from "./release-env.mjs";

const require = createRequire(import.meta.url);
const app = process.argv[2];
if (!["customer", "admin"].includes(app) || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/android/build-release.mjs customer|admin");
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDirectory = join(repoRoot, "apps", app);

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
const runtime = assertAndroidReleaseEnv(app, loadReleaseEnv(appDirectory));
if (runtime.isCiPlaceholder) {
  console.log("CI-only APK: placeholder API/OAuth values, not a production distribution build.");
}

// Validates Expo's entry file, refuses unexpected Gradle customizations,
// and repairs an existing #186 native project without --clean/prebuild.
configureGeneratedAndroid(appDirectory);

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
else console.log(`Release APK: ${join(gradleDirectory, "app", "build", "outputs", "apk", "release", "app-release.apk")}`);
