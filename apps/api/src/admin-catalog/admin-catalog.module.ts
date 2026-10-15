import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminBranchesController, AdminCatalogController } from "./admin-catalog.controller";
import { AdminCatalogService } from "./admin-catalog.service";
import { AdminBranchSetupService } from "./admin-branch-setup.service";
import { AdminImagesController } from "./admin-images.controller";
import { R2ProductImagesService } from "./r2-product-images.service";
import { ModifierLibraryService } from "./modifier-library.service";
import { ModifierLibraryController } from "./modifier-library.controller";

@Module({
  imports: [AuthModule],
  controllers: [AdminBranchesController, AdminCatalogController, AdminImagesController, ModifierLibraryController],
  providers: [AdminCatalogService, AdminBranchSetupService, R2ProductImagesService, ModifierLibraryService],
})
export class AdminCatalogModule {}
