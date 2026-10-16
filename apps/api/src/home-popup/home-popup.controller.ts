import { Body,Controller,Delete,Get,Header,Headers,Param,ParseUUIDPipe,Patch,Post,Put } from "@nestjs/common";
import { ArrayMaxSize,IsArray,IsBoolean,IsIn,IsInt,IsOptional,IsString,IsUUID,Matches,Max,MaxLength,Min,MinLength } from "class-validator";
import { HomePopupService } from "./home-popup.service";

const uuid=new ParseUUIDPipe({version:"4"});

class PopupConfigPatch {
  @IsInt() @Min(0) revision!:number;
  @IsBoolean() enabled!:boolean;
  @IsInt() @Min(5) @Max(10080) repeatIntervalMinutes!:number;
  @IsInt() @Min(2000) @Max(10000) slideDwellMs!:number;
}
class PopupSlideCreate {
  @IsString() @MinLength(1) @MaxLength(200) altText!:string;
  @IsInt() @Min(0) @Max(100000) sortOrder!:number;
}
class PopupSlidePatch {
  @IsInt() @Min(0) revision!:number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) altText?:string;
  @IsOptional() @IsBoolean() enabled?:boolean;
}
class PopupSlideOrder {
  @IsArray() @ArrayMaxSize(100) @IsUUID("4",{each:true}) ids!:string[];
}
class PopupMediaTicket {
  @IsIn(["image/png","image/jpeg","image/webp"]) contentType!:string;
  @IsInt() @Min(1) @Max(2097152) byteSize!:number;
}
class PopupMediaAttach {
  @IsString()
  @Matches(/^catalog-media\/[a-f0-9-]{36}\/popup\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|jpg|webp)$/)
  key!:string;
}

@Controller("catalog/branches/:branchId/popup")
export class PublicHomePopupController {
  constructor(private readonly popup:HomePopupService){}
  @Get()
  @Header("Cache-Control","no-store")
  get(@Param("branchId",uuid) branchId:string){return this.popup.publicGet(branchId);}
}

@Controller("admin/branches/:branchId/popup")
export class AdminHomePopupController {
  constructor(private readonly popup:HomePopupService){}
  @Get()
  @Header("Cache-Control","no-store")
  get(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string){
    return this.popup.adminGet(auth,branchId);
  }
  @Put("config")
  config(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string,
    @Body() input:PopupConfigPatch){
    const {revision,...changes}=input;return this.popup.updateConfig(auth,branchId,revision,changes);
  }
  @Post("slides")
  create(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string,
    @Body() input:PopupSlideCreate){return this.popup.createSlide(auth,branchId,input);}
  @Put("slides/order")
  reorder(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string,
    @Body() input:PopupSlideOrder){return this.popup.reorder(auth,branchId,input.ids);}
  @Patch("slides/:id")
  update(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string,
    @Param("id",uuid) id:string,@Body() input:PopupSlidePatch){
    const {revision,...changes}=input;return this.popup.updateSlide(auth,branchId,id,revision,changes);
  }
  @Delete("slides/:id")
  remove(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string,
    @Param("id",uuid) id:string){return this.popup.removeSlide(auth,branchId,id);}
  @Post("slides/:id/image/ticket")
  ticket(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string,
    @Param("id",uuid) id:string,@Body() input:PopupMediaTicket){
    return this.popup.ticket(auth,branchId,id,input);
  }
  @Post("slides/:id/image/attach")
  attach(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string,
    @Param("id",uuid) id:string,@Body() input:PopupMediaAttach){
    return this.popup.attach(auth,branchId,id,input.key);
  }
  @Delete("slides/:id/image")
  removeImage(@Headers("authorization") auth:string|undefined,@Param("branchId",uuid) branchId:string,
    @Param("id",uuid) id:string){return this.popup.removeImage(auth,branchId,id);}
}
