import {
  GoogleSignin, isErrorWithCode, statusCodes,
} from "@react-native-google-signin/google-signin";

export type GoogleLoginResult =
  | { type: "success"; idToken: string }
  | { type: "cancel" };

const googleWebId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";
let configuredWebClientId = "";

function ensureConfigured(): void {
  if (!googleWebId) {
    throw new Error("Chưa cấu hình Google Web Client ID cho ứng dụng.");
  }
  if (configuredWebClientId === googleWebId) return;
  // Android OAuth identity is bound in Google Cloud by package name + SHA-1.
  // The web client ID is only the audience used to mint the server-verifiable ID token.
  GoogleSignin.configure({ webClientId: googleWebId, offlineAccess: false });
  configuredWebClientId = googleWebId;
}

function nativeGoogleError(error: unknown): Error {
  if (isErrorWithCode(error)) {
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      return new Error("GOOGLE_SIGN_IN_CANCELLED");
    }
    if (error.code === statusCodes.IN_PROGRESS) {
      return new Error("Google đang xử lý một lần đăng nhập khác.");
    }
    if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return new Error("Google Play Services chưa sẵn sàng trên thiết bị.");
    }
    if (error.code === "10" || error.code === "DEVELOPER_ERROR") {
      return new Error(
        "Google chưa cấp quyền cho chữ ký APK này. Kiểm tra OAuth Android: package vn.sichuanhotpot.customer và SHA-1 của APK đã cài. Không cần SHA riêng cho từng khách.",
      );
    }
  }
  return error instanceof Error
    ? error
    : new Error("Google không thể xác thực lúc này. Vui lòng thử lại.");
}

export function useGoogleLogin() {
  const configured = !!googleWebId;
  return {
    configured,
    ready: configured,
    start: async (): Promise<GoogleLoginResult> => {
      try {
        ensureConfigured();
        const available = await GoogleSignin.hasPlayServices({
          showPlayServicesUpdateDialog: true,
        });
        if (!available) {
          throw new Error("Google Play Services chưa sẵn sàng trên thiết bị.");
        }
        const response = await GoogleSignin.signIn();
        if (response.type === "cancelled") return { type: "cancel" };
        const idToken = response.data.idToken;
        if (!idToken) {
          throw new Error("Google chưa trả về mã xác minh. Vui lòng thử lại.");
        }
        return { type: "success", idToken };
      } catch (error) {
        const mapped = nativeGoogleError(error);
        if (mapped.message === "GOOGLE_SIGN_IN_CANCELLED") return { type: "cancel" };
        throw mapped;
      }
    },
  };
}
