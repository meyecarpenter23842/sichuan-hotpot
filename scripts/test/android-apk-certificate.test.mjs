import assert from "node:assert/strict";
import test from "node:test";
import { parseApkCertificateFingerprints, assertRetailProductionSigner } from "../android/apk-certificate.mjs";

const sha1 = "5e8f16062ea3cd2c4a0d547876baa6f38cabf625";
const sha256 = "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c";

test("parses actual Windows apksigner V2 Signer output", () => {
  const text = `V2 Signer: certificate DN: CN=Android Debug, OU=Android, O=Unknown
V2 Signer: certificate SHA-256 digest: ${sha256}
V2 Signer: certificate SHA-1 digest: ${sha1}
V2 Signer: certificate MD5 digest: deadbeef
`;
  assert.deepEqual(parseApkCertificateFingerprints(text), {
    sha1: sha1.toUpperCase(), sha256: sha256.toUpperCase(),
  });
});

test("supports older numbered signer output and colon-delimited fingerprints", () => {
  const colon = value => value.match(/.{2}/g).join(":");
  const result = parseApkCertificateFingerprints(`Signer #1 certificate SHA-1 digest: ${colon(sha1)}
Signer #1 certificate SHA-256 digest: ${colon(sha256)}`);
  assert.equal(result.sha1, sha1.toUpperCase());
  assert.equal(result.sha256, sha256.toUpperCase());
});

test("repeated V1/V2 signatures from same certificate remain valid", () => {
  const output = `V1 Signer: certificate SHA-1 digest: ${sha1}
V1 Signer: certificate SHA-256 digest: ${sha256}
V2 Signer: certificate SHA-1 digest: ${sha1}
V2 Signer: certificate SHA-256 digest: ${sha256}`;
  assert.equal(parseApkCertificateFingerprints(output).sha1, sha1.toUpperCase());
});

test("rejects missing, malformed and conflicting certificate fingerprints", () => {
  assert.throws(() => parseApkCertificateFingerprints(""), /No complete/);
  assert.throws(() => parseApkCertificateFingerprints("V2 Signer: certificate SHA-1 digest: abc"), /Malformed/);
  const different = "a".repeat(40);
  assert.throws(() => parseApkCertificateFingerprints(`V2 Signer: certificate SHA-1 digest: ${sha1}
V3 Signer: certificate SHA-1 digest: ${different}
V2 Signer: certificate SHA-256 digest: ${sha256}`), /multiple signing certificate/);
});

test("Retail production rejects a debug certificate even if the SHA was pinned", () => {
  assert.throws(() => assertRetailProductionSigner(
    "V2 Signer: certificate DN: CN=Android Debug, OU=Android, O=Unknown"), /Android Debug certificate/);
  assert.throws(() => assertRetailProductionSigner(
    "Signer #1 certificate SHA-1 digest: " + sha1), /signer subject missing/);
  assert.doesNotThrow(() => assertRetailProductionSigner(
    "Signer #1 certificate DN: CN=Retail Production, OU=Sichuan Hotpot"));
  assert.doesNotThrow(() => assertRetailProductionSigner(
    "V2 Signer: certificate DN: CN=Retail Production, OU=Sichuan Hotpot"));
  assert.throws(() => assertRetailProductionSigner(
    "V1 Signer: certificate DN: CN=Retail Production\\nV2 Signer: certificate DN: CN=Android Debug".replace("\\n", "\n")), /Android Debug certificate/);
});
