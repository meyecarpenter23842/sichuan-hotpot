import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app=readFileSync(new URL("../App.tsx",import.meta.url),"utf8");
test("home recommendations use live featured flag and persistent order",()=>{
  assert.match(app,/item\.isFeatured && item\.isAvailable/);
  assert.match(app,/a\.sortOrder - b\.sortOrder/);
  assert.doesNotMatch(app,/products\.filter\(item => item\.isAvailable\)\.slice\(0, 8\)/);
});
