import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { gitBlobSha, UI_REFERENCES, verifyUiReferences } from "../check-ui-references.mjs";

const directories = [];
afterEach(() => {
  while (directories.length) rmSync(directories.pop(), { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hotpot-ui-lock-"));
  directories.push(root);
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9p/8AAAAASUVORK5CYII=",
    "base64",
  );
  writeFileSync(join(root, "sample.png"), image);
  return { root, image, references: [{ path: "sample.png", blobSha: gitBlobSha(image) }] };
}

test("locks exactly eight customer/admin UI references", () => {
  assert.equal(UI_REFERENCES.length, 8);
  assert.equal(new Set(UI_REFERENCES.map((r) => r.path)).size, 8);
  assert.deepEqual(UI_REFERENCES.map((r) => r.path), [
    "01-home.png", "02-hotpot-detail.png", "03-delivery-address.png", "04-order-tracking.png",
    "01-dashboard.png", "02-kitchen-order-detail.png", "03-delivery-settings.png", "04-driver-assignment.png",
  ]);
});

test("accepts an unchanged PNG with its expected Git blob hash", () => {
  const { root, references } = fixture();
  assert.equal(verifyUiReferences(root, references), 1);
});

test("rejects modification of a reference", () => {
  const { root, image, references } = fixture();
  const changed = Buffer.from(image);
  changed[changed.length - 1] ^= 1;
  writeFileSync(join(root, "sample.png"), changed);
  assert.throws(() => verifyUiReferences(root, references), /Git blob SHA mismatch/);
});

test("rejects deleted or renamed files", () => {
  const { root, references } = fixture();
  rmSync(join(root, "sample.png"));
  assert.throws(() => verifyUiReferences(root, references), /file not readable or missing/);
});

test("rejects invalid PNG regardless of its checksum", () => {
  const { root } = fixture();
  const bad = Buffer.from("this is not a PNG file, but has a Git blob hash");
  writeFileSync(join(root, "sample.png"), bad);
  assert.throws(() => verifyUiReferences(root, [{ path: "sample.png", blobSha: gitBlobSha(bad) }]), /invalid PNG header/);
});

test("rejects duplicate entries and paths outside the repo", () => {
  const { root, references } = fixture();
  assert.throws(() => verifyUiReferences(root, [...references, ...references]), /duplicate reference entry/);
  assert.throws(() => verifyUiReferences(root, [{ path: "../elsewhere.png", blobSha: references[0].blobSha }]), /invalid or duplicate/);
});
