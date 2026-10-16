import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../database/prisma.module";
import { AdminHomeHeroController, PublicHomeHeroController } from "./home-hero.controller";
import { HomeHeroService } from "./home-hero.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PublicHomeHeroController, AdminHomeHeroController],
  providers: [HomeHeroService],
})
export class HomeHeroModule {}
