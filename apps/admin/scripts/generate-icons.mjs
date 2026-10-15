import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { resolve, dirname } from "node:path";
import pngjs from "pngjs";

const { PNG } = pngjs;
const file = fileURLToPath(import.meta.url);
const adminDir = resolve(dirname(file), "..");
const root = resolve(adminDir, "..", "..");

function nearWhite(data, index) {
  const alpha = data[index + 3];
  if (alpha < 16) return true;
  const red = data[index], green = data[index + 1], blue = data[index + 2];
  // The approved image uses white AND warm ivory backgrounds. Only erase
  // background connected to the OUTER edge; enclosed pot details are preserved.
  const neutral = red >= 228 && green >= 228 && blue >= 228
    && Math.max(red, green, blue) - Math.min(red, green, blue) < 19;
  const warmIvory = red >= 232 && green >= 220 && blue >= 207
    && red >= green && green >= blue && red - blue <= 53;
  return neutral || warmIvory;
}

/**
 * Only erase pale background connected to the OUTER edge. White details inside
 * the supplied logo are preserved; a custom hand-drawn logo is never substituted.
 */
export function cleanLogo(source) {
  const original = PNG.sync.read(source);
  const { width, height } = original;
  if (width > 6000 || height > 6000 || width < 64 || height < 64) throw Error("Unexpected icon source dimensions");
  const data = Buffer.from(original.data);
  const visited = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) { stack.push(x, (height - 1) * width + x); }
  for (let y = 0; y < height; y++) { stack.push(y * width, y * width + width - 1); }
  while (stack.length) {
    const pos = stack.pop();
    if (visited[pos]) continue;
    visited[pos] = 1;
    const idx = pos * 4;
    if (!nearWhite(data, idx)) continue;
    data[idx + 3] = 0;
    const x = pos % width, y = Math.floor(pos / width);
    if (x > 0 && !visited[pos - 1]) stack.push(pos - 1);
    if (x < width - 1 && !visited[pos + 1]) stack.push(pos + 1);
    if (y > 0 && !visited[pos - width]) stack.push(pos - width);
    if (y < height - 1 && !visited[pos + width]) stack.push(pos + width);
  }
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pos = (y * width + x) * 4;
    if (data[pos + 3] < 40) continue;
    minX = Math.min(x, minX); minY = Math.min(y, minY);
    maxX = Math.max(x, maxX); maxY = Math.max(y, maxY);
  }
  if (maxX < minX || maxY < minY) throw Error("Icon source contains no visible artwork");
  return { width, height, data, bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } };
}

export function renderIcon(logo, size, adaptive = false) {
  const png = new PNG({ width: size, height: size, colorType: 6 });
  const d = png.data;
  // Keep the exact owner artwork without superimposing the former red disc.
  // All PNG assets carry true alpha; OS surfaces provide their own background.
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
    d[i + 3] = 0; // All app/PWA icon exports keep the approved pot only; no white square.
  }
  const { bbox, width, data } = logo;
  const extent = size * (adaptive ? 0.60 : 0.82);
  const scale = Math.min(extent / bbox.width, extent / bbox.height);
  const dw = bbox.width * scale, dh = bbox.height * scale;
  const left = (size - dw) / 2, top = (size - dh) / 2;
  const startX = Math.max(0, Math.floor(left)), endX = Math.min(size, Math.ceil(left + dw));
  const startY = Math.max(0, Math.floor(top)), endY = Math.min(size, Math.ceil(top + dh));
  for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
    const sx = bbox.x + Math.min(bbox.width - 1, Math.max(0, Math.floor((x + 0.5 - left) / scale)));
    const sy = bbox.y + Math.min(bbox.height - 1, Math.max(0, Math.floor((y + 0.5 - top) / scale)));
    const si = (sy * width + sx) * 4, di = (y * size + x) * 4;
    const alpha = data[si + 3] / 255;
    if (alpha <= 0) continue;
    const bgAlpha = d[di + 3] / 255;
    const outAlpha = alpha + bgAlpha * (1 - alpha);
    for (let c = 0; c < 3; c++) {
      d[di + c] = Math.round((data[si + c] * alpha
        + d[di + c] * bgAlpha * (1 - alpha)) / outAlpha);
    }
    d[di + 3] = Math.round(outAlpha * 255);
  }
  return PNG.sync.write(png);
}

export function generate() {
  const logo = cleanLogo(readFileSync(resolve(root, "assets/brand-approved-20261015.png")));
  const outputs = [
    ["public/icon-192-v20261015b.png", 192, false],
    ["public/icon-512-v20261015b.png", 512, false],
    ["public/apple-touch-icon-v20261015b.png", 180, false],
    ["assets/app-icon.png", 1024, false],
    ["assets/adaptive-icon.png", 1024, true],
  ];
  for (const [path, size, adaptive] of outputs) {
    const dest = resolve(adminDir, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, renderIcon(logo, size, adaptive));
  }
  const manifest = {
    name: "Sichuan Hotpot Admin",
    short_name: "Hotpot Admin",
    id: "/", start_url: "/", scope: "/", display: "standalone",
    theme_color: "#B3262D", background_color: "#FFFFFF",
    icons: [
      { src: "/icon-192-v20261015b.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512-v20261015b.png", sizes: "512x512", type: "image/png" },
    ],
  };
  writeFileSync(resolve(adminDir, "public/site.webmanifest"),
    JSON.stringify(manifest, null, 2) + "\n");
  console.log("Admin icons generated from new approved brand source: " + outputs.map(x => x[0]).join(", "));
}

if (process.argv[1] && resolve(process.argv[1]) === file) generate();
