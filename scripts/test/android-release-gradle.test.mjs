import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("Expo CLI launcher puts project directory after Gradle's --verbose", () => {
  const app = mkdtempSync(join(tmpdir(), "hotpot-expo-root-"));
  try {
    writeFileSync(join(app, "package.json"), "{}");
    writeFileSync(join(app, "index.ts"), "");
    const argv = ["node", "cli.cjs", "export:embed", "--entry-file", "index.ts", "--hotpot-project-root", app, "--verbose"];
    const updated = withExpoProjectRoot(argv);
    assert.equal(updated.args.at(-1), app);
    assert.equal(updated.args.at(-2), "--verbose");
    assert.ok(!updated.args.includes("--hotpot-project-root"));
  } finally {
    rmSync(app, { recursive: true, force: true });
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
