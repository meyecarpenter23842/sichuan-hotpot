import { Body, Controller, Delete, Get, Header, Headers, Param,
  ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601,
  IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { HomeOffersService } from "./home-offers.service";

const uuid=new ParseUUIDPipe({version:"4"});
class OfferCreate {
  @IsString() @MinLength(1) @MaxLength(160) title!:string;
  @IsString() @MinLength(1) @MaxLength(360) summary!:string;
  @IsString() @MinLength(1) @MaxLength(4000) body!:string;
  @IsInt() @Min(0) @Max(100000) sortOrder!:number;
  @IsOptional() @IsISO8601({strict:true}) startAt?:string|null;
  @IsOptional() @IsISO8601({strict:true}) endAt?:string|null;
  @IsOptional() @IsIn(["MENU"]) ctaTarget?:"MENU"|null;
}
class OfferPatch {
  @IsInt() @Min(0) revision!:number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) title?:string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(360) summary?:string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) body?:string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?:number;
  @IsOptional() @IsBoolean() enabled?:boolean;
  @IsOptional() @IsISO8601({strict:true}) startAt?:string|null;
  @IsOptional() @IsISO8601({strict:true}) endAt?:string|null;
  @IsOptional() @IsIn(["MENU"]) ctaTarget?:"MENU"|null;
}
class OfferOrder {
  @IsArray() @ArrayMaxSize(100) @IsUUID("4",{each:true}) ids!:string[];
}
class MediaTicket {
  @IsIn(["image/png","image/jpeg","image/webp"]) contentType!:string;
  @IsInt() @Min(1) @Max(2097152) byteSize!:number;
}
class MediaAttach {
  @IsString() @Matches(/^catalog-media\/[a-f0-9-]{36}\/offers\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|jpg|webp)$/)
  key!:string;
}
@Controller("catalog/branches/:branchId/offers")
export class PublicHomeOffersController {
  constructor(private readonly offers:HomeOffersService){}
  @Get()
  @Header("Cache-Control","no-store")
  list(@Param("branchId",uuid) branchId:string){return this.offers.publicList(branchId);}
}
@Controller("admin/branches/:branchId/offers")
export class AdminHomeOffersController {
  constructor(private readonly offers:HomeOffersService){}
  @Get()
  @Header("Cache-Control","no-store")
  list(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string){return this.offers.adminList(auth,branchId);}
  @Post()
  create(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Body() input:OfferCreate){
    return this.offers.create(auth,branchId,input);
  }
  @Put("order")
  order(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Body() input:OfferOrder){
    return this.offers.reorder(auth,branchId,input.ids);
  }
  @Patch(":id")
  update(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Param("id",uuid) id:string,
    @Body() input:OfferPatch){
    const {revision,...changes}=input;
    return this.offers.update(auth,branchId,id,revision,changes);
  }
  @Delete(":id")
  remove(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Param("id",uuid) id:string){
    return this.offers.remove(auth,branchId,id);
  }
  @Post(":id/image/ticket")
  ticket(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Param("id",uuid) id:string,
    @Body() input:MediaTicket){return this.offers.ticket(auth,branchId,id,input);}
  @Post(":id/image/attach")
  attach(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Param("id",uuid) id:string,
    @Body() input:MediaAttach){return this.offers.attach(auth,branchId,id,input.key);}
  @Delete(":id/image")
  removeImage(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Param("id",uuid) id:string){
    return this.offers.removeImage(auth,branchId,id);
  }
}
