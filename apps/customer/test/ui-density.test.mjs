import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const theme = readFileSync(new URL("../src/theme.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../src/screens/AuthScreen.tsx", import.meta.url), "utf8");

function styleBlock(source, name) {
  const start = source.indexOf("  " + name + ": {", source.indexOf("StyleSheet.create({"));
  assert.ok(start >= 0, name + " style should exist");
  const rest = source.slice(start + 3);
  const next = /\n  (?=[a-zA-Z][a-zA-Z0-9_]*:\s*\{)/.exec(rest);
  return source.slice(start, next ? start + 3 + next.index : source.indexOf("\n});", start));
}

test("customer typography uses compact shared mobile roles", () => {
  for (const [role, size] of Object.entries({
    caption: 11, small: 12, body: 13, action: 14,
    section: 16, page: 20, hero: 22, loginHero: 24,
  })) {
    assert.match(theme, new RegExp("\\b" + role + ": " + size + "\\b"));
  }
  for (const [style, role] of Object.entries({
    homeBannerTitle: "hero", sectionTitle: "section", pageTitle: "page",
    detailTitle: "page", productName: "action", navLabel: "caption",
  })) {
    assert.match(styleBlock(app, style), new RegExp("fontSize: typeScale\\." + role + "\\b"));
  }
  assert.match(styleBlock(auth, "welcomeTitle"), /fontSize: typeScale\.loginHero/);
  assert.match(styleBlock(auth, "heading"), /fontSize: typeScale\.page/);
});

test("mobile controls remain touchable and Safari inputs avoid focus zoom", () => {
  assert.match(styleBlock(app, "navItem"), /minHeight: 58\b/);
  assert.match(styleBlock(app, "button"), /minHeight: 46\b/);
  assert.match(styleBlock(app, "input"), /fontSize: 16\b/);
  assert.match(styleBlock(auth, "input"), /fontSize: 16\b/);
  assert.match(styleBlock(auth, "action"), /minHeight: 46\b/);
  assert.match(app, /testID="home-approved-hero"/);
  assert.match(app, /testID="home-section-title"/);
});
