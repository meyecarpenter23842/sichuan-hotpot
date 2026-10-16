import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminHomeOffersController, PublicHomeOffersController } from "./home-offers.controller";
import { HomeOffersService } from "./home-offers.service";

@Module({
  imports:[AuthModule],
  providers:[HomeOffersService],
  controllers:[AdminHomeOffersController,PublicHomeOffersController],
})
export class HomeOffersModule {}
