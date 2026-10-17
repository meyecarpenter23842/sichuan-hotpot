export type GoogleLoginResult =
  | { type: "success"; idToken: string }
  | { type: "cancel" };

export function useGoogleLogin(): {
  configured: boolean;
  ready: boolean;
  start: () => Promise<GoogleLoginResult>;
};
