import { Module, RequestMethod } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { CatalogModule } from "./catalog/catalog.module";
import { CustomerAddressesModule } from "./customer-addresses/customer-addresses.module";
import { RequestIdMiddleware } from "./http/request-id.middleware";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";

@Module({ imports: [HealthModule, AuthModule, CatalogModule, CustomerAddressesModule] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: "{*path}", method: RequestMethod.ALL });
  }
}
