import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseEnv } from "node:util";

// Match Expo's production dotenv order, without printing environment values.
// Existing process environment takes precedence over .env files.
export function loadReleaseEnv(appDirectory, initialEnvironment = process.env) {
  const result = { ...initialEnvironment };
  if (result.EXPO_NO_DOTENV === "1") return result;
  for (const file of [".env.production.local", ".env.local", ".env.production", ".env"]) {
    const path = join(appDirectory, file);
    if (!existsSync(path)) continue;
    let parsed;
    try {
      parsed = parseEnv(readFileSync(path, "utf8"));
    } catch {
      throw new Error(`Invalid ${file} in ${basename(appDirectory)}; cannot parse release environment.`);
    }
    for (const [name, value] of Object.entries(parsed)) {
      if (!Object.hasOwn(result, name)) result[name] = value;
    }
  }
  return result;
}

export function assertAndroidReleaseEnv(app, env) {
  if (env.EXPO_NO_CLIENT_ENV_VARS === "1") {
    throw new Error("Expo client env inlining is disabled; Android release would not have an API URL.");
  }
  const base = String(env.EXPO_PUBLIC_API_BASE_URL || "").trim();
  const ciPlaceholder = env.CI === "1" && base === "https://api-ci.invalid";
  let parsed;
  try { parsed = new URL(base); } catch { /* handled below */ }
  if (
    !parsed || parsed.protocol !== "https:" ||
    parsed.origin !== (base.endsWith("/") ? base.slice(0, -1) : base) ||
    parsed.username || parsed.password ||
    (!ciPlaceholder && (parsed.hostname.endsWith(".invalid") || parsed.hostname === "localhost"))
  ) {
    throw new Error(
      `Missing/invalid EXPO_PUBLIC_API_BASE_URL for ${app} Android release. ` +
      `Set the real HTTPS API origin in apps/${app}/.env.local or in the build environment. ` +
      "Do not distribute APKs with test or empty API endpoints.",
    );
  }
  if (app === "customer") {
    const googleId = String(env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "").trim();
    if (
      !googleId.endsWith(".apps.googleusercontent.com") ||
      (env.CI !== "1" && /^(ci-|unconfigured)/.test(googleId))
    ) {
      throw new Error(
        "Missing/invalid EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID for Customer Android. " +
        "Use the real OAuth Web client ID; Android package + APK signing SHA-1 " +
        "must also be registered in Google Cloud.",
      );
    }
  }
  return { isCiPlaceholder: ciPlaceholder };
}
