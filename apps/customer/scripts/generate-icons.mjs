import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { resolve, dirname } from "node:path";
import pngjs from "pngjs";

const { PNG } = pngjs;
const file = fileURLToPath(import.meta.url);
const appDir = resolve(dirname(file), "..");
const root = resolve(appDir, "..", "..");

export const ASSET_VERSION = "v20261016d";

function edgeBackdrop(data, index) {
  const alpha = data[index + 3];
  if (alpha < 16) return true;

  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;

  // Only edge-connected pixels may be erased. This keeps enclosed white/black
  // artwork intact while removing the supplied RGB matte around the approved logo.
  const neutral = red >= 228 && green >= 228 && blue >= 228 && chroma < 19;
  const warmIvory = red >= 232 && green >= 220 && blue >= 207
    && red >= green && green >= blue && red - blue <= 53;
  // The approved source is an RGB PNG on a black matte. Accept a wider range of
  // neutral dark antialias pixels, but never chromatic dark reds from the logo.
  const darkNeutralMatte = max <= 96 && chroma <= 24;

  return neutral || warmIvory || darkNeutralMatte;
}

/**
 * Remove only a pale/dark matte connected to the OUTER edge.
 * Interior dark pot details are preserved because the flood fill cannot cross
 * opaque red artwork. Generated icons therefore carry real alpha, not a square.
 */
export function cleanLogo(source, mode = "legacy") {
  const original = PNG.sync.read(source);
  const { width, height } = original;
  if (width > 6000 || height > 6000 || width < 64 || height < 64) {
    throw Error("Unexpected icon source dimensions");
  }

  const data = Buffer.from(original.data);
  if (mode === "approved-emblem") {
    // The approved RGB PNG includes a baked-in checkerboard. Extract the real
    // hotpot emblem, with actual transparency, excluding the wordmark below.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const red = r > 95 && r - g > 38 && r - b > 30 && g < 175;
        const white = r > 231 && g > 229 && b > 225 &&
          Math.max(r, g, b) - Math.min(r, g, b) < 35;
        const dx = (x - width * 0.488) / (width * 0.231);
        const dy = (y - height * 0.353) / (height * 0.327);
        const inEmblem = dx * dx + dy * dy <= 1.075 && y <= height * 0.659;
        data[i + 3] = inEmblem && (red || white) ? 255 : 0;
      }
    }
  } else {
    // Retain legacy cleanup only for compatibility with existing tests.
    // Flood-filling approved logo whites would destroy the design.
    const visited = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);

  while (stack.length) {
    const pos = stack.pop();
    if (visited[pos]) continue;
    visited[pos] = 1;

    const idx = pos * 4;
    if (!edgeBackdrop(data, idx)) continue;
    data[idx + 3] = 0;

    const x = pos % width;
    const y = Math.floor(pos / width);
    if (x > 0 && !visited[pos - 1]) stack.push(pos - 1);
    if (x < width - 1 && !visited[pos + 1]) stack.push(pos + 1);
    if (y > 0 && !visited[pos - width]) stack.push(pos - width);
    if (y < height - 1 && !visited[pos + width]) stack.push(pos + width);
  }

  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = (y * width + x) * 4;
      if (data[pos + 3] < 40) continue;
      minX = Math.min(x, minX);
      minY = Math.min(y, minY);
      maxX = Math.max(x, maxX);
      maxY = Math.max(y, maxY);
    }
  }

  if (maxX < minX || maxY < minY) throw Error("Icon source contains no visible artwork");
  return {
    width,
    height,
    data,
    bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

export function renderIcon(logo, size, adaptive = false) {
  const png = new PNG({ width: size, height: size, colorType: 6 });
  const d = png.data;

  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
    d[i + 3] = 0;
  }

  const { bbox, width, data } = logo;
  const extent = size * (adaptive ? 0.60 : 0.82);
  const scale = Math.min(extent / bbox.width, extent / bbox.height);
  const dw = bbox.width * scale;
  const dh = bbox.height * scale;
  const left = (size - dw) / 2;
  const top = (size - dh) / 2;
  const startX = Math.max(0, Math.floor(left));
  const endX = Math.min(size, Math.ceil(left + dw));
  const startY = Math.max(0, Math.floor(top));
  const endY = Math.min(size, Math.ceil(top + dh));

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const sx = bbox.x + Math.min(
        bbox.width - 1,
        Math.max(0, Math.floor((x + 0.5 - left) / scale)),
      );
      const sy = bbox.y + Math.min(
        bbox.height - 1,
        Math.max(0, Math.floor((y + 0.5 - top) / scale)),
      );
      const si = (sy * width + sx) * 4;
      const di = (y * size + x) * 4;
      const alpha = data[si + 3] / 255;
      if (alpha <= 0) continue;

      const bgAlpha = d[di + 3] / 255;
      const outAlpha = alpha + bgAlpha * (1 - alpha);
      for (let c = 0; c < 3; c++) {
        d[di + c] = Math.round(
          (data[si + c] * alpha + d[di + c] * bgAlpha * (1 - alpha)) / outAlpha,
        );
      }
      d[di + 3] = Math.round(outAlpha * 255);
    }
  }

  return PNG.sync.write(png);
}

export function generate() {
  const logo = cleanLogo(readFileSync(resolve(root, "assets/brand-hotpot-approved-20261016.png")), "approved-emblem");
  const outputs = [
    [`public/icon-192-${ASSET_VERSION}.png`, 192, false],
    [`public/icon-512-${ASSET_VERSION}.png`, 512, false],
    [`public/apple-touch-icon-${ASSET_VERSION}.png`, 180, false],
    ["assets/app-icon.png", 1024, false],
    ["assets/adaptive-icon.png", 1024, true],
  ];

  for (const [path, size, adaptive] of outputs) {
    const dest = resolve(appDir, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, renderIcon(logo, size, adaptive));
  }

  const manifest = {
    name: "Sichuan Hotpot",
    short_name: "Sichuan",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#B3262D",
    background_color: "#FFFFFF",
    icons: [
      { src: `/icon-192-${ASSET_VERSION}.png`, sizes: "192x192", type: "image/png" },
      { src: `/icon-512-${ASSET_VERSION}.png`, sizes: "512x512", type: "image/png" },
    ],
  };

  writeFileSync(
    resolve(appDir, "public/site.webmanifest"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log("Customer icons generated with transparent outer matte: "
    + outputs.map(item => item[0]).join(", "));
}

if (process.argv[1] && resolve(process.argv[1]) === file) generate();
