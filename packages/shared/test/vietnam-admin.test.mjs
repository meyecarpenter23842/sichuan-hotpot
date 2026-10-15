import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_CATALOG_VERSION, provinces, wards, wardsForProvince,
  validateAdministrativeSelection, searchAdministrativeAreas } from "../dist/vietnam-admin.js";
test("official codes retain zero prefixes, 34 provinces, 3321 wards", () => {
  assert.equal(provinces.length, 34);
  assert.equal(wards.length, 3321);
  assert.equal(new Set(wards.map(w=>w.code)).size, 3321);
  assert.equal(provinces.find(p=>p.code==="01")?.name, "Hà Nội");
  assert.ok(wardsForProvince("79").length > 150);
});
test("same ward names never imply identical province; version/code ownership is mandatory", () => {
  const ward=wardsForProvince("79")[0];
  assert.ok(ward);
  assert.equal(validateAdministrativeSelection({catalogVersion:ADMIN_CATALOG_VERSION,
    provinceCode:"79",wardCode:ward.code}),true);
  assert.equal(validateAdministrativeSelection({catalogVersion:ADMIN_CATALOG_VERSION,
    provinceCode:"01",wardCode:ward.code}),false);
  assert.equal(validateAdministrativeSelection({catalogVersion:"old",
    provinceCode:"79",wardCode:ward.code}),false);
  assert.equal(validateAdministrativeSelection({catalogVersion:ADMIN_CATALOG_VERSION,
    provinceCode:"79",wardCode:"00000"}),false);
  assert.ok(searchAdministrativeAreas(provinces,"ho chi minh").some(p=>p.code==="79"));
});
