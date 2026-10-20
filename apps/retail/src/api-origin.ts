/** A public build-time HTTPS origin; never put secrets into EXPO_PUBLIC_ variables. */
export const API_ORIGIN = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, "") ?? "";

export function isValidApiOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    return (url.protocol === "https:" || local) && url.origin === value &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
