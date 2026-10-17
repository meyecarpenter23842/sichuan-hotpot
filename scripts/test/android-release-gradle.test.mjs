import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { withExpoProjectRoot } = require("../android/expo-embed-cli.cjs");
import test from "node:test";
import { configureReleaseGradle, assertReleaseGradle } from "../android/release-gradle.mjs";

const expoTemplate = `apply plugin: "com.facebook.react"
def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()
react {
    entryFile = file(["node", "-e", "require('expo/scripts/resolveAppEntry')", projectRoot, "android", "absolute"].execute(null, rootDir).text.trim())
    cliFile = new File(["node", "--print", "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })"].execute(null, rootDir).text.trim())
    bundleCommand = "export:embed"
    // root = file("../../")
    // extraPackagerArgs = []
}
`;

test("pins Expo Gradle root and overrides Expo CLI after template definition", () => {
  const patched = configureReleaseGradle(expoTemplate);
  assertReleaseGradle(patched);
  assert.match(patched, /^\s*root = new File\(projectRoot\)$/m);
  assert.match(patched, /^\s*extraPackagerArgs = \["--hotpot-project-root", projectRoot\]$/m);
  assert.ok(patched.lastIndexOf('cliFile = new File(projectRoot') > patched.indexOf('bundleCommand = "export:embed"'));
  assert.equal(configureReleaseGradle(patched), patched, "patch must be idempotent");
});

test("repairs a stale #186 native Gradle project without re-running destructive prebuild", () => {
  const oldBuildGradle = expoTemplate.replace(/^react \{$/m, "react {\n    root = new File(projectRoot)");
  const migrated = configureReleaseGradle(oldBuildGradle);
  assertReleaseGradle(migrated);
  assert.equal((migrated.match(/^\s*root\s*=/gm) ?? []).length, 1);
  assert.equal((migrated.match(/^\s*extraPackagerArgs\s*=/gm) ?? []).length, 1);
  assert.equal(configureReleaseGradle(migrated), migrated, "migration must be repeatable");
  assert.throws(
    () => configureReleaseGradle(oldBuildGradle.replace("root = new File(projectRoot)", 'root = file("../../")')),
    /custom/,
  );
});

test("release entrypoints validate and repair existing native Gradle before building", () => {
  const rootPackage = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const runner = readFileSync(new URL("../android/build-release.mjs", import.meta.url), "utf8");
  assert.equal(rootPackage.scripts["android:release:customer"], "node scripts/android/build-release.mjs customer");
  assert.equal(rootPackage.scripts["android:release:admin"], "node scripts/android/build-release.mjs admin");
  assert.match(runner, /configureGeneratedAndroid\(appDirectory\)/);
  assert.match(runner, /require\.resolve\("object\.assign\/polyfill"\)/);
  assert.doesNotMatch(runner, /--clean|npm ci\(/); // code must not delete native files or install packages
});

test("Expo embed entry resolves relative to Metro workspace root, not Gradle app root", () => {
  const repo = mkdtempSync(join(tmpdir(), "hotpot-expo-workspace-"));
  try {
    for (const name of ["customer", "admin"]) {
      const app = join(repo, "apps", name);
      const { mkdirSync } = require("node:fs");
      mkdirSync(app, { recursive: true });
      writeFileSync(join(app, "package.json"), "{}");
      writeFileSync(join(app, "index.ts"), "");
      const argv = ["node", "cli.cjs", "export:embed", "--entry-file", "index.ts", "--hotpot-project-root", app, "--verbose"];
      const updated = withExpoProjectRoot(argv, repo);
      assert.equal(updated.args[updated.args.indexOf("--entry-file") + 1], "apps/" + name + "/index.ts");
      assert.equal(updated.args.at(-1), resolve(app));
      assert.equal(updated.args.at(-2), "--verbose");
      assert.ok(!updated.args.includes("--hotpot-project-root"));
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("fails closed when Expo native template changes or has custom args", () => {
  assert.throws(() => configureReleaseGradle(expoTemplate.replace('bundleCommand = "export:embed"', 'bundleCommand = "bundle"')), /export:embed/);
  assert.throws(() => configureReleaseGradle(expoTemplate.replace('    // extraPackagerArgs = []', '    extraPackagerArgs = ["--minify", "true"]')), /custom/);
  assert.throws(() => configureReleaseGradle(expoTemplate.replace('def projectRoot =', 'def otherRoot =')), /projectRoot/);
});

for (const app of ["customer", "admin"]) {
  test(`${app} calls shared release bundling fixer after prebuild`, () => {
    const script = readFileSync(new URL(`../../apps/${app}/scripts/prebuild-android.mjs`, import.meta.url), "utf8");
    assert.match(script, /configureGeneratedAndroid\(appDirectory\)/);
    assert.match(script, /scripts\/android\/release-gradle\.mjs/);
    assert.doesNotMatch(script, /function pinMetroProjectRoot\(/);
  });
}
