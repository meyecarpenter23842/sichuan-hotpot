import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function buildDineinOutputConfig(app, apiOrigin) {
  if (!["retail", "menu"].includes(app)) throw new Error("Invalid dine-in target");
  const canonical = "https://" + app + ".bepsi.click";
  const noStore = { "Cache-Control": "no-store, max-age=0, must-revalidate" };
  const routes = [
    {
      src: "^/(.*)$",
      has: [{ type: "host", value: { suf: ".vercel.app" } }],
      status: 307,
      headers: { Location: canonical + "/$1" },
    },
  ];
  if (app === "retail") {
    if (!apiOrigin || typeof apiOrigin !== "string") throw new Error("Missing Retail API origin");
    const url = new URL(apiOrigin);
    if (url.protocol !== "https:" || url.origin !== apiOrigin ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("Retail API origin must be bare HTTPS origin");
    }
    routes.push({
      src: "^/api/session/(start|refresh|logout)$",
      methods: ["POST"],
      dest: apiOrigin + "/auth/browser/$1",
    });
  }
  routes.push({ src: "^/(?:index\\.html|hotpot-sw\\.js)$", headers: noStore, continue: true });
  routes.push({ src: "^/$", headers: noStore, continue: true });
  routes.push({ handle: "filesystem" });
  routes.push({ src: "/(.*)", dest: "/index.html", headers: noStore });
  return { version: 3, routes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = process.argv[2];
  const output = resolve("apps", app, ".vercel/output/config.json");
  const config = buildDineinOutputConfig(app, process.env.PWA_API_ORIGIN);
  mkdirSync(resolve("apps", app, ".vercel/output"), { recursive: true });
  writeFileSync(output, JSON.stringify(config) + "\n");
  console.log("Verified prebuilt " + app + " SPA routing and canonical domain");
}
