import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type IdentifiedRequest = Request & { requestId?: string };

@Injectable()
export class RequestIdMiddleware {
  use(request: IdentifiedRequest, response: Response, next: NextFunction): void {
    const incoming = request.header("x-request-id");
    // Do not reflect untrusted free-form headers into response/log output.
    const requestId = incoming && /^[a-zA-Z0-9_-]{8,64}$/.test(incoming)
      ? incoming
      : randomUUID();
    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  }
}
