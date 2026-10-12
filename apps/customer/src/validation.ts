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
