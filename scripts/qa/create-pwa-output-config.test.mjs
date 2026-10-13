import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPwaOutputConfig } from "./create-pwa-output-config.mjs";

test("customer prebuilt PWA proxies only the three POST session actions before SPA", () => {
  const config = buildPwaOutputConfig("customer", "https://132.145.103.89");
  assert.equal(config.version, 3);
  assert.deepEqual(config.routes, [
    { src: "^/api/session/(start|refresh|logout)$", methods: ["POST"],
      dest: "https://132.145.103.89/auth/browser/$1" },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/index.html" },
  ]);
});

test("no session proxy is added to admin PWA", () => {
  assert.deepEqual(buildPwaOutputConfig("admin"), {
    version: 3, routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/index.html" }],
  });
});

test("unsafe, non-origin, or missing backend destinations fail closed", () => {
  for (const origin of [undefined, "", "http://127.0.0.1:3000",
    "https://api.example.com/other", "https://api.example.com?unsafe=1",
    "https://user:secret@api.example.com"]) {
    assert.throws(() => buildPwaOutputConfig("customer", origin));
  }
});
