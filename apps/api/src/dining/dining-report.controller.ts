import {
  BadRequestException, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Query,
} from "@nestjs/common";
import { DiningReportService } from "./dining-report.service";

@Controller("dining/reports")
export class DiningReportController {
  constructor(private readonly report: DiningReportService) {}

  private dates(from?: string, to?: string): { from: string; to: string } {
    if (!from || !to) throw new BadRequestException("INCOMPLETE_ORDER_DATE");
    return { from, to };
  }
  private page(rawPage?: string, rawLimit?: string) {
    if ((rawPage && !/^\d{1,5}$/.test(rawPage)) ||
        (rawLimit && !/^\d{1,2}$/.test(rawLimit)))
      throw new BadRequestException("DINING_REPORT_PAGE_INVALID");
    return { page: rawPage ? Number(rawPage) : 0, limit: rawLimit ? Number(rawLimit) : 20 };
  }

  @Get("branches/:branchId")
  @Header("Cache-Control", "no-store")
  summary(@Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Query("from") from?: string, @Query("to") to?: string) {
    const range = this.dates(from, to);
    return this.report.summary(auth, branchId, range.from, range.to);
  }

  @Get("branches/:branchId/products")
  @Header("Cache-Control", "no-store")
  products(@Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Query("from") from?: string, @Query("to") to?: string,
    @Query("page") rawPage?: string, @Query("limit") rawLimit?: string) {
    const range = this.dates(from, to);
    return this.report.products(auth, branchId, range.from, range.to,
      this.page(rawPage, rawLimit).page, this.page(rawPage, rawLimit).limit);
  }

  @Get("branches/:branchId/collectors")
  @Header("Cache-Control", "no-store")
  collectors(@Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Query("from") from?: string, @Query("to") to?: string,
    @Query("page") rawPage?: string, @Query("limit") rawLimit?: string) {
    const range = this.dates(from, to);
    return this.report.collectors(auth, branchId, range.from, range.to,
      this.page(rawPage, rawLimit).page, this.page(rawPage, rawLimit).limit);
  }
}
