import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanLogo, renderIcon } from "../../admin/scripts/generate-icons.mjs";

// The same previously approved emblem as Admin/Customer, not a default Expo icon.
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "..", "..");
const approved = resolve(repoRoot, "assets", "brand-hotpot-approved-20261016.png");
const artwork = cleanLogo(readFileSync(approved), "approved-emblem");
for (const [filename, adaptive] of [
  ["app-icon.png", false], ["adaptive-icon.png", true],
]) {
  const output = resolve(appRoot, "assets", filename);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, renderIcon(artwork, 1024, adaptive));
}
console.log("Retail Android launcher assets generated from approved Hotpot emblem.");
