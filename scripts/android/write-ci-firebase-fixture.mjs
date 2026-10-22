import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

if (process.env.CI !== "1" || process.env.HOTPOT_FIREBASE_CI_FIXTURE !== "1") {
  throw new Error("Only CI can generate a synthetic Firebase descriptor.");
}
const app = process.argv[2];
if (!["admin", "customer", "retail"].includes(app)) throw new Error("Usage: node write-ci-firebase-fixture.mjs admin|customer");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const directory = join(root, "apps", app);
mkdirSync(directory, { recursive: true });
const cfg = {
  project_info: { project_number: "123456789012", project_id: "hotpot-ci-fixture", storage_bucket: "hotpot-ci-fixture.appspot.com" },
  client: [{ client_info: { mobilesdk_app_id: "1:123456789012:android:0123456789abcdef012345",
    android_client_info: { package_name: "vn.sichuanhotpot." + app } },
    api_key: [{ current_key: "AIzaSyCIONLYNOTAREALFIREBASEAPIKEY000000000" }] }],
  configuration_version: "1",
};
writeFileSync(join(directory, "google-services.json"), JSON.stringify(cfg) + "\n", { mode: 0o600 });
console.log("CI Firebase placeholder ready for " + app + " — APK cannot receive push.");
