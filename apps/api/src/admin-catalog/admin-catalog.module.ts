import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminBranchesController, AdminCatalogController } from "./admin-catalog.controller";
import { AdminCatalogService } from "./admin-catalog.service";
import { AdminImagesController } from "./admin-images.controller";
import { R2ProductImagesService } from "./r2-product-images.service";

@Module({
  imports: [AuthModule],
  controllers: [AdminBranchesController, AdminCatalogController, AdminImagesController],
  providers: [AdminCatalogService, R2ProductImagesService],
})
export class AdminCatalogModule {}
