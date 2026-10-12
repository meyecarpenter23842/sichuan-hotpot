export function usernameError(username: string): string | null {
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username.trim().toLowerCase())) {
    return "Tên đăng nhập: 3–32 ký tự, bắt đầu bằng chữ cái; dùng a–z, 0–9, dấu . _ -";
  }
  return null;
}
export function passwordError(password: string, register: boolean): string | null {
  if (!password) return "Vui lòng nhập mật khẩu.";
  if (register && (password.length < 12 || password.length > 128)) {
    return "Mật khẩu mới phải dài 12–128 ký tự.";
  }
  return null;
}
export function phoneError(phone: string): string | null {
  if (!/^(?:\+84|0)(?:[35789]\d{8})$/.test(phone.replace(/[\s.-]/g, ""))) {
    return "Nhập số điện thoại di động Việt Nam hợp lệ.";
  }
  return null;
}
export function addressError(line: string, latitude: string, longitude: string): string | null {
  if (line.trim().length < 8 || line.trim().length > 500) {
    return "Địa chỉ cần tối thiểu 8 ký tự, gồm số nhà và tên đường.";
  }
  const lat = Number(latitude.trim()), lng = Number(longitude.trim());
  if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return "Cần xác nhận tọa độ GPS hoặc ghim vị trí trên bản đồ.";
  }
  return null;
}
export const vnd = (amount: number): string =>
  Number.isSafeInteger(amount) && amount >= 0
    ? new Intl.NumberFormat("vi-VN").format(amount) + " ₫"
    : "Liên hệ";

/** Validate only the option IDs currently offered by server catalogue. */
export function optionSelectionError(groups: readonly {
  readonly name: string; readonly minSelect: number; readonly maxSelect: number;
  readonly options: readonly { readonly id: string; readonly isAvailable: boolean }[];
}[], chosen: readonly string[]): string | null {
  if (chosen.length > 30 || new Set(chosen).size !== chosen.length) return "Tùy chọn món không hợp lệ.";
  const allowed = new Set(groups.flatMap(group => group.options.map(opt => opt.id)));
  if (chosen.some(id => !allowed.has(id))) return "Tùy chọn món không hợp lệ.";
  for (const group of groups) {
    const accepted = group.options.filter(option => chosen.includes(option.id));
    if (accepted.some(option => !option.isAvailable)) return "Tùy chọn đã hết hàng.";
    if (accepted.length < group.minSelect) return "Vui lòng chọn đủ tùy chọn: " + group.name;
    if (accepted.length > group.maxSelect) return "Chọn quá số tùy chọn: " + group.name;
  }
  return null;
}
