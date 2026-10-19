/**
 * L02 #196: Commercial service-area allowlist for Tiền Giang (former province).
 * The 2026-09-08 official catalogue has 102 wards in new Đồng Tháp (82):
 * 57 from former Tiền Giang (13 phường, 44 xã) and 45 from former Đồng Tháp.
 * These explicit current ward codes are stable business policy, NOT a geographical
 * inference from place names, GPS coordinates, or code prefixes at runtime.
 * Leave the full official catalogue intact for display of historical records.
 */
export const TIEN_GIANG_OLD_WARD_CODES: readonly string[] = Object.freeze([
  "28249", "28261", "28270", "28273", "28285", "28297", "28306", "28315",
  "28435", "28436", "28439", "28477", "28729", "28321", "28327", "28336",
  "28345", "28360", "28366", "28378", "28393", "28405", "28414", "28426",
  "28429", "28444", "28456", "28468", "28471", "28501", "28504", "28516",
  "28519", "28525", "28537", "28543", "28564", "28576", "28582", "28594",
  "28603", "28615", "28627", "28633", "28648", "28651", "28660", "28663",
  "28678", "28687", "28693", "28696", "28702", "28720", "28723", "28738",
  "28747",
]);

const accepted = new Set(TIEN_GIANG_OLD_WARD_CODES);

/** Other provinces retain their original behavior. An unconfirmed Đồng Tháp
 * address is not automatically considered serviceable. */
export function isWardAllowedForNewDelivery(
  provinceCode: string | null | undefined, wardCode: string | null | undefined,
): boolean {
  return provinceCode !== "82" || (typeof wardCode === "string" && accepted.has(wardCode));
}

/** For new Customer address and Admin zone selections; do NOT use on history. */
export function selectableWardsForProvince<T extends { code: string }>(
  code: string, entries: readonly T[],
): T[] {
  return code === "82" ? entries.filter(ward => accepted.has(ward.code)) : [...entries];
}
