import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDineinOutputConfig } from "./create-dinein-output-config.mjs";

test("Retail PWA redirects preview to canonical and proxies staff browser sessions", () => {
  const routes = buildDineinOutputConfig("retail", "https://api.bepsi.click").routes;
  assert.equal(routes[0].headers.Location, "https://retail.bepsi.click/$1");
  assert.equal(routes[1].src, "^/api/session/(start|refresh|logout)$");
  assert.equal(routes[1].dest, "https://api.bepsi.click/auth/browser/$1");
  assert.equal(routes.at(-2).handle, "filesystem");
  assert.equal(routes.at(-1).dest, "/index.html");
});

test("Public QR Menu PWA redirects previews but never exposes auth proxy", () => {
  const config = buildDineinOutputConfig("menu");
  assert.equal(config.version, 3);
  assert.equal(config.routes[0].headers.Location, "https://menu.bepsi.click/$1");
  assert.ok(!config.routes.some(r => r.src?.includes("/api/session")));
  assert.equal(config.routes.at(-1).headers["Cache-Control"], "no-store, max-age=0, must-revalidate");
});

test("Retail route builder rejects unsafe API origins and unsupported apps", () => {
  for (const value of [undefined, "", "http://localhost", "https://api.bepsi.click/unsafe",
                       "https://api.bepsi.click?x=1", "https://user:pass@api.bepsi.click"]) {
    assert.throws(() => buildDineinOutputConfig("retail", value));
  }
  assert.throws(() => buildDineinOutputConfig("admin", "https://api.bepsi.click"));
});
