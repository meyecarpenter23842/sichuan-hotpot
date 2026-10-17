import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";

export type GoogleLoginResult =
  | { type: "success"; idToken: string }
  | { type: "cancel" };

WebBrowser.maybeCompleteAuthSession();

const googleWebId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";

export function useGoogleLogin() {
  const redirectUri = typeof window === "undefined"
    ? "https://invalid.local/"
    : window.location.origin + "/";
  const [request, , prompt] = Google.useIdTokenAuthRequest({
    webClientId: googleWebId || "unconfigured.apps.googleusercontent.com",
    redirectUri,
  });

  return {
    configured: !!googleWebId,
    ready: !!request,
    start: async (): Promise<GoogleLoginResult> => {
      const response = await prompt();
      if (response.type === "cancel" || response.type === "dismiss") {
        return { type: "cancel" };
      }
      if (response.type === "error") {
        throw new Error("Google không thể xác thực lúc này. Vui lòng thử lại.");
      }
      if (response.type !== "success") {
        throw new Error("Google chưa hoàn tất đăng nhập. Vui lòng thử lại.");
      }
      const idToken = response.params?.id_token;
      if (!idToken) {
        throw new Error("Google chưa trả về mã xác minh. Vui lòng thử lại.");
      }
      return { type: "success", idToken };
    },
  };
}
