// apksigner --print-certs labels differ by SDK and signature version:
// "Signer #1 certificate ..." and "V2 Signer: certificate ...".
// A pinned SHA protects upgrades, but pinning a disposable debug certificate
// at the first production build must never turn it into an approved signer.
export function assertRetailProductionSigner(output) {
  const subjects = [...String(output).matchAll(/^\s*(?:Signer #\d+:?|V\d+ Signer:)\s+certificate DN:\s*(.+)$/gim)]
    .map(match => match[1].trim());
  if (subjects.length === 0) {
    throw new Error("Retail production APK signer subject missing from apksigner verification.");
  }
  if (subjects.some(subject => /(?:^|,)\s*CN\s*=\s*Android Debug\s*(?:,|$)/i.test(subject))) {
    throw new Error("Retail release uses an Android Debug certificate. Refusing distribution even if SHA-256 was pinned.");
  }
}

export function parseApkCertificateFingerprints(output) {
  const results = new Map();
  const lines = String(output).split(/\r?\n/);
  for (const line of lines) {
    const matched = line.match(/^\s*(?:Signer #\d+:?|V\d+ Signer:)\s+certificate (SHA-1|SHA-256) digest:\s*([a-f0-9:]+)\s*$/i);
    if (!matched) continue;
    const type = matched[1].toUpperCase();
    const digest = matched[2].replace(/:/g, "").toUpperCase();
    const expected = type === "SHA-1" ? 40 : 64;
    if (digest.length !== expected) throw new Error("Malformed APK certificate " + type + " digest.");
    const previous = results.get(type);
    if (previous && previous !== digest) {
      throw new Error("APK has multiple signing certificate " + type + " digests; inspect signers before registering OAuth.");
    }
    results.set(type, digest);
  }
  const sha1 = results.get("SHA-1");
  const sha256 = results.get("SHA-256");
  if (!sha1 || !sha256) throw new Error("No complete APK signing certificate fingerprints found.");
  return { sha1, sha256 };
}
