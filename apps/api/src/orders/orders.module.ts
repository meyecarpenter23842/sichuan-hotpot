import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DeliveryModule } from "../delivery/delivery.module";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  imports: [AuthModule, DeliveryModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
