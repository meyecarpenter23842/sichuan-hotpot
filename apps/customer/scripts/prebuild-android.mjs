import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = dirname(scriptDirectory);
const appJsonPath = join(appDirectory, "app.json");
const googleServicesPath = join(appDirectory, "google-services.json");

const originalText = readFileSync(appJsonPath, "utf8");
const originalConfig = JSON.parse(originalText);
const withFirebase = existsSync(googleServicesPath);

try {
  if (withFirebase) {
    const buildConfig = JSON.parse(originalText);
    buildConfig.expo.android.googleServicesFile = "./google-services.json";
    writeFileSync(appJsonPath, JSON.stringify(buildConfig, null, 2) + "\n");
    console.log("Android prebuild: Firebase descriptor detected; FCM native config enabled.");
  } else {
    console.log("Android prebuild: no google-services.json; building local app without FCM registration.");
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    npx,
    ["expo", "prebuild", "--platform", "android", "--clean", "--no-install"],
    { cwd: appDirectory, stdio: "inherit" },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  // Never leave build-only Firebase configuration in the tracked app.json.
  writeFileSync(appJsonPath, originalText);
}
