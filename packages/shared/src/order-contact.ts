/**
 * Order delivery actions use immutable snapshots, not the customer's mutable
 * saved address. Never interpolate unvalidated input into URI schemes.
 */
export function orderCustomerCallUrl(phone: string | null | undefined): string | null {
  const value = phone?.trim();
  if (!value || !/^(?:\+84[35789]\d{8}|0[35789]\d{8})$/.test(value)) return null;
  return "tel:" + value;
}

export function orderCustomerDirectionsUrl(
  latitude: string | null | undefined, longitude: string | null | undefined,
): string | null {
  const decimal = /^-?\d{1,3}(?:\.\d{1,12})?$/;
  const lat = latitude?.trim();
  const lon = longitude?.trim();
  if (!lat || !lon || !decimal.test(lat) || !decimal.test(lon)) return null;
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)
    || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  // Google Maps shows the stored delivery pin and offers driving directions.
  return "https://www.google.com/maps/dir/?api=1&destination="
    + encodeURIComponent(lat + "," + lon) + "&travelmode=driving";
}
