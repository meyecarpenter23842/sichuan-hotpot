import { Module, RequestMethod } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { HomeOffersModule } from "./home-offers/home-offers.module";
import { HomeHeroModule } from "./home-hero/home-hero.module";
import { CatalogModule } from "./catalog/catalog.module";
import { CustomerAddressesModule } from "./customer-addresses/customer-addresses.module";
import { DeliveryModule } from "./delivery/delivery.module";
import { DeliveryPolicyModule } from "./delivery-policy/delivery-policy.module";
import { OrdersModule } from "./orders/orders.module";
import { AdminCatalogModule } from "./admin-catalog/admin-catalog.module";
import { RequestIdMiddleware } from "./http/request-id.middleware";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";

@Module({ imports: [HealthModule, AuthModule, CatalogModule, CustomerAddressesModule, DeliveryModule, DeliveryPolicyModule, OrdersModule, AdminCatalogModule, HomeOffersModule, HomeHeroModule] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: "{*path}", method: RequestMethod.ALL });
  }
}
