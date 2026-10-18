import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// google-services.json contains Firebase Android identifiers and is supplied only at build time.
// Its Firebase API key is a client identifier, NOT a server Admin SDK credential.
export function assertFirebaseConfig(appDirectory, app) {
  if (!["admin", "customer"].includes(app)) throw new Error("Unknown Hotpot Android app");
  const file = join(appDirectory, "google-services.json");
  if (!existsSync(file)) throw new Error(
    `Missing apps/${app}/google-services.json. Download Android config for vn.sichuanhotpot.${app} from Firebase, then rebuild. Refusing a push-broken APK.`
  );
  let cfg;
  try { cfg = JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Error(`Invalid Firebase JSON for ${app}.`); }
  const matching = cfg.client?.find(c =>
    c.client_info?.android_client_info?.package_name === `vn.sichuanhotpot.${app}`);
  if (!matching || !cfg.project_info?.project_id ||
      !matching.client_info?.mobilesdk_app_id || !matching.api_key?.[0]?.current_key) {
    throw new Error(`Firebase package mismatch or invalid descriptor for vn.sichuanhotpot.${app}.`);
  }
  if (cfg.project_info.project_id === "hotpot-ci-fixture") {
    if (process.env.CI !== "1" || process.env.HOTPOT_FIREBASE_CI_FIXTURE !== "1") {
      throw new Error("CI-only Firebase fixture may not be used in a real APK.");
    }
    return { fixture: true, projectId: cfg.project_info.project_id, file };
  }
  return { fixture: false, projectId: cfg.project_info.project_id, file };
}
