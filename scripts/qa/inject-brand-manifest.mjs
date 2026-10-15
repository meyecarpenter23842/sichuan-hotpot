// Installable PWA metadata is injected only into the exact exported bundle.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const app = process.argv[2];
if (!["admin", "customer"].includes(app)) throw Error("Invalid PWA app");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = resolve(repoRoot, "apps", app, "dist");
const html = resolve(dir, "index.html");
const publicDir = resolve(repoRoot, "apps", app, "public");
// Expo export bundles referenced assets but does not guarantee unreferenced
// installable-PWA manifest and icons are copied from public.
for (const file of [
  "site.webmanifest", "icon-192-v20261015b.png",
  "icon-512-v20261015b.png", "apple-touch-icon-v20261015b.png",
]) {
  const from = resolve(publicDir, file);
  if (!existsSync(from)) throw Error("Approved brand asset missing: " + file);
  copyFileSync(from, resolve(dir, file));
}
const manifest = resolve(dir, "site.webmanifest");
const icon = resolve(dir, "icon-192-v20261015b.png");
if (!existsSync(manifest) || !existsSync(icon)) throw Error("New PWA brand assets absent");
let source = readFileSync(html, "utf8");
const tags = [
  '<link rel="manifest" href="/site.webmanifest?v=20261015b" />',
  '<link rel="apple-touch-icon" href="/apple-touch-icon-v20261015b.png" />',
];
if (!source.includes("</head>")) throw Error("Expected Expo head missing");
for (const tag of tags) if (!source.includes(tag)) source = source.replace("</head>", tag + "\n</head>");
writeFileSync(html, source);
console.log("Installed PWA metadata for", app);
