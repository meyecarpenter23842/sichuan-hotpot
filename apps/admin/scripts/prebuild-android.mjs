import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { configureGeneratedAndroid } from "../../../scripts/android/release-gradle.mjs";
import { assertFirebaseConfig } from "../../../scripts/android/firebase-config.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = dirname(scriptDirectory);
const workspaceRoot = resolve(appDirectory, "..", "..");
const appJsonPath = join(appDirectory, "app.json");

const originalText = readFileSync(appJsonPath, "utf8");
const firebase = assertFirebaseConfig(appDirectory, "admin");

function findExpoCli() {
  const candidates = [
    join(appDirectory, "node_modules", "expo", "bin", "cli"),
    join(workspaceRoot, "node_modules", "expo", "bin", "cli"),
  ];
  const expoCli = candidates.find(candidate => existsSync(candidate));
  if (!expoCli) {
    throw new Error("Không tìm thấy Expo CLI. Hãy chạy npm ci ở thư mục gốc repo rồi thử lại.");
  }
  return expoCli;
}

try {
  const buildConfig = JSON.parse(originalText);
  buildConfig.expo.android.googleServicesFile = "./google-services.json";
  writeFileSync(appJsonPath, JSON.stringify(buildConfig, null, 2) + "\n");
  console.log("Firebase configuration validated for Admin" + (firebase.fixture ? " [CI fixture only]" : ""));

  const result = spawnSync(
    process.execPath,
    [findExpoCli(), "prebuild", "--platform", "android", "--clean", "--no-install"],
    { cwd: appDirectory, stdio: "inherit" },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    configureGeneratedAndroid(appDirectory);
  }
} finally {
  // Keep the repository secret-free after every local or CI prebuild.
  writeFileSync(appJsonPath, originalText);
}
