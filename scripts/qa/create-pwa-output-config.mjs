import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function buildPwaOutputConfig(app, apiOrigin) {
  if (!["customer", "admin"].includes(app)) {
    throw new Error("Invalid PWA target");
  }
  const routes = [];
  if (app === "customer" || app === "admin") {
    if (!apiOrigin || typeof apiOrigin !== "string") {
      throw new Error("Missing verified PWA API HTTPS origin");
    }
    const url = new URL(apiOrigin);
    if (url.protocol !== "https:" || url.origin !== apiOrigin ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("PWA API origin must be a bare validated HTTPS origin");
    }
    // The prebuilt deployment owns all routing; apps/customer/vercel.json is
    // not automatically injected into Vercel's .vercel/output/config.json.
    // An early exact-match route is necessary to retain HttpOnly cookie auth.
    routes.push({
      src: "^/api/session/(start|refresh|logout)$",
      methods: ["POST"],
      dest: apiOrigin + "/auth/browser/$1",
    });
  }
  routes.push({ handle: "filesystem" });
  routes.push({ src: "/(.*)", dest: "/index.html" });
  return { version: 3, routes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = process.argv[2];
  const config = buildPwaOutputConfig(app, process.env.PWA_API_ORIGIN);
  const output = resolve("apps", app, ".vercel/output/config.json");
  mkdirSync(resolve("apps", app, ".vercel/output"), { recursive: true });
  writeFileSync(output, JSON.stringify(config) + "\n");
  console.log("Prebuilt " + app + " routing verified" +
    " (secure same-origin session proxy configured)");
}
