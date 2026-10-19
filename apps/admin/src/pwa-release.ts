/**
 * PWA release protocol: HTML and release JSON are stamped from the same,
 * immutable, CI-verified main commit. No caching or Android configuration.
 */
export const ADMIN_RELEASE_PATH = "/admin-release.json";
const SHA = /^[a-f0-9]{40}$/;

export function validAdminReleaseId(id: unknown): id is string {
  return typeof id === "string" && SHA.test(id);
}

export function embeddedAdminRelease(doc: Document): string | null {
  const id = doc.querySelector<HTMLMetaElement>('meta[name="hotpot-admin-release"]')
    ?.content ?? "";
  return validAdminReleaseId(id) ? id : null;
}

export async function requestAdminRelease(
  fetcher: typeof fetch, signal?: AbortSignal, now = Date.now(),
): Promise<string | null> {
  // Unique query + no-store bypasses older Safari HTTP cache entries; the
  // canonical same-origin endpoint must respond with an explicit release SHA.
  const response = await fetcher(ADMIN_RELEASE_PATH + "?v=" + now, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) return null;
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || !("id" in data)) return null;
  return validAdminReleaseId(data.id) ? data.id : null;
}
