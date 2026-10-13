import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DeliveryPolicyController } from "./delivery-policy.controller";
import { DeliveryPolicyService } from "./delivery-policy.service";

@Module({
  imports: [AuthModule],
  controllers: [DeliveryPolicyController],
  providers: [DeliveryPolicyService],
})
export class DeliveryPolicyModule {}
