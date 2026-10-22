import type { Tokens } from "./pos-api";

/** Web PWA stays in-memory by design; no localStorage or plaintext JWT. */
export async function loadStoredSession(): Promise<Tokens | null> { return null; }
export async function writeStoredSession(_tokens: Tokens | null): Promise<void> {
  // Browser persistence needs its own audited same-origin session design.
}
