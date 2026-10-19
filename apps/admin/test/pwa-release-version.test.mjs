import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  ADMIN_RELEASE_PATH, embeddedAdminRelease,
  requestAdminRelease, validAdminReleaseId,
} from "../src/pwa-release.ts";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const root = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("PWA release is strictly tied to a real commit and same-origin HTML meta", () => {
  assert.equal(validAdminReleaseId(shaA), true);
  assert.equal(validAdminReleaseId(shaA.toUpperCase()), false);
  assert.equal(validAdminReleaseId("development"), false);
  assert.equal(validAdminReleaseId(""), false);
  assert.equal(embeddedAdminRelease({
    querySelector: () => ({ content: shaA }),
  }), shaA);
  assert.equal(embeddedAdminRelease({ querySelector: () => ({ content: "local" }) }), null);
  assert.equal(embeddedAdminRelease({ querySelector: () => null }), null);
});

test("PWA version probe bypasses Safari cache and validates JSON response", async () => {
  let call;
  const fetcher = async (url, options) => {
    call = { url, options };
    return { ok: true, json: async () => ({ id: shaB }) };
  };
  const result = await requestAdminRelease(fetcher, undefined, 184123);
  assert.equal(result, shaB);
  assert.equal(ADMIN_RELEASE_PATH, "/admin-release.json");
  assert.equal(call.url, "/admin-release.json?v=184123");
  assert.equal(call.options.cache, "no-store");
  assert.equal(call.options.credentials, "same-origin");
  assert.equal(call.options.method, "GET");
  assert.equal(call.options.headers.Accept, "application/json");
});

test("PWA probe fails closed for outages, HTML fallback or malformed release metadata", async () => {
  for (const response of [
    { ok: false, json: async () => ({ id: shaB }) },
    { ok: true, json: async () => ({ id: "development" }) },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => null },
    { ok: true, json: async () => { throw Error("not JSON"); } },
  ]) {
    assert.equal(await requestAdminRelease(async () => response), null);
  }
});

test("PWA update checks on foreground while never forcing reload during a live order", () => {
  const notice = root("../src/AdminPwaReleaseNotice.tsx");
  const admin = root("../App.tsx");
  const releaseScript = root("../../../scripts/qa/inject-brand-manifest.mjs");
  assert.match(notice, /window\.addEventListener\("pageshow"/);
  assert.match(notice, /document\.addEventListener\("visibilitychange"/);
  assert.match(notice, /window\.addEventListener\("focus"/);
  assert.match(notice, /window\.addEventListener\("online"/);
  assert.match(notice, /setInterval\(\(\) => \{ void check\(\); \}, 120000\)/);
  assert.match(notice, /window\.location\.reload\(\)/);
  assert.match(notice, /onPress=\{\(\) => window\.location\.reload\(\)\}/);
  assert.doesNotMatch(notice, /latest !== current\) window\.location\.reload\(/);
  assert.match(admin, /<AdminPwaReleaseNotice \/>/);
  assert.match(releaseScript, /process\.env\.REQUESTED_SHA \|\| process\.env\.GITHUB_SHA/);
  assert.match(releaseScript, /admin-release\.json/);
  assert.match(releaseScript, /hotpot-admin-release/);
  assert.doesNotMatch(releaseScript, /google-services|keystore|firebase/i);
});
