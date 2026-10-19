// Installable PWA metadata is injected only into the exact exported bundle.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const app = process.argv[2];
if (!["admin", "customer"].includes(app)) throw Error("Invalid PWA app");

const ASSET_VERSION = "v20261016d";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = resolve(repoRoot, "apps", app, "dist");
const html = resolve(dir, "index.html");
const publicDir = resolve(repoRoot, "apps", app, "public");

for (const file of [
  "site.webmanifest",
  `icon-192-${ASSET_VERSION}.png`,
  `icon-512-${ASSET_VERSION}.png`,
  `apple-touch-icon-${ASSET_VERSION}.png`,
  "hotpot-sw.js",
]) {
  const from = resolve(publicDir, file);
  if (!existsSync(from)) throw Error("Approved brand asset missing: " + file);
  copyFileSync(from, resolve(dir, file));
}

const manifest = resolve(dir, "site.webmanifest");
const icon = resolve(dir, `icon-192-${ASSET_VERSION}.png`);
if (!existsSync(manifest) || !existsSync(icon)) throw Error("New PWA brand assets absent");

let source = readFileSync(html, "utf8");
const tags = [
  `<link rel="manifest" href="/site.webmanifest?v=${ASSET_VERSION}" />`,
  `<link rel="apple-touch-icon" href="/apple-touch-icon-${ASSET_VERSION}.png" />`,
];
if (!source.includes("</head>")) throw Error("Expected Expo head missing");
for (const tag of tags) {
  if (!source.includes(tag)) source = source.replace("</head>", tag + "\n</head>");
}

// Use the exact immutable main SHA verified by the release workflow. PR CI
// builds use GITHUB_SHA, while local preview builds have no update target.
if (app === "admin") {
  const id = process.env.REQUESTED_SHA || process.env.GITHUB_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA || "";
  const release = /^[a-f0-9]{40}$/.test(id) ? id : "development";
  const marker = '<meta name="hotpot-admin-release" content="' + release + '" />';
  if (source.includes('name="hotpot-admin-release"')) {
    throw new Error("Duplicate Admin PWA release metadata");
  }
  source = source.replace("</head>", marker + "\n</head>");
  writeFileSync(resolve(dir, "admin-release.json"), JSON.stringify({ id: release }) + "\n");
}

writeFileSync(html, source);
console.log("Installed PWA metadata for", app, "asset", ASSET_VERSION);
