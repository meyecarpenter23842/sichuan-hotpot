import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/screens/AuthScreen.tsx", import.meta.url), "utf8");
const viewport = readFileSync(new URL("../scripts/lock-pwa-viewport.mjs", import.meta.url), "utf8");

test("Google Web OAuth has a stable root callback", () => {
  assert.match(auth, /redirectUri: Platform\.OS === "web" \? window\.location\.origin \+ "\/"/);
  assert.match(auth, /Google\.useIdTokenAuthRequest/);
});

test("homepage is search-free while Menu retains search", () => {
  assert.doesNotMatch(app, /<View style=\{styles\.homeSearch\}>/);
  assert.match(app, /case "menu":/);
  assert.match(app, /<Field label="Tìm món ăn, trà sữa"/);
});

test("bottom nav is viewport anchored with only content scrolling", () => {
  assert.match(app, /bottomNavigation: \{ position: "absolute", left: 0, right: 0, bottom: 0/);
  assert.match(app, /body: \{ flex: 1, minHeight: 0, paddingBottom: 58 \}/);
  assert.match(viewport, /#root\{height:100dvh;min-height:0\}/);
  assert.match(viewport, /overflow:hidden/);
});
