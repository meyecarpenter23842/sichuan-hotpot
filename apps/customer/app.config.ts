import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConfigContext, ExpoConfig } from "expo/config";

const appDirectory = dirname(fileURLToPath(import.meta.url));
const firebaseDescriptor = join(appDirectory, "google-services.json");

/**
 * Local Android development must not be blocked by a Firebase file that is
 * intentionally gitignored. When the real descriptor exists, Expo includes it
 * and FCM is enabled. Without it, the native app still prebuilds/runs; push
 * registration remains unavailable until the descriptor is supplied.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const android = { ...(config.android ?? {}) };

  if (existsSync(firebaseDescriptor)) {
    android.googleServicesFile = "./google-services.json";
  } else {
    delete android.googleServicesFile;
  }

  return {
    ...config,
    android,
  };
};
