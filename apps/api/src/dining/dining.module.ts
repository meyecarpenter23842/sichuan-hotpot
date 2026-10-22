import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "../auth/auth.module";
import { OrdersModule } from "../orders/orders.module";
import { PushModule } from "../push/push.module";
import { DiningGuestController, DiningStaffController } from "./dining.controller";
import { DiningService } from "./dining.service";

@Module({
  imports: [AuthModule, OrdersModule, PushModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }])],
  controllers: [DiningStaffController, DiningGuestController],
  providers: [DiningService],
})
export class DiningModule {}
