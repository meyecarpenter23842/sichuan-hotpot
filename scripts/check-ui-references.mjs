/**
 * Locks the eight original UI references to their Git blob hashes.
 * Update only in a separately reviewed design-reference change.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const UI_REFERENCES = Object.freeze([
  { path: "01-home.png", blobSha: "7342863e88a0d3252b399ca9ae9824cf8b0b9827" },
  { path: "02-hotpot-detail.png", blobSha: "369c8213461962cb9ed6fc3eb3946137c200393e" },
  { path: "03-delivery-address.png", blobSha: "ae328665d050987e945a8b980c88fb131db6577d" },
  { path: "04-order-tracking.png", blobSha: "a7e65ba2718993feb49ecdf29aa6c37ce145b3ca" },
  { path: "01-dashboard.png", blobSha: "36652c825f97e5f60929bb16a6cda4095e3e4e59" },
  { path: "02-kitchen-order-detail.png", blobSha: "3067715d63976d9660250b9f5be414f09607b4d1" },
  { path: "03-delivery-settings.png", blobSha: "1cb4263dabaab16011ec250fd6ad11cbebf2e178" },
  { path: "04-driver-assignment.png", blobSha: "d77f95ae007e831289266c6ddbf15bffa93feb14" },
]);

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

/** Git hashes blobs using a length-prefixed header, not plain SHA-1. */
export function gitBlobSha(bytes) {
  return createHash("sha1")
    .update("blob " + bytes.length + "\0")
    .update(bytes)
    .digest("hex");
}

export function verifyUiReferences(rootDirectory, references = UI_REFERENCES) {
  const root = resolve(rootDirectory);
  if (references.length === 0) throw new Error("UI reference lock has no entries");
  const seen = new Set();
  const failures = [];

  for (const reference of references) {
    const file = resolve(root, reference.path);
    if (
      seen.has(reference.path)
      || !file.startsWith(root + sep)
      || !/^[a-f0-9]{40}$/.test(reference.blobSha)
    ) {
      failures.push(reference.path + ": invalid or duplicate reference entry");
      continue;
    }
    seen.add(reference.path);

    let bytes;
    try {
      bytes = readFileSync(file);
    } catch {
      failures.push(reference.path + ": file not readable or missing");
      continue;
    }
    if (
      bytes.length < 24
      || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
      || bytes.toString("ascii", 12, 16) !== "IHDR"
    ) {
      failures.push(reference.path + ": invalid PNG header");
      continue;
    }
    if (gitBlobSha(bytes) !== reference.blobSha) {
      failures.push(reference.path + ": Git blob SHA mismatch (original mockup modified)");
    }
  }

  if (failures.length > 0) {
    throw new Error("UI reference integrity FAILED:\n" + failures.join("\n"));
  }
  return references.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const total = verifyUiReferences(process.cwd());
    console.log("UI reference integrity: PASS (" + total + " original PNG files unchanged)");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
