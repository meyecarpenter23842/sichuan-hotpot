import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = stripTypeScriptTypes(
  readFileSync(new URL("../src/pwa-viewport.ts", import.meta.url), "utf8"),
).replace("export function configureAdminViewport", "function configureAdminViewport");

function makeWebViewport() {
  const nodes = [];
  const properties = new Map();
  const documentEvents = new Map();
  const windowEvents = new Map();
  const visualEvents = new Map();
  const frames = [];
  const head = {
    appendChild(node) {
      node.parentNode = head;
      nodes.push(node);
    },
  };
  const document = {
    head,
    visibilityState: "visible",
    activeElement: null,
    documentElement: { style: { setProperty: (key, value) => properties.set(key, value) } },
    querySelector: () => null,
    getElementById: id => nodes.find(node => node.id === id) ?? null,
    createElement: tag => ({ tagName: tag, parentNode: null, textContent: "" }),
    addEventListener: (name, listener) => documentEvents.set(name, listener),
  };
  const visualViewport = {
    height: 812,
    scale: 1,
    addEventListener: (name, listener) => visualEvents.set(name, listener),
  };
  const window = {
    innerHeight: 812,
    visualViewport,
    addEventListener: (name, listener) => windowEvents.set(name, listener),
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
  };
  const configure = runInNewContext(
    source + "\nconfigureAdminViewport",
    { document, window, Number, Math },
  );
  const flush = () => { for (const callback of frames.splice(0)) callback(); };
  return { configure, document, window, nodes, properties, windowEvents, visualEvents, documentEvents, flush };
}

test("Admin web root fills the live iPhone PWA viewport; body rubber-band cannot move its tabs", () => {
  const page = makeWebViewport();
  page.configure();
  assert.equal(page.properties.get("--admin-app-viewport-height"), "812px");
  const layout = page.nodes.find(node => node.id === "admin-pwa-viewport-layout");
  assert.ok(layout, "root CSS must be installed");
  assert.match(layout.textContent, /#root\s*\{/);
  assert.match(layout.textContent, /height: var\(--admin-app-viewport-height, 100dvh\)/);
  assert.match(layout.textContent, /html, body\s*\{[^}]*overflow: hidden;[^}]*overscroll-behavior: none/s);
  assert.match(layout.textContent, /#root\s*\{[^}]*overflow: hidden/s);
  assert.equal(page.documentEvents.has("touchmove"), false, "inner ScrollViews must still scroll");
  page.configure();
  assert.equal(page.nodes.filter(node => node.id === "admin-pwa-viewport-layout").length, 1);
});

test("Admin PWA remeasures on Safari viewport changes, resume and rotation without jumping on keyboard", () => {
  const page = makeWebViewport();
  page.configure();
  page.window.visualViewport.height = 725;
  page.visualEvents.get("resize")();
  page.flush();
  assert.equal(page.properties.get("--admin-app-viewport-height"), "725px");

  page.document.activeElement = { matches: () => true };
  page.window.visualViewport.height = 480;
  page.windowEvents.get("resize")();
  page.flush();
  assert.equal(page.properties.get("--admin-app-viewport-height"), "725px",
    "keyboard must not lift navigation");
  page.document.activeElement = null;
  page.window.visualViewport.height = 790;
  page.documentEvents.get("focusout")();
  page.flush();
  assert.equal(page.properties.get("--admin-app-viewport-height"), "790px");

  page.document.visibilityState = "hidden";
  page.window.visualViewport.height = 900;
  page.documentEvents.get("visibilitychange")();
  page.flush();
  assert.equal(page.properties.get("--admin-app-viewport-height"), "790px");
  page.document.visibilityState = "visible";
  page.windowEvents.get("pageshow")();
  page.flush();
  assert.equal(page.properties.get("--admin-app-viewport-height"), "900px");
  page.window.visualViewport.scale = 2;
  page.window.innerHeight = 834;
  page.windowEvents.get("orientationchange")();
  page.flush();
  assert.equal(page.properties.get("--admin-app-viewport-height"), "834px");
});
