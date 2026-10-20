import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const config = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const shell = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/api-origin.ts", import.meta.url), "utf8");
const release = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("Expo Web workspace has strict typed production build and locked Git deploy", () => {
  assert.equal(pkg.name, "@hotpot/retail");
  assert.match(pkg.scripts.build, /expo export --platform web/);
  assert.equal(config.expo.web.output, "single");
  assert.equal(release.git.deploymentEnabled, false);
});
test("Bootstrap is deliberately read-only before authenticated dining API is released", () => {
  assert.match(shell, /Chưa nhận (đơn|yêu cầu)/);
  assert.match(shell, /Kiểm tra kết nối/);
  assert.doesNotMatch(shell, /\/dining\//);
  assert.match(source, /process\.env\.EXPO_PUBLIC_API_BASE_URL/);
  assert.doesNotMatch(source, /process\.env\.(?:DATABASE_URL|AUTH_JWT_SECRET)/);
});
