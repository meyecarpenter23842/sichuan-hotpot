import { Body, Controller, Header, Headers, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { IsInt, IsString, IsIn, Matches, Max, Min } from "class-validator";
import { R2ProductImagesService } from "./r2-product-images.service";

class UploadTicketInput {
  @IsIn(["image/png", "image/jpeg", "image/webp"]) contentType!: string;
  @IsInt() @Min(1) @Max(2097152) byteSize!: number;
}
class AttachImageInput {
  @IsString()
  @Matches(/^products-image\/[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]{36}\.(png|jpg|webp)$/)
  key!: string;
}
const uuid = new ParseUUIDPipe({ version: "4" });
@Controller("admin/branches/:branchId/catalog/products/:productId/images")
@Header("Cache-Control", "no-store")
export class AdminImagesController {
  constructor(private readonly images: R2ProductImagesService) {}

  @Post("ticket")
  ticket(@Headers("authorization") authorization: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("productId", uuid) productId: string,
    @Body() input: UploadTicketInput) {
    return this.images.ticket(authorization, branchId, productId, input);
  }

  @Post("attach")
  attach(@Headers("authorization") authorization: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("productId", uuid) productId: string,
    @Body() input: AttachImageInput) {
    return this.images.attach(authorization, branchId, productId, input.key);
  }
}
