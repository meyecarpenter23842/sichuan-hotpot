import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = dirname(scriptDirectory);
const workspaceRoot = resolve(appDirectory, "..", "..");
const appJsonPath = join(appDirectory, "app.json");
const googleServicesPath = join(appDirectory, "google-services.json");

const originalText = readFileSync(appJsonPath, "utf8");
const withFirebase = existsSync(googleServicesPath);

function findExpoCli() {
  const candidates = [
    join(appDirectory, "node_modules", "expo", "bin", "cli"),
    join(workspaceRoot, "node_modules", "expo", "bin", "cli"),
  ];
  const expoCli = candidates.find((candidate) => existsSync(candidate));
  if (!expoCli) {
    throw new Error("Không tìm thấy Expo CLI. Hãy chạy npm ci ở thư mục gốc repo rồi thử lại.");
  }
  return expoCli;
}

try {
  if (withFirebase) {
    const buildConfig = JSON.parse(originalText);
    buildConfig.expo.android.googleServicesFile = "./google-services.json";
    writeFileSync(appJsonPath, JSON.stringify(buildConfig, null, 2) + "\n");
    console.log("Android prebuild: Firebase descriptor detected; FCM native config enabled.");
  } else {
    console.log("Android prebuild: no google-services.json; building local app without FCM registration.");
  }

  const result = spawnSync(
    process.execPath,
    [findExpoCli(), "prebuild", "--platform", "android", "--clean", "--no-install"],
    { cwd: appDirectory, stdio: "inherit" },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  // Never leave build-only Firebase configuration in the tracked app.json.
  writeFileSync(appJsonPath, originalText);
}
