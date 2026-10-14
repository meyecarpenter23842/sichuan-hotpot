import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DeliveryModule } from "../delivery/delivery.module";
import { OrdersController } from "./orders.controller";
import { AdminOrdersController } from "./admin-orders.controller";
import { AdminOrdersService } from "./admin-orders.service";
import { OrdersService } from "./orders.service";
import { OrderRealtimeService } from "./order-realtime.service";

@Module({
  imports: [AuthModule, DeliveryModule],
  controllers: [OrdersController, AdminOrdersController],
  providers: [OrdersService, AdminOrdersService, OrderRealtimeService],
  exports: [OrderRealtimeService],
})
export class OrdersModule {}
