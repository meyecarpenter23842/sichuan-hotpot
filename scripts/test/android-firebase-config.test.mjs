import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertFirebaseConfig } from "../android/firebase-config.mjs";

test("Android production configuration requires matching Firebase package", () => {
  const root = mkdtempSync(join(tmpdir(), "hotpot-fcm-config-"));
  const directory = join(root, "admin");
  mkdirSync(directory);
  try {
    assert.throws(() => assertFirebaseConfig(directory, "admin"), /Missing apps\/admin\/google-services.json/);
    const descriptor = {
      project_info: { project_id: "project-0fc02e8a-d32e-4ea9-884", project_number: "265040680128" },
      client: [{ client_info: { mobilesdk_app_id: "1:265040680128:android:abcdef",
        android_client_info: { package_name: "vn.sichuanhotpot.customer" } },
        api_key: [{ current_key: "fake-key-for-local-test" }] }],
    };
    writeFileSync(join(directory, "google-services.json"), JSON.stringify(descriptor));
    assert.throws(() => assertFirebaseConfig(directory, "admin"), /package mismatch/);
    descriptor.client[0].client_info.android_client_info.package_name = "vn.sichuanhotpot.admin";
    writeFileSync(join(directory, "google-services.json"), JSON.stringify(descriptor));
    assert.equal(assertFirebaseConfig(directory, "admin").fixture, false);
    descriptor.project_info.project_id = "another-firebase-project";
    writeFileSync(join(directory, "google-services.json"), JSON.stringify(descriptor));
    assert.throws(() => assertFirebaseConfig(directory, "admin"), /Firebase project\/sender mismatch/);
    descriptor.project_info.project_id = "project-0fc02e8a-d32e-4ea9-884";
    descriptor.project_info.project_number = "999999999999";
    writeFileSync(join(directory, "google-services.json"), JSON.stringify(descriptor));
    assert.throws(() => assertFirebaseConfig(directory, "admin"), /Firebase project\/sender mismatch/);
    descriptor.project_info.project_number = "265040680128";
    descriptor.project_info.project_id = "hotpot-ci-fixture";
    writeFileSync(join(directory, "google-services.json"), JSON.stringify(descriptor));
    const ci = process.env.CI;
    const allow = process.env.HOTPOT_FIREBASE_CI_FIXTURE;
    try {
      process.env.CI = "1"; delete process.env.HOTPOT_FIREBASE_CI_FIXTURE;
      assert.throws(() => assertFirebaseConfig(directory, "admin"), /CI-only Firebase fixture/);
      process.env.HOTPOT_FIREBASE_CI_FIXTURE = "1";
      assert.equal(assertFirebaseConfig(directory, "admin").fixture, true);
    } finally {
      if (ci === undefined) delete process.env.CI; else process.env.CI = ci;
      if (allow === undefined) delete process.env.HOTPOT_FIREBASE_CI_FIXTURE;
      else process.env.HOTPOT_FIREBASE_CI_FIXTURE = allow;
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
