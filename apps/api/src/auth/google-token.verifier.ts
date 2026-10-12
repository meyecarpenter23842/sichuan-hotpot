import { Injectable, UnauthorizedException, ServiceUnavailableException } from "@nestjs/common";
import { OAuth2Client } from "google-auth-library";

@Injectable()
export class GoogleTokenVerifier {
  async verify(idToken: string): Promise<string> {
    const audience = process.env.GOOGLE_CLIENT_ID;
    if (!audience) throw new ServiceUnavailableException("Google sign-in unavailable");
    try {
      const client = new OAuth2Client(audience);
      const ticket = await client.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (
        !payload || !payload.sub || payload.sub.length > 255
        || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)
        || payload.aud !== audience
      ) throw new Error("Invalid ID token claims");
      return payload.sub;
    } catch {
      // Do not expose untrusted OAuth token, provider response, or diagnostic secrets.
      throw new UnauthorizedException("Invalid Google credentials");
    }
  }
}
