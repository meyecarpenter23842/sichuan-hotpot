import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// React Native Gradle appends --verbose after extraPackagerArgs. Expo SDK 54
// requires the positional project root to be the FINAL argument.
const ROOT_PIN = "    root = new File(projectRoot)";
const CLI_PIN = [
  "    // Expo export:embed root marker is moved after Gradle's --verbose by the launcher.",
  '    cliFile = new File(projectRoot, "../../scripts/android/expo-embed-cli.cjs").getCanonicalFile()',
  '    extraPackagerArgs = ["--hotpot-project-root", projectRoot]',
].join("\n");
const PROJECT_ROOT_DECLARATION =
  "def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()";

export function assertReleaseGradle(source) {
  if (!source.includes(PROJECT_ROOT_DECLARATION)) {
    throw new Error("Expo-generated Gradle projectRoot no longer points above android/.");
  }
  for (const [name, pattern] of [
    ["Expo entry resolver", /^\s*entryFile\s*=\s*file\(\["node", "-e", "require\('expo\/scripts\/resolveAppEntry'\)", projectRoot, "android", "absolute"\]/m],
    ["Expo CLI original", /^\s*cliFile\s*=\s*new File\(\["node", "--print", "require\.resolve\('@expo\/cli'/m],
    ["export:embed", /^\s*bundleCommand\s*=\s*"export:embed"\s*$/m],
    ["Gradle React root", /^\s*root\s*=\s*new File\(projectRoot\)\s*$/m],
    ["Expo launcher", /^\s*cliFile\s*=\s*new File\(projectRoot, "\.\.\/\.\.\/scripts\/android\/expo-embed-cli\.cjs"\)\.getCanonicalFile\(\)\s*$/m],
    ["Expo root marker", /^\s*extraPackagerArgs\s*=\s*\["--hotpot-project-root", projectRoot\]\s*$/m],
  ]) {
    if (!pattern.test(source)) throw new Error(`Missing Android release bundling contract: ${name}`);
  }
  if (source.lastIndexOf('cliFile = new File(projectRoot') < source.indexOf('bundleCommand = "export:embed"')) {
    throw new Error("Expo launcher must override the generated cliFile after bundleCommand.");
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
  if (source.includes('extraPackagerArgs = ["--hotpot-project-root", projectRoot]')) {
    assertReleaseGradle(source);
    return source;
  }
  // PR #186 generated projects already contain this exact root pin. Upgrade
  // those Android folders in place: never require a destructive --clean prebuild.
  const existingRoots = [...source.matchAll(/^\s*root\s*=\s*(.+)$/gm)];
  if (
    existingRoots.length > 1 ||
    (existingRoots.length === 1 && existingRoots[0][1].trim() !== "new File(projectRoot)")
  ) {
    throw new Error("Unexpected custom React Native Gradle root; review before patching.");
  }
  // Preserve user-defined bundling options rather than silently overriding them.
  if (/^\s*extraPackagerArgs\s*=/m.test(source) || /^\s*cliFile\s*=\s*new File\(projectRoot/m.test(source)) {
    throw new Error("Unexpected custom React Native Gradle CLI/packager args; review before patching.");
  }
  const rooted = existingRoots.length
    ? source
    : source.replace(/^react \{$/m, `react {\n${ROOT_PIN}`);
  const patched = rooted.replace(/^(\s*bundleCommand\s*=\s*"export:embed"\s*)$/m, `$1\n${CLI_PIN}`);
  assertReleaseGradle(patched);
  return patched;
}

export function configureGeneratedAndroid(appDirectory) {
  const buildGradle = join(appDirectory, "android", "app", "build.gradle");
  const settingsGradle = join(appDirectory, "android", "settings.gradle");
  const entryFile = join(appDirectory, "index.ts");
  const launcher = resolve(appDirectory, "..", "..", "scripts", "android", "expo-embed-cli.cjs");
  if (!existsSync(settingsGradle) || !existsSync(entryFile) || !existsSync(launcher)) {
    throw new Error(`Incomplete Android prebuild, app entry or Expo launcher for ${basename(appDirectory)}`);
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
  console.log(`Android release: Expo entry ${resolvedEntry}; Expo launcher rooted at ${appDirectory}`);
}

// Inspect by default, or safely repair an existing native project in place.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repair = process.argv[2] === "--repair";
  const app = process.argv[repair ? 3 : 2];
  if (!["customer", "admin", "retail"].includes(app)) {
    throw new Error("Usage: node scripts/android/release-gradle.mjs [--repair] customer|admin|retail");
  }
  const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", app);
  if (repair) configureGeneratedAndroid(appDirectory);
  else assertReleaseGradle(readFileSync(join(appDirectory, "android", "app", "build.gradle"), "utf8"));
  console.log(`${app} release Gradle contract: PASS`);
}
