import { createServer, request as upstreamRequest } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { join, extname, normalize, resolve, sep } from "node:path";

// Disposable CI only: mimic Vercel same-origin rewrite and serve an exported Expo PWA.
// Admin, Customer and Retail use isolated disposable browser origins.
const app = process.env.HOTPOT_QA_PWA_APP || "customer";
const port = Number(process.env.HOTPOT_QA_WEB_PORT || "3000");
if (!["customer", "admin", "retail", "menu"].includes(app) || ![3000, 3002, 3004, 3005].includes(port)) {
  throw new Error("Invalid isolated QA PWA target");
}
const root = resolve("apps", app, "dist");
const types = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon",
  ".svg": "image/svg+xml", ".woff2": "font/woff2",
};
createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://127.0.0.1:" + port).pathname;
  if (/^\/api\/session\/(start|refresh|logout)$/.test(pathname)) {
    const upstream = upstreamRequest({
      hostname: "127.0.0.1", port: 3001, method: req.method,
      path: pathname.replace("/api/session/", "/auth/browser/"),
      headers: { ...req.headers, host: "127.0.0.1:3001" },
    }, response => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
    return;
  }
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end(); return; }
  const candidate = resolve(root, "." + normalize("/" + decoded));
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    res.writeHead(403); res.end(); return;
  }
  let file = candidate;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    else if (!statSync(file).isFile()) throw Error("not a file");
  } catch {
    if (extname(file)) { res.writeHead(404); res.end(); return; }
    file = join(root, "index.html");
  }
  res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1");
