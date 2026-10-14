import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import ts from "typescript";

// Real Chromium canvas/codec gate, independent from R2 credentials and customer data.
const source = readFileSync(new URL("../../apps/admin/src/prepare-product-image.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto("about:blank");
  const result = await page.evaluate(async code => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    try {
      const { prepareProductImage } = await import(url);
      const canvas = document.createElement("canvas");
      canvas.width = 2200; canvas.height = 1600;
      const context = canvas.getContext("2d");
      if (!context) throw Error("NO_CANVAS");
      const data = context.createImageData(canvas.width, canvas.height);
      let n = 123456789;
      for (let i = 0; i < data.data.length; i += 4) {
        n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
        data.data[i] = n & 255;
        data.data[i + 1] = (n >>> 8) & 255;
        data.data[i + 2] = (n >>> 16) & 255;
        data.data[i + 3] = 255;
      }
      context.putImageData(data, 0, 0);
      const original = await new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("PNG_ENCODING_FAILED")), "image/png");
      });
      const file = new File([original], "camera-large.png", { type: "image/png" });
      if (file.size <= 2097152) throw Error("FIXTURE_NOT_LARGE_ENOUGH");
      const prepared = await prepareProductImage(file);
      let rejectedBadType = false;
      try {
        await prepareProductImage(new File(["not an image"], "plain.txt", { type: "text/plain" }));
      } catch { rejectedBadType = true; }
      return {
        originalBytes: file.size,
        optimizedBytes: prepared.blob.size,
        mime: prepared.blob.type,
        width: prepared.width,
        height: prepared.height,
        rejectedBadType,
      };
    } finally { URL.revokeObjectURL(url); }
  }, compiled);
  assert.ok(result.originalBytes > 2 * 1024 * 1024);
  assert.ok(result.optimizedBytes > 0 && result.optimizedBytes <= 2 * 1024 * 1024);
  assert.ok(["image/webp", "image/jpeg"].includes(result.mime));
  assert.ok(Math.max(result.width, result.height) <= 1600);
  assert.equal(result.rejectedBadType, true);
  console.log("P4 image optimization in Chromium: PASS");
} finally {
  await browser.close();
}
