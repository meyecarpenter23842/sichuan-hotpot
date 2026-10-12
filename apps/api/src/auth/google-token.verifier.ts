import { Injectable, UnauthorizedException, ServiceUnavailableException } from "@nestjs/common";
import { OAuth2Client } from "google-auth-library";

// Each registered public client ID is trusted explicitly; never accept an arbitrary JWT audience.
// GOOGLE_CLIENT_ID remains supported for existing server deployments.
export function configuredGoogleAudiences(): string[] {
  const ids = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
  ].filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  return [...new Set(ids.map(id => id.trim()))];
}

@Injectable()
export class GoogleTokenVerifier {
  async verify(idToken: string): Promise<string> {
    const audiences = configuredGoogleAudiences();
    if (!audiences.length) throw new ServiceUnavailableException("Google sign-in unavailable");
    try {
      const client = new OAuth2Client();
      const ticket = await client.verifyIdToken({ idToken, audience: audiences });
      const payload = ticket.getPayload();
      if (
        !payload || !payload.sub || payload.sub.length > 255
        || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)
        || !audiences.includes(payload.aud)
      ) throw new Error("Invalid ID token claims");
      return payload.sub;
    } catch {
      throw new UnauthorizedException("Invalid Google credentials");
    }
  }
}
