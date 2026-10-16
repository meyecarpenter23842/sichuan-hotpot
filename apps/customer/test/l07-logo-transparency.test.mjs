import { test } from "node:test";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs";
import { ASSET_VERSION, cleanLogo, renderIcon } from "../scripts/generate-icons.mjs";

const { PNG } = pngjs;
const here = dirname(fileURLToPath(import.meta.url));
const approvedSource = resolve(here, "../../../assets/brand-hotpot-approved-20261016.png");

function alphaAt(image, x, y) {
  return image.data[(y * image.width + x) * 4 + 3];
}

function assertTransparentCorners(image, label) {
  const points = [
    [0, 0],
    [image.width - 1, 0],
    [0, image.height - 1],
    [image.width - 1, image.height - 1],
  ];
  for (const [x, y] of points) {
    assert.equal(alphaAt(image, x, y), 0, label + " must have transparent corners");
  }
}

test("L07 approved RGB logo loses its outer matte without deleting the artwork", () => {
  const source = readFileSync(approvedSource);
  const original = PNG.sync.read(source);
  const cleaned = cleanLogo(source, "approved-emblem");

  assert.equal(cleaned.width, original.width);
  assert.equal(cleaned.height, original.height);
  assert.ok(cleaned.bbox.x > 0 && cleaned.bbox.y > 0, "artwork must no longer occupy the outer square");
  assert.ok(cleaned.bbox.width < cleaned.width && cleaned.bbox.height < cleaned.height);

  const cleanedImage = new PNG({ width: cleaned.width, height: cleaned.height });
  cleanedImage.data = Buffer.from(cleaned.data);
  assertTransparentCorners(cleanedImage, "cleaned approved source");
  assert.equal(alphaAt(cleanedImage, Math.floor(cleaned.width / 2), 50), 0,
    "baked-in checkerboard must become true transparency");
  assert.ok(alphaAt(cleanedImage, Math.floor(cleaned.width / 2), 150) > 0,
    "the approved red emblem must stay visible");

  let visible = 0;
  for (let i = 3; i < cleaned.data.length; i += 4) {
    if (cleaned.data[i] >= 40) visible++;
  }
  assert.ok(visible > cleaned.width * cleaned.height * 0.05, "approved red artwork must remain visible");

  for (const size of [192, 512, 1024]) {
    const rendered = PNG.sync.read(renderIcon(cleaned, size, false));
    assertTransparentCorners(rendered, size + "px icon");
  }

  const adaptive = PNG.sync.read(renderIcon(cleaned, 1024, true));
  assertTransparentCorners(adaptive, "Android adaptive foreground");
  assert.equal(ASSET_VERSION, "v20261016d");
});

test("L07 only removes edge-connected dark matte and preserves enclosed dark details", () => {
  const p = new PNG({ width: 96, height: 96 });
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = 52;
    p.data[i + 1] = 48;
    p.data[i + 2] = 50;
    p.data[i + 3] = 255;
  }

  for (let y = 24; y < 72; y++) {
    for (let x = 24; x < 72; x++) {
      const pos = (y * 96 + x) * 4;
      p.data[pos] = 194;
      p.data[pos + 1] = 33;
      p.data[pos + 2] = 44;
    }
  }

  const enclosed = (48 * 96 + 48) * 4;
  p.data[enclosed] = 18;
  p.data[enclosed + 1] = 18;
  p.data[enclosed + 2] = 18;

  const cleaned = cleanLogo(PNG.sync.write(p));
  assert.equal(cleaned.data[3], 0, "outer dark matte must be transparent");
  assert.deepEqual(cleaned.bbox, { x: 24, y: 24, width: 48, height: 48 });
  assert.equal(cleaned.data[enclosed + 3], 255, "enclosed dark logo detail must remain opaque");
});
