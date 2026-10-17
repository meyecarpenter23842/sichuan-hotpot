import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = dirname(fileURLToPath(import.meta.url));
const firebaseDescriptor = join(appDirectory, "google-services.json");

/**
 * Customer Android uses the key-free OSM map. Firebase is optional for local
 * development: when the gitignored descriptor is present, FCM is configured;
 * otherwise Expo can still prebuild and run the app without push registration.
 */
export default ({ config }) => {
  const android = { ...(config.android ?? {}) };

  if (existsSync(firebaseDescriptor)) {
    android.googleServicesFile = "./google-services.json";
  } else {
    delete android.googleServicesFile;
  }

  // Do not reintroduce Google Maps config. Customer native maps are OSM-only.
  if (android.config?.googleMaps) {
    const { googleMaps: _removedGoogleMaps, ...restConfig } = android.config;
    android.config = restConfig;
  }

  return {
    ...config,
    android,
  };
};
