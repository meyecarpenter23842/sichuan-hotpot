import { BadRequestException, Body, Controller, Delete, Headers, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { IsIn, IsInt, IsString, Matches, Max, Min } from "class-validator";
import { R2CatalogMediaService, type MediaKind } from "./r2-catalog-media.service";
class Ticket {
 @IsIn(["image/png","image/jpeg","image/webp"]) contentType!:string;
 @IsInt() @Min(1) @Max(2097152) byteSize!:number;
}
class Attach {
 @IsString() @Matches(/^catalog-media\/[a-f0-9-]{36}\/(categories|groups|options)\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|jpg|webp)$/)
 key!:string;
}
const uuid=new ParseUUIDPipe({version:"4"});
@Controller("admin/branches/:branchId/catalog/media/:kind/:itemId")
export class AdminCatalogMediaController {
 constructor(private readonly media:R2CatalogMediaService){}
 private kind(value:string):MediaKind{
  if(value!=="categories"&&value!=="groups"&&value!=="options")
   throw new BadRequestException("INVALID_IMAGE_KIND");
  return value;
 }
 @Post("ticket")
 ticket(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string,
 @Param("kind") kind:string,@Param("itemId",uuid) id:string,@Body() input:Ticket){
  return this.media.ticket(auth,branchId,this.kind(kind),id,input);
 }
 @Post("attach")
 attach(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string,
 @Param("kind") kind:string,@Param("itemId",uuid) id:string,@Body() input:Attach){
  return this.media.attach(auth,branchId,this.kind(kind),id,input.key);
 }
 @Delete()
 remove(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string,
 @Param("kind") kind:string,@Param("itemId",uuid) id:string){
  return this.media.remove(auth,branchId,this.kind(kind),id);
 }
}
