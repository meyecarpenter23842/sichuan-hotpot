import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Expo's export:embed CLI derives its project directory from its current working
// directory unless passed a positional path. Gradle's react.root alone did not
// guarantee the correct Expo project on Windows/npm workspaces.
const PATCH = `    // Keep React Native Gradle and Expo export:embed on this app, not the npm workspace.\n    root = new File(projectRoot)\n    extraPackagerArgs = [projectRoot]`;
const PROJECT_ROOT_DECLARATION =
  "def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()";

export function assertReleaseGradle(source) {
  if (!source.includes(PROJECT_ROOT_DECLARATION)) {
    throw new Error("Expo-generated Gradle projectRoot no longer points above android/.");
  }
  for (const [name, pattern] of [
    ["Expo entry resolver", /^\s*entryFile\s*=\s*file\(\["node", "-e", "require\('expo\/scripts\/resolveAppEntry'\)", projectRoot, "android", "absolute"\]/m],
    ["Expo CLI", /^\s*cliFile\s*=\s*new File\(\["node", "--print", "require\.resolve\('@expo\/cli'/m],
    ["export:embed", /^\s*bundleCommand\s*=\s*"export:embed"\s*$/m],
    ["Gradle React root", /^\s*root\s*=\s*new File\(projectRoot\)\s*$/m],
    ["Expo CLI positional project root", /^\s*extraPackagerArgs\s*=\s*\[projectRoot\]\s*$/m],
  ]) {
    if (!pattern.test(source)) throw new Error(`Missing Android release bundling contract: ${name}`);
  }
  return true;
}

export function configureReleaseGradle(source) {
  if (!source.includes(PROJECT_ROOT_DECLARATION)) {
    throw new Error("Unexpected Expo app/build.gradle: missing canonical projectRoot.");
  }
  if (!/^react \{$/m.test(source)) {
    throw new Error("Unexpected Expo app/build.gradle: missing react block.");
  }
  if (source.includes("extraPackagerArgs = [projectRoot]")) {
    assertReleaseGradle(source);
    return source;
  }
  // Never overwrite a future Expo template's custom bundling args unnoticed.
  if (/^\s*(?!\/\/)(?:root|extraPackagerArgs)\s*=/m.test(source)) {
    throw new Error("Unexpected custom React Native Gradle root/packager args; review before patching.");
  }
  const configured = source.replace(/^react \{$/m, `react {\n${PATCH}`);
  assertReleaseGradle(configured);
  return configured;
}

export function configureGeneratedAndroid(appDirectory) {
  const buildGradle = join(appDirectory, "android", "app", "build.gradle");
  const settingsGradle = join(appDirectory, "android", "settings.gradle");
  const entryFile = join(appDirectory, "index.ts");
  if (!existsSync(settingsGradle) || !existsSync(entryFile)) {
    throw new Error(`Incomplete Android prebuild or app entry for ${basename(appDirectory)}`);
  }
  // Use the same Expo entry resolver Gradle will invoke, on both Windows/Linux.
  const resolveEntry = spawnSync(process.execPath, [
    "-e", "require('expo/scripts/resolveAppEntry')", appDirectory, "android", "absolute",
  ], { cwd: appDirectory, encoding: "utf8" });
  if (resolveEntry.error || resolveEntry.status !== 0) {
    throw new Error(`Expo Android entry resolver failed: ${resolveEntry.stderr || resolveEntry.error}`);
  }
  const resolvedEntry = resolveEntry.stdout.trim().split(/\r?\n/).at(-1);
  const normalize = (value) => process.platform === "win32"
    ? resolve(value).toLowerCase() : resolve(value);
  if (!resolvedEntry || !isAbsolute(resolvedEntry) || normalize(resolvedEntry) !== normalize(entryFile)) {
    throw new Error(`Wrong Expo Android entry: expected ${entryFile}, got ${resolvedEntry}`);
  }
  const source = readFileSync(buildGradle, "utf8");
  const patched = configureReleaseGradle(source);
  if (patched !== source) writeFileSync(buildGradle, patched);
  console.log(`Android release: Expo entry ${resolvedEntry}; Gradle and CLI rooted at ${appDirectory}`);
}

// Inspect generated Gradle in CI without altering the native project.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = process.argv[2];
  if (!["customer", "admin"].includes(app)) {
    throw new Error("Usage: node scripts/android/release-gradle.mjs customer|admin");
  }
  const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", app);
  assertReleaseGradle(readFileSync(join(appDirectory, "android", "app", "build.gradle"), "utf8"));
  console.log(`${app} release Gradle contract: PASS`);
}
