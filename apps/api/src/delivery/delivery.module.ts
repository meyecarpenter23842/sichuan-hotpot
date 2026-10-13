import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RoadRoutingService } from "./road-routing.service";
import { DeliveryQuoteService } from "./delivery-quote.service";
import { DeliveryQuoteController } from "./delivery-quote.controller";

@Module({
  imports: [AuthModule],
  providers: [RoadRoutingService, DeliveryQuoteService],
  controllers: [DeliveryQuoteController],
  exports: [RoadRoutingService, DeliveryQuoteService],
})
export class DeliveryModule {}
