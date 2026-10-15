import { ADMIN_CATALOG_VERSION, PROVINCE_ROWS, WARD_ROWS } from "./vietnam-admin-data.js";
export { ADMIN_CATALOG_VERSION };
export interface AdministrativeArea { code: string; name: string; }
export interface AdministrativeWard extends AdministrativeArea { provinceCode: string; }
export interface AdministrativeSelection {
  catalogVersion: string;
  provinceCode: string;
  wardCode: string;
}
export const provinces: readonly AdministrativeArea[] = PROVINCE_ROWS.map(([code, name]) => ({ code, name }));
export const wards: readonly AdministrativeWard[] = WARD_ROWS.map(([code, name, provinceCode]) => ({
  code, name, provinceCode,
}));
const provinceMap = new Map(provinces.map(p => [p.code, p]));
const wardMap = new Map(wards.map(w => [w.code, w]));
export function wardsForProvince(code: string): AdministrativeWard[] {
  return wards.filter(w => w.provinceCode === code);
}
export function provinceByCode(code: string | null | undefined): AdministrativeArea | null {
  return code ? provinceMap.get(code) ?? null : null;
}
export function wardByCode(code: string | null | undefined): AdministrativeWard | null {
  return code ? wardMap.get(code) ?? null : null;
}
export function validateAdministrativeSelection(
  selection: { catalogVersion?: string | null; provinceCode?: string | null; wardCode?: string | null },
): selection is AdministrativeSelection {
  if (selection.catalogVersion !== ADMIN_CATALOG_VERSION) return false;
  const province = provinceByCode(selection.provinceCode);
  const ward = wardByCode(selection.wardCode);
  return !!province && !!ward && ward.provinceCode === province.code;
}
export function displayAdministrativeSelection(selection: {
  catalogVersion?: string | null; provinceCode?: string | null; wardCode?: string | null;
}): string | null {
  if (!validateAdministrativeSelection(selection)) return null;
  const province = provinceByCode(selection.provinceCode);
  const ward = wardByCode(selection.wardCode);
  return province && ward ? ward.name + ", " + province.name : null;
}
export function searchAdministrativeAreas<T extends AdministrativeArea>(
  values: readonly T[], query: string, limit = 150,
): T[] {
  const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/đ/g,"d").replace(/Đ/g,"D").toLowerCase().trim();
  const wanted = plain(query);
  return values.filter(v => plain(v.name).includes(wanted) || v.code.includes(wanted))
    .slice(0, limit);
}
