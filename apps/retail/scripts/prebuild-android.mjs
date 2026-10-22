import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertFirebaseConfig } from "../../../scripts/android/firebase-config.mjs";
import { configureGeneratedAndroid } from "../../../scripts/android/release-gradle.mjs";
import { synchronizeAndroidIdentity } from "../../../scripts/android/release-identity.mjs";
import { configureRetailSigning } from "../../../scripts/android/retail-signing.mjs";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDirectory, "..", "..");
const appJson = join(appDirectory, "app.json");
const original = readFileSync(appJson, "utf8");
const firebase = assertFirebaseConfig(appDirectory, "retail");
const androidDir = join(appDirectory, "android");
const googleServices = join(androidDir, "app", "google-services.json");

// NEVER remove an existing Android directory: it may contain unreleased signing or custom native edits.
if (existsSync(androidDir)) {
  if (!existsSync(googleServices) ||
      readFileSync(googleServices, "utf8") !== readFileSync(firebase.file, "utf8")) {
    throw new Error("Retail Android Firebase config changed; back up native edits and review before regenerating.");
  }
  configureGeneratedAndroid(appDirectory);
  synchronizeAndroidIdentity(appDirectory, "retail");
  configureRetailSigning(appDirectory);
  console.log("Retail existing native project checked without destructive prebuild.");
} else {
  const expoCli = [join(appDirectory, "node_modules", "expo", "bin", "cli"),
    join(repoRoot, "node_modules", "expo", "bin", "cli")].find(existsSync);
  if (!expoCli) throw new Error("Expo CLI not installed. Run npm ci in repo root.");
  try {
    const json = JSON.parse(original);
    json.expo.android.googleServicesFile = "./google-services.json";
    writeFileSync(appJson, JSON.stringify(json, null, 2) + "\n");
    console.log("Retail Firebase descriptor validated" + (firebase.fixture ? " (CI fixture only)" : ""));
    const processResult = spawnSync(process.execPath,
      [expoCli, "prebuild", "--platform", "android", "--no-install"],
      { cwd: appDirectory, stdio: "inherit" });
    if (processResult.error) throw processResult.error;
    if (processResult.status !== 0) process.exitCode = processResult.status ?? 1;
    else {
      configureGeneratedAndroid(appDirectory);
      synchronizeAndroidIdentity(appDirectory, "retail");
      configureRetailSigning(appDirectory);
    }
  } finally {
    writeFileSync(appJson, original);
  }
}
