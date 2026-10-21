import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "../auth/auth.module";
import { DiningGuestController, DiningStaffController } from "./dining.controller";
import { DiningService } from "./dining.service";

@Module({
  imports: [AuthModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }])],
  controllers: [DiningStaffController, DiningGuestController],
  providers: [DiningService],
})
export class DiningModule {}
