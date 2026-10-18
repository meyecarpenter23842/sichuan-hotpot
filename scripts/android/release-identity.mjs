import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const identities = Object.freeze({
  customer: { packageId: "vn.sichuanhotpot.customer", label: "Sichuan Hotpot" },
  admin: { packageId: "vn.sichuanhotpot.admin", label: "Hotpot Admin", legacyLabel: "Sichuan Hotpot Admin", iconBackground: "#1F3546" },
});

export function assertDistinctAndroidIdentities(customer, admin) {
  if (!customer?.packageId || !admin?.packageId || customer.packageId === admin.packageId) {
    throw new Error("Customer and Admin must use different Android application IDs.");
  }
}

export function synchronizeAndroidIdentity(appDirectory, app) {
  const expected = identities[app];
  if (!expected) throw new Error("Unknown Android app: " + app);
  const settings = JSON.parse(readFileSync(join(appDirectory, "app.json"), "utf8")).expo;
  if (settings?.android?.package !== expected.packageId || settings?.name !== expected.label) {
    throw new Error("Android package/launcher name differs from approved " + app + " identity.");
  }
  const androidDir = join(appDirectory, "android", "app");
  const gradle = readFileSync(join(androidDir, "build.gradle"), "utf8");
  const ids = [...gradle.matchAll(/\bapplicationId\s*(?:=\s*)?["']([^"']+)["']/g)].map(m => m[1]);
  if (ids.length !== 1 || ids[0] !== expected.packageId) {
    throw new Error("Generated native " + app + " applicationId is not " + expected.packageId + "; prebuild requires review.");
  }

  // Local android/ may predate app.json. Sync the generated launcher label
  // in-place without destructive Expo prebuild or touching other native files.
  const stringsPath = join(androidDir, "src", "main", "res", "values", "strings.xml");
  const xml = readFileSync(stringsPath, "utf8");
  const labelPattern = /(<string\s+name="app_name"\s*>)([^<]*)(<\/string>)/g;
  const matches = [...xml.matchAll(labelPattern)];
  if (matches.length !== 1) throw new Error("Expected exactly one Android app_name resource.");
  const label = matches[0][2];
  if (label !== expected.label && label !== expected.legacyLabel) {
    throw new Error("Unknown native " + app + " app_name; refusing to overwrite a custom launcher label.");
  }
  if (label !== expected.label) {
    writeFileSync(stringsPath, xml.replace(labelPattern, (_whole, open, _value, close) => open + expected.label + close));
  }

  // Expo's adaptive icon background is a generated Android resource.
  // Keep pre-existing native builds visually consistent with app.json.
  if (expected.iconBackground) {
    const colorsPath = join(androidDir, "src", "main", "res", "values", "colors.xml");
    if (existsSync(colorsPath)) {
      const colors = readFileSync(colorsPath, "utf8");
      const colorPattern = /(<color\s+name="iconBackground"\s*>)(#[0-9a-fA-F]{6,8})(<\/color>)/g;
      const entries = [...colors.matchAll(colorPattern)];
      if (entries.length === 1) {
        const original = entries[0][2].toUpperCase();
        if (!["#FFFFFF", expected.iconBackground].includes(original)) {
          throw new Error("Unexpected custom Admin adaptive icon background; review before updating.");
        }
        if (original !== expected.iconBackground) {
          writeFileSync(colorsPath, colors.replace(colorPattern, (_whole, open, _value, close) => open + expected.iconBackground + close));
        }
      }
    }
  }
  return expected;
}

export { identities };
