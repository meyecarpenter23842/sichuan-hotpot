import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../database/prisma.module";
import { AdminHomePopupController, PublicHomePopupController } from "./home-popup.controller";
import { HomePopupService } from "./home-popup.service";

@Module({
  imports:[PrismaModule,AuthModule],
  controllers:[PublicHomePopupController,AdminHomePopupController],
  providers:[HomePopupService],
})
export class HomePopupModule {}
