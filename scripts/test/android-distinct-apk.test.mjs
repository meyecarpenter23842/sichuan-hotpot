import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDistinctAndroidIdentities, identities, synchronizeAndroidIdentity } from "../android/release-identity.mjs";

test("Android Customer and Admin have different package IDs and clear launcher names", () => {
  const customer = JSON.parse(readFileSync(new URL("../../apps/customer/app.json", import.meta.url), "utf8")).expo;
  const admin = JSON.parse(readFileSync(new URL("../../apps/admin/app.json", import.meta.url), "utf8")).expo;
  assert.equal(customer.android.package, identities.customer.packageId);
  assert.equal(admin.android.package, identities.admin.packageId);
  assert.equal(customer.name, identities.customer.label);
  assert.equal(admin.name, identities.admin.label);
  assert.notEqual(customer.android.package, admin.android.package);
  assert.notEqual(customer.name, admin.name);
  assert.notEqual(customer.android.adaptiveIcon.backgroundColor, admin.android.adaptiveIcon.backgroundColor);
  assertDistinctAndroidIdentities(identities.customer, identities.admin);
  assert.throws(() => assertDistinctAndroidIdentities(identities.customer, identities.customer), /different Android application IDs/);
});

function withNativeFixture(app, task) {
  const root = mkdtempSync(join(tmpdir(), "hotpot-android-identity-"));
  const res = join(root, "android", "app", "src", "main", "res", "values");
  mkdirSync(res, { recursive: true });
  const identity = identities[app];
  writeFileSync(join(root, "app.json"), JSON.stringify({
    expo: { name: identity.label, android: { package: identity.packageId } },
  }));
  const gradle = join(root, "android", "app", "build.gradle");
  writeFileSync(gradle, `android { defaultConfig { applicationId '${identity.packageId}' } }`);
  const xml = join(res, "strings.xml");
  writeFileSync(xml, `<resources><string name="app_name">${identity.legacyLabel || identity.label}</string></resources>`);
  const colors = join(res, "colors.xml");
  writeFileSync(colors, `<resources><color name="iconBackground">#FFFFFF</color></resources>`);
  try {
    task({ root, gradle, xml, colors });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Admin upgrades old Android launcher label and icon tint without deleting native files", () => {
  withNativeFixture("admin", ({ root, xml, colors }) => {
    synchronizeAndroidIdentity(root, "admin");
    assert.match(readFileSync(xml, "utf8"), /Hotpot Admin/);
    assert.match(readFileSync(colors, "utf8"), /#1F3546/);
    assert.equal(synchronizeAndroidIdentity(root, "admin").label, "Hotpot Admin");
  });
});

test("Customer retains launcher label and original white icon background", () => {
  withNativeFixture("customer", ({ root, xml, colors }) => {
    synchronizeAndroidIdentity(root, "customer");
    assert.match(readFileSync(xml, "utf8"), /Sichuan Hotpot/);
    assert.match(readFileSync(colors, "utf8"), /#FFFFFF/);
  });
});

test("native identity checker fails closed for wrong applicationId or custom launcher", () => {
  withNativeFixture("admin", ({ root, gradle, xml }) => {
    writeFileSync(gradle, "defaultConfig { applicationId 'vn.sichuanhotpot.customer' }");
    assert.throws(() => synchronizeAndroidIdentity(root, "admin"), /applicationId/);
    writeFileSync(gradle, "defaultConfig { applicationId 'vn.sichuanhotpot.admin' }");
    writeFileSync(xml, "<resources><string name=\"app_name\">Other Store</string></resources>");
    assert.throws(() => synchronizeAndroidIdentity(root, "admin"), /refusing to overwrite/);
  });
});

test("release runner creates uniquely named APKs after the same guarded Gradle command", () => {
  const builder = readFileSync(new URL("../android/build-release.mjs", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../../.github/workflows/android-windows-release-ci.yml", import.meta.url), "utf8");
  assert.match(builder, /synchronizeAndroidIdentity\(appDirectory, app\)/);
  assert.match(builder, /sichuan-hotpot-\$\{app\}-release\.apk/);
  assert.match(builder, /copyFileSync\(apk, namedApk\)/);
  assert.match(workflow, /dist\/android\/sichuan-hotpot-\$\{\{ matrix\.app \}\}-release\.apk/);
});
