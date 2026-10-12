import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Single NestJS-scoped connection pool, never a client per HTTP request.
 * With no DATABASE_URL, /health/live still responds while readiness fails closed.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly client: PrismaClient | null;

  constructor() {
    const url = process.env.DATABASE_URL;
    this.client = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
  }

  async isReady(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      // Avoid printing DB URL, query details or exception payload.
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
