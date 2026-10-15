import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { Request, Response } from "express";
import type { IdentifiedRequest } from "./request-id.middleware";

const HTTP_CODES: Readonly<Record<number, string>> = {
  400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN",
  404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY", 429: "TOO_MANY_REQUESTS",
  503: "SERVICE_UNAVAILABLE",
};

// Only public, non-sensitive business codes may leave the server.
// Validation payloads and unexpected exception messages remain redacted.
const CUSTOMER_QUOTE_CODES = new Set([
  "STORE_CLOSED", "BELOW_MINIMUM", "OUT_OF_RANGE",
  "INVALID_POLICY", "INVALID_SUBTOTAL", "ROUTE_UNAVAILABLE",
  "QR_NOT_CONFIGURED",
  "ADDRESS_REGION_UNCONFIRMED", "ZONE_NOT_SERVED", "ZONE_RATE_MISSING",
]);

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<IdentifiedRequest>();
    const response = ctx.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const payload: unknown = exception instanceof HttpException ? exception.getResponse() : null;
    const supplied = payload && typeof payload === "object" && "code" in payload
      ? (payload as { code?: unknown }).code : null;
    const publicCode = status === 422 && typeof supplied === "string"
      && CUSTOMER_QUOTE_CODES.has(supplied) ? supplied : null;
    const code = publicCode ?? HTTP_CODES[status]
      ?? (status >= 500 ? "INTERNAL_ERROR" : "HTTP_ERROR");
    // Never serialize exception objects, stack traces or class-validator inputs.
    const message = status >= 500 ? "Service unavailable" : "Request could not be processed";
    response.status(status).json({
      error: { code, message },
      requestId: request.requestId ?? null,
    });
  }
}
