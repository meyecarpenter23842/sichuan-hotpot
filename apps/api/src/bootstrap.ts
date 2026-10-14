import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { ApiExceptionFilter } from "./http/api-exception.filter";

/**
 * Explicit origin allowlist for customer/admin PWAs on another hostname.
 * No default '*' and no reflected Origin for an unlisted website.
 */
export function allowedCorsOrigins(raw = process.env.CORS_ALLOWED_ORIGINS ?? ""): Set<string> {
  const allowed = new Set<string>();
  for (const value of raw.split(",")) {
    const entry = value.trim();
    if (!entry) continue;
    let url: URL;
    try { url = new URL(entry); } catch { throw new Error("Invalid CORS_ALLOWED_ORIGINS entry"); }
    const isLocal = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((!isLocal && url.protocol !== "https:") || url.origin !== entry || url.username || url.password) {
      throw new Error("CORS_ALLOWED_ORIGINS must contain exact HTTPS origins (or local development origins)");
    }
    allowed.add(url.origin);
  }
  return allowed;
}

export function configureApp(app: INestApplication): void {
  const origins = allowedCorsOrigins();
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => callback(null, !!origin && origins.has(origin)),
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type"],
    credentials: false,
    maxAge: 600,
  });
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
  }));
  app.useGlobalFilters(new ApiExceptionFilter());
}
