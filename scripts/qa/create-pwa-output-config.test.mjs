import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPwaOutputConfig } from "./create-pwa-output-config.mjs";

test("customer prebuilt PWA canonicalizes host before session proxy and SPA", () => {
  const config = buildPwaOutputConfig("customer", "https://132.145.103.89");
  assert.equal(config.version, 3);
  assert.deepEqual(config.routes, [
    { src: "^/(.*)$",
      has: [{ type: "host", value: { suf: ".vercel.app" } }],
      status: 307, headers: { Location: "https://www.bepsi.click/$1" } },
    { src: "^/(.*)$",
      has: [{ type: "host", value: "bepsi.click" }],
      status: 307, headers: { Location: "https://www.bepsi.click/$1" } },
    { src: "^/api/session/(start|refresh|logout)$", methods: ["POST"],
      dest: "https://132.145.103.89/auth/browser/$1" },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/index.html" },
  ]);
});

test("Admin PWA secures refresh through its own host-only same-origin cookie proxy", () => {
  assert.deepEqual(buildPwaOutputConfig("admin", "https://api.example.com"), {
    version: 3, routes: [
      { src: "^/(.*)$",
        has: [{ type: "host", value: { suf: ".vercel.app" } }],
        status: 307, headers: { Location: "https://admin.bepsi.click/$1" } },
      { src: "^/api/session/(start|refresh|logout)$", methods: ["POST"],
        dest: "https://api.example.com/auth/browser/$1" },
      { src: "^/(?:index\\.html|admin-release\\.json|hotpot-sw\\.js)$",
        headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" }, continue: true },
      { src: "^/$", headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" }, continue: true },
      { handle: "filesystem" },
      { src: "/(.*)", dest: "/index.html",
        headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
    ],
  });
});

test("unsafe, non-origin, or missing backend destinations fail closed", () => {
  for (const origin of [undefined, "", "http://127.0.0.1:3000",
    "https://api.example.com/other", "https://api.example.com?unsafe=1",
    "https://user:secret@api.example.com"]) {
    assert.throws(() => buildPwaOutputConfig("customer", origin));
  }
});

test("Admin preview deployment routes redirect to canonical origin before session and SPA", () => {
  const routes = buildPwaOutputConfig("admin", "https://132.145.103.89").routes;
  assert.equal(routes[0].status, 307);
  assert.equal(routes[0].headers.Location, "https://admin.bepsi.click/$1");
  assert.deepEqual(routes[0].has, [{ type: "host", value: { suf: ".vercel.app" } }]);
  assert.equal(routes[1].src, "^/api/session/(start|refresh|logout)$");
  assert.equal(routes.at(-1).dest, "/index.html");
  const customerRoutes = buildPwaOutputConfig("customer", "https://132.145.103.89").routes;
  assert.equal(customerRoutes[0].headers.Location, "https://www.bepsi.click/$1");
  assert.equal(customerRoutes[1].headers.Location, "https://www.bepsi.click/$1");
  assert.equal(customerRoutes[2].src, "^/api/session/(start|refresh|logout)$");
});

test("Admin HTML and release metadata cannot be cached, while customer routes stay unchanged", () => {
  const admin = buildPwaOutputConfig("admin", "https://api.example.com");
  const noStore = "no-store, max-age=0, must-revalidate";
  const route = admin.routes.find(r => r.src?.includes("admin-release"));
  assert.ok(route);
  assert.equal(route.continue, true);
  assert.equal(route.headers["Cache-Control"], noStore);
  assert.equal(admin.routes.find(r => r.src === "^/$").headers["Cache-Control"], noStore);
  assert.equal(admin.routes.at(-1).headers["Cache-Control"], noStore);
  const customer = buildPwaOutputConfig("customer", "https://api.example.com");
  assert.equal(customer.routes.at(-1).headers, undefined);
  assert.equal(customer.routes.length, 5);
});
