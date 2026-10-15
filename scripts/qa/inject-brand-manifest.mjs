// Installable PWA metadata is injected only into the exact exported bundle.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
const app = process.argv[2];
if (!["admin", "customer"].includes(app)) throw Error("Invalid PWA app");
const dir = resolve("apps", app, "dist");
const html = resolve(dir, "index.html");
const publicDir = resolve("apps", app, "public");
// Expo export bundles referenced assets but does not guarantee unreferenced
// installable-PWA manifest and icons are copied from public.
for (const file of [
  "site.webmanifest", "icon-192-v20261015.png",
  "icon-512-v20261015.png", "apple-touch-icon-v20261015.png",
]) {
  const from = resolve(publicDir, file);
  if (!existsSync(from)) throw Error("Approved brand asset missing: " + file);
  copyFileSync(from, resolve(dir, file));
}
const manifest = resolve(dir, "site.webmanifest");
const icon = resolve(dir, "icon-192-v20261015.png");
if (!existsSync(manifest) || !existsSync(icon)) throw Error("New PWA brand assets absent");
let source = readFileSync(html, "utf8");
const tags = [
  '<link rel="manifest" href="/site.webmanifest?v=20261015" />',
  '<link rel="apple-touch-icon" href="/apple-touch-icon-v20261015.png" />',
];
if (!source.includes("</head>")) throw Error("Expected Expo head missing");
for (const tag of tags) if (!source.includes(tag)) source = source.replace("</head>", tag + "\n</head>");
writeFileSync(html, source);
console.log("Installed PWA metadata for", app);
