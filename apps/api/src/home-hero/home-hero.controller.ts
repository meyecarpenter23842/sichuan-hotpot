import { Body, Controller, Delete, Get, Header, Headers, Param,
  ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional,
  IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { HomeHeroService, type HeroTransitionType } from "./home-hero.service";

const uuid=new ParseUUIDPipe({version:"4"});

class HeroConfigPatch {
  @IsInt() @Min(0) revision!:number;
  @IsBoolean() autoplay!:boolean;
  @IsInt() @Min(2000) @Max(10000) dwellMs!:number;
  @IsIn(["fade","slide","wipe"]) transitionType!:HeroTransitionType;
  @IsInt() @Min(250) @Max(1000) transitionDurationMs!:number;
}
class HeroSlideCreate {
  @IsString() @MinLength(1) @MaxLength(200) altText!:string;
  @IsOptional() @IsString() @MaxLength(160) title?:string|null;
  @IsOptional() @IsString() @MaxLength(280) subtitle?:string|null;
  @IsOptional() @IsIn(["MENU"]) ctaTarget?:"MENU"|null;
  @IsInt() @Min(0) @Max(100000) sortOrder!:number;
}
class HeroSlidePatch {
  @IsInt() @Min(0) revision!:number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) altText?:string;
  @IsOptional() @IsString() @MaxLength(160) title?:string|null;
  @IsOptional() @IsString() @MaxLength(280) subtitle?:string|null;
  @IsOptional() @IsIn(["MENU"]) ctaTarget?:"MENU"|null;
  @IsOptional() @IsBoolean() enabled?:boolean;
}
class HeroSlideOrder {
  @IsArray() @ArrayMaxSize(100) @IsUUID("4",{each:true}) ids!:string[];
}
class HeroMediaTicket {
  @IsIn(["image/png","image/jpeg","image/webp"]) contentType!:string;
  @IsInt() @Min(1) @Max(2097152) byteSize!:number;
}
class HeroMediaAttach {
  @IsString()
  @Matches(/^catalog-media\/[a-f0-9-]{36}\/hero\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|jpg|webp)$/)
  key!:string;
}

@Controller("catalog/branches/:branchId/hero")
export class PublicHomeHeroController {
  constructor(private readonly hero:HomeHeroService){}
  @Get()
  @Header("Cache-Control","no-store")
  get(@Param("branchId",uuid) branchId:string){return this.hero.publicGet(branchId);}
}

@Controller("admin/branches/:branchId/hero")
export class AdminHomeHeroController {
  constructor(private readonly hero:HomeHeroService){}
  @Get()
  @Header("Cache-Control","no-store")
  get(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string){return this.hero.adminGet(auth,branchId);}
  @Put("config")
  config(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Body() input:HeroConfigPatch){
    const {revision,...changes}=input;
    return this.hero.updateConfig(auth,branchId,revision,changes);
  }
  @Post("slides")
  create(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Body() input:HeroSlideCreate){
    return this.hero.createSlide(auth,branchId,input);
  }
  @Put("slides/order")
  reorder(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Body() input:HeroSlideOrder){
    return this.hero.reorder(auth,branchId,input.ids);
  }
  @Patch("slides/:id")
  update(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Param("id",uuid) id:string,
    @Body() input:HeroSlidePatch){
    const {revision,...changes}=input;
    return this.hero.updateSlide(auth,branchId,id,revision,changes);
  }
  @Delete("slides/:id")
  remove(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Param("id",uuid) id:string){
    return this.hero.removeSlide(auth,branchId,id);
  }
  @Post("slides/:id/image/ticket")
  ticket(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Param("id",uuid) id:string,
    @Body() input:HeroMediaTicket){return this.hero.ticket(auth,branchId,id,input);}
  @Post("slides/:id/image/attach")
  attach(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Param("id",uuid) id:string,
    @Body() input:HeroMediaAttach){return this.hero.attach(auth,branchId,id,input.key);}
  @Delete("slides/:id/image")
  removeImage(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Param("id",uuid) id:string){
    return this.hero.removeImage(auth,branchId,id);
  }
}
