import test from "node:test";
import assert from "node:assert/strict";
import { TIEN_GIANG_OLD_WARD_CODES, isWardAllowedForNewDelivery,
  selectableWardsForProvince } from "../dist/tien-giang-service-area.js";
import { ADMIN_CATALOG_VERSION, wardsForProvince, validateAdministrativeSelection,
  displayAdministrativeSelection } from "../dist/vietnam-admin.js";

const all = wardsForProvince("82");
const allowed = selectableWardsForProvince("82");
const excluded = all.filter(ward => !isWardAllowedForNewDelivery("82", ward.code));

// 13 historical phường in Mỹ Tho, Gò Công and Cai Lậy, not inferred from names.
const oldTienGiangPhuong = ["28249","28261","28270","28273","28285",
  "28297","28306","28315","28729","28435","28436","28439","28477"];

test("original versioned catalogue remains at 102; explicit 57/45 business split", () => {
  assert.equal(ADMIN_CATALOG_VERSION, "vn-2026-09-08");
  assert.equal(all.length, 102);
  assert.equal(TIEN_GIANG_OLD_WARD_CODES.length, 57);
  assert.equal(new Set(TIEN_GIANG_OLD_WARD_CODES).size, 57);
  assert.equal(allowed.length, 57);
  assert.equal(excluded.length, 45);
  assert.deepEqual(allowed.map(w => w.code).sort(), [...TIEN_GIANG_OLD_WARD_CODES].sort());
  assert.equal(oldTienGiangPhuong.length, 13);
  for (const code of oldTienGiangPhuong) assert.ok(TIEN_GIANG_OLD_WARD_CODES.includes(code));
  assert.equal(57 - oldTienGiangPhuong.length, 44);
  for (const ward of allowed) {
    assert.ok(validateAdministrativeSelection({
      provinceCode: "82", wardCode: ward.code, catalogVersion: ADMIN_CATALOG_VERSION,
    }));
  }
  for (const ward of excluded) assert.equal(isWardAllowedForNewDelivery("82", ward.code), false);
});

test("official master list and existing history display never shrink or disappear", () => {
  assert.equal(wardsForProvince("82").length, 102);
  assert.ok(displayAdministrativeSelection({ catalogVersion: ADMIN_CATALOG_VERSION,
    provinceCode: "82", wardCode: excluded[0].code }));
  assert.equal(isWardAllowedForNewDelivery("82", null), false);
  assert.equal(isWardAllowedForNewDelivery("82", "99999"), false);
  assert.equal(isWardAllowedForNewDelivery("82", "28261"), true);
  assert.equal(isWardAllowedForNewDelivery("82", "29944"), false);
  assert.equal(selectableWardsForProvince("79").length, wardsForProvince("79").length);
  assert.equal(isWardAllowedForNewDelivery("79", "25747"), true);
});
