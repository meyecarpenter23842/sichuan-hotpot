import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { RequestIdMiddleware } from "./http/request-id.middleware";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";

@Module({ imports: [HealthModule] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
