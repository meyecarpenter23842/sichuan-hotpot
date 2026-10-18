import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pngjs from "pngjs";

const { PNG } = pngjs;

test("logo source is the approved raster, not the legacy icon", () => {
  const img = PNG.sync.read(readFileSync(resolve("assets/brand-hotpot-approved-20261016.png")));
  assert.equal(img.width, 1448);
  assert.equal(img.height, 1086);

  for (const app of ["customer", "admin"]) {
    const path = resolve("apps", app);
    const generator = readFileSync(resolve(path, "scripts/generate-icons.mjs"), "utf8");
    const config = JSON.parse(readFileSync(resolve(path, "app.json"), "utf8"));

    assert.match(generator, /brand-hotpot-approved-20261016\.png/);
    assert.doesNotMatch(generator, /const disc = radius/);
    assert.match(generator, /approved-emblem/);
    assert.match(generator, /ASSET_VERSION = "v20261016d"/);
    assert.match(generator, /icon-512-\$\{ASSET_VERSION\}\.png/);
    assert.equal(config.expo.web.favicon, "./public/icon-192-v20261016d.png");
    // Preserve the approved red emblem; distinguish only the Admin launcher tint.
    assert.equal(config.expo.android.adaptiveIcon.backgroundColor,
      app === "admin" ? "#1F3546" : "#FFFFFF");
  }
});
