export interface AddressPinProps {
  latitude: string;
  longitude: string;
  /** Values are always explicit decimal latitude/longitude from a user pin. */
  onChange(latitude: string, longitude: string): void;
}
export function validPin(latitude: string, longitude: string) {
  const lat = Number(latitude), lng = Number(longitude);
  return latitude.trim().length > 0 && longitude.trim().length > 0
    && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
