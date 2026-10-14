import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../../admin/src/CatalogPanel.tsx", import.meta.url), "utf8");
const optimizer = readFileSync(new URL("../../admin/src/prepare-product-image.ts", import.meta.url), "utf8");

test("guest menu fetch rechecks active branches and rejects stale responses", () => {
  assert.match(src, /const catalogueRequest = useRef\(0\)/);
  assert.match(src, /apiRequest<BranchSummary\[]>\("\/catalog\/branches"\)/);
  assert.match(src, /requestId !== catalogueRequest\.current/);
  assert.match(src, /setBranches\(list\)/);
  assert.match(src, /setMenu\(null\)/);
});
test("catalog refreshes on foreground, visibility and timer with HTTP as source", () => {
  assert.match(src, /AppState\.addEventListener\("change"/);
  assert.match(src, /document\.addEventListener\("visibilitychange"/);
  assert.match(src, /setInterval\(refreshIfVisible, 30000\)/);
  assert.match(src, /refreshCatalogue\(undefined, true\)/);
  assert.match(src, /\? old : ""/);
});
test("admin differentiates branch activation from product availability", () => {
  assert.match(admin, /!catalog\.isActive/);
  assert.match(admin, /Chi nhánh chưa kích hoạt/);
  assert.match(admin, /prepareProductImage\(file\)/);
  assert.doesNotMatch(admin, /file\.size > 2097152/);
  assert.match(optimizer, /MAX_UPLOAD_BYTES = 2 \* 1024 \* 1024/);
  assert.match(optimizer, /canvas\.toBlob/);
});
