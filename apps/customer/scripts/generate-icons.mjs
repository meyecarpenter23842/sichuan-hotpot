import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { resolve, dirname } from "node:path";
import pngjs from "pngjs";

const { PNG } = pngjs;
const file = fileURLToPath(import.meta.url);
const customerDir = resolve(dirname(file), "..");
const root = resolve(customerDir, "..", "..");

function nearWhite(data, index) {
  const alpha = data[index + 3];
  if (alpha < 16) return true;
  const red = data[index], green = data[index + 1], blue = data[index + 2];
  return red >= 228 && green >= 228 && blue >= 228
    && Math.max(red, green, blue) - Math.min(red, green, blue) < 19;
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
  const red = [179, 38, 45, 255], white = [255, 255, 255, 255];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const radius = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
    const disc = radius < size * (adaptive ? 0.33 : 0.425);
    const color = disc ? white : (adaptive ? [0, 0, 0, 0] : red);
    for (let c = 0; c < 4; c++) d[i + c] = color[c];
  }
  const { bbox, width, data } = logo;
  const extent = size * (adaptive ? 0.48 : 0.64);
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
  const logo = cleanLogo(readFileSync(resolve(root, "icon-ltx.png")));
  const outputs = [
    ["public/icon-192.png", 192, false],
    ["public/icon-512.png", 512, false],
    ["public/apple-touch-icon.png", 180, false],
    ["assets/app-icon.png", 1024, false],
    ["assets/adaptive-icon.png", 1024, true],
  ];
  for (const [path, size, adaptive] of outputs) {
    const dest = resolve(customerDir, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, renderIcon(logo, size, adaptive));
  }
  console.log("Icons generated from owner icon-ltx.png: " + outputs.map(x => x[0]).join(", "));
}

if (process.argv[1] && resolve(process.argv[1]) === file) generate();
