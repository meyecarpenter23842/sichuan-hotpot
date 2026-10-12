import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  ready(): never {
    // Fail closed until Prisma proves a real DB connection and the P1 auth
    // dependencies are wired; environment variables alone cannot prove readiness.
    throw new ServiceUnavailableException("Readiness probe not initialized");
  }
}
