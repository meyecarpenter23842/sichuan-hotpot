import { Body, Controller, Headers, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { IsArray, ArrayMaxSize, IsBoolean, IsInt, IsOptional, IsString,
  IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";
import { ModifierLibraryService } from "./modifier-library.service";
const uuid = new ParseUUIDPipe({version:"4"});
class GroupDto {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsInt() @Min(0) @Max(30) minSelect!: number;
  @IsInt() @Min(1) @Max(30) maxSelect!: number;
  @IsInt() @Min(-1000) @Max(1000) sortOrder!: number;
}
class GroupPatchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(30) minSelect?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) maxSelect?: number;
  @IsOptional() @IsInt() @Min(-1000) @Max(1000) sortOrder?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
}
class OptionDto {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsInt() @Min(0) @Max(100000000) priceDeltaVnd!: number;
}
class OptionPatchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) priceDeltaVnd?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
}
class SetGroupProductsDto {
  @IsArray() @ArrayMaxSize(200) @IsUUID("4",{each:true}) productIds!: string[];
  @IsInt() @Min(0) revision!: number;
}
class SetGroupAssignmentsDto {
  @IsArray() @ArrayMaxSize(30) @IsUUID("4", {each:true}) groupIds!: string[];
  @IsInt() @Min(0) revision!: number;
}
@Controller("admin/branches/:branchId/catalog")
export class ModifierLibraryController {
  constructor(private readonly lib: ModifierLibraryService) {}
  @Post("library/groups")
  create(@Headers("authorization") auth: string | undefined,
    @Param("branchId",uuid) branchId: string,@Body() dto: GroupDto) {
    return this.lib.create(auth,branchId,dto);
  }
  @Patch("library/groups/:groupId")
  update(@Headers("authorization") auth: string | undefined,
    @Param("branchId",uuid) branchId: string,@Param("groupId",uuid) groupId:string,
    @Body() dto:GroupPatchDto) {return this.lib.update(auth,branchId,groupId,dto);}
  @Post("library/groups/:groupId/options")
  createOption(@Headers("authorization") auth: string | undefined,
    @Param("branchId",uuid) branchId: string,@Param("groupId",uuid) groupId:string,
    @Body() dto:OptionDto) {return this.lib.addOption(auth,branchId,groupId,dto);}
  @Patch("library/options/:optionId")
  updateOption(@Headers("authorization") auth: string | undefined,
    @Param("branchId",uuid) branchId: string,@Param("optionId",uuid) optionId:string,
    @Body() dto:OptionPatchDto) {return this.lib.updateOption(auth,branchId,optionId,dto);}
  @Put("library/groups/:groupId/product-assignments")
  setGroupProducts(@Headers("authorization") auth:string|undefined,
    @Param("branchId",uuid) branchId:string,@Param("groupId",uuid) groupId:string,
    @Body() dto:SetGroupProductsDto){
    return this.lib.setGroupProducts(auth,branchId,groupId,dto.productIds,dto.revision);
  }
  @Put("products/:productId/group-assignments")
  attach(@Headers("authorization") auth: string | undefined,
    @Param("branchId",uuid) branchId: string,@Param("productId",uuid) productId:string,
    @Body() dto:SetGroupAssignmentsDto) {
    return this.lib.attach(auth,branchId,productId,dto.groupIds,dto.revision);
  }
}
