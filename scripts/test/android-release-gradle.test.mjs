import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("pins Expo export:embed project directory as a positional argument", () => {
  const patched = configureReleaseGradle(expoTemplate);
  assertReleaseGradle(patched);
  assert.match(patched, /^\s*root = new File\(projectRoot\)$/m);
  assert.match(patched, /^\s*extraPackagerArgs = \[projectRoot\]$/m);
  assert.equal(configureReleaseGradle(patched), patched, "patch must be idempotent");
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
