import { Controller, Get, Header, Param, ParseUUIDPipe } from "@nestjs/common";
import { CatalogService } from "./catalog.service";

/** Guest-visible catalogue; neither endpoint requires authentication. */
@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("branches")
  @Header("Cache-Control", "no-store")
  branches() {
    return this.catalog.branches();
  }

  @Get("branches/:branchId")
  @Header("Cache-Control", "no-store")
  menu(@Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string) {
    return this.catalog.menu(branchId);
  }
}
