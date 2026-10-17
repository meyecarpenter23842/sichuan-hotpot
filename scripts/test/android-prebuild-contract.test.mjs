import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const app of ["customer", "admin"]) {
  test(`${app} Android prebuild generates required icon assets itself`, () => {
    const pkg = JSON.parse(
      readFileSync(new URL(`../../apps/${app}/package.json`, import.meta.url), "utf8"),
    );
    const script = pkg.scripts?.["android:prebuild"] ?? "";
    assert.match(script, /npm run icons:generate/);
    assert.match(script, /node scripts\/prebuild-android\.mjs/);
    assert.ok(
      script.indexOf("icons:generate") < script.indexOf("prebuild-android.mjs"),
      "icons must be generated before Expo prebuild",
    );
  });
}
