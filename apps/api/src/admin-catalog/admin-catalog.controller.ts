import {
  Body, Controller, Delete, Get, Header, Headers, Param, ParseUUIDPipe,
  Patch, Post, Put,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString,
  IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from "class-validator";
import { AdminCatalogService } from "./admin-catalog.service";
import { AdminBranchSetupService } from "./admin-branch-setup.service";

class CategoryInput {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsInt() @Min(-1000) @Max(1000) sortOrder!: number;
}
class CategoryPatch {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsInt() @Min(-1000) @Max(1000) sortOrder?: number;
}
class ProductInput {
  @IsUUID("4") categoryId!: string;
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsInt() @Min(0) @Max(100000000) priceVnd!: number;
  @IsBoolean() isAvailable!: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
}
class ProductPatch {
  @IsOptional() @IsUUID("4") categoryId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) priceVnd?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
}
class ProductOrderInput {
  @IsArray() @ArrayMaxSize(500) @IsUUID("4", { each: true })
  ids!: string[];
  @IsInt() @Min(0) revision!: number;
}
class BranchActivationInput {
  @IsBoolean() isActive!: boolean;
}
class VariantInput {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsInt() @Min(0) @Max(100000000) priceDeltaVnd!: number;
  @IsBoolean() isAvailable!: boolean;
}
class VariantPatch {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) priceDeltaVnd?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
}
class GroupInput {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsInt() @Min(0) @Max(30) minSelect!: number;
  @IsInt() @Min(1) @Max(30) maxSelect!: number;
  @IsInt() @Min(-1000) @Max(1000) sortOrder!: number;
}
class GroupPatch {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(30) minSelect?: number;
  @IsOptional() @IsInt() @Min(1) @Max(30) maxSelect?: number;
  @IsOptional() @IsInt() @Min(-1000) @Max(1000) sortOrder?: number;
}
class OptionInput {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsInt() @Min(0) @Max(100000000) priceDeltaVnd!: number;
  @IsBoolean() isAvailable!: boolean;
}
class OptionPatch {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) priceDeltaVnd?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
}
class DailyHours {
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) opensAt!: string;
  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) closesAt!: string;
  @IsBoolean() isClosed!: boolean;
}
class WeeklyHours {
  @IsArray() @ArrayMinSize(7) @ArrayMaxSize(7)
  @ValidateNested({ each: true }) @Type(() => DailyHours)
  days!: DailyHours[];
}
class BranchDetailsInput {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsString() @Matches(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/)
  code!: string;
  @IsString() @MinLength(10) @MaxLength(500) address!: string;
  @IsNumber({ maxDecimalPlaces: 7 }) @Min(-90) @Max(90) latitude!: number;
  @IsNumber({ maxDecimalPlaces: 7 }) @Min(-180) @Max(180) longitude!: number;
}
class BranchUpdateInput {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(500) address?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 7 }) @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 7 }) @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
const uuid = new ParseUUIDPipe({ version: "4" });

@Controller("admin")
export class AdminBranchesController {
  constructor(
    private readonly catalogue: AdminCatalogService,
    private readonly setup: AdminBranchSetupService,
  ) {}
  @Post("branches")
  @Header("Cache-Control", "no-store")
  create(@Headers("authorization") auth: string | undefined, @Body() input: BranchDetailsInput) {
    return this.setup.create(auth, input);
  }
  @Patch("branches/:branchId")
  @Header("Cache-Control", "no-store")
  update(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Body() input: BranchUpdateInput) {
    return this.setup.update(auth, branchId, input);
  }
  @Patch("branches/:branchId/activation")
  @Header("Cache-Control", "no-store")
  activate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Body() input: BranchActivationInput) {
    return this.setup.activate(auth, branchId, input.isActive);
  }
  @Get("branches")
  @Header("Cache-Control", "no-store")
  branches(@Headers("authorization") authorization?: string) {
    return this.catalogue.branches(authorization);
  }
}

@Controller("admin/branches/:branchId/catalog")
export class AdminCatalogController {
  constructor(private readonly catalogue: AdminCatalogService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Headers("authorization") auth: string | undefined,
       @Param("branchId", uuid) branchId: string) {
    return this.catalogue.catalogue(auth, branchId);
  }

  @Post("categories")
  categoryCreate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Body() input: CategoryInput) {
    return this.catalogue.createCategory(auth, branchId, input);
  }
  @Patch("categories/:id")
  categoryUpdate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("id", uuid) id: string,
    @Body() input: CategoryPatch) {
    return this.catalogue.updateCategory(auth, branchId, id, input);
  }
  @Delete("categories/:id")
  categoryDelete(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("id", uuid) id: string) {
    return this.catalogue.deleteCategory(auth, branchId, id);
  }

  @Put("products/order")
  reorder(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Body() input: ProductOrderInput) {
    return this.catalogue.reorderProducts(auth, branchId, input.ids, input.revision);
  }

  @Post("products")
  productCreate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Body() input: ProductInput) {
    return this.catalogue.createProduct(auth, branchId, input);
  }
  @Patch("products/:id")
  productUpdate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("id", uuid) id: string,
    @Body() input: ProductPatch) {
    return this.catalogue.updateProduct(auth, branchId, id, input);
  }
  @Delete("products/:id")
  productDelete(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("id", uuid) id: string) {
    return this.catalogue.deleteProduct(auth, branchId, id);
  }

  @Post("products/:productId/variants")
  variantCreate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("productId", uuid) productId: string,
    @Body() input: VariantInput) {
    return this.catalogue.createVariant(auth, branchId, productId, input);
  }
  @Patch("variants/:id")
  variantUpdate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("id", uuid) id: string,
    @Body() input: VariantPatch) {
    return this.catalogue.updateVariant(auth, branchId, id, input);
  }
  @Delete("variants/:id")
  variantDelete(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("id", uuid) id: string) {
    return this.catalogue.deleteVariant(auth, branchId, id);
  }

  @Post("products/:productId/groups")
  groupCreate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("productId", uuid) productId: string,
    @Body() input: GroupInput) {
    return this.catalogue.createGroup(auth, branchId, productId, input);
  }
  @Patch("groups/:id")
  groupUpdate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("id", uuid) id: string,
    @Body() input: GroupPatch) {
    return this.catalogue.updateGroup(auth, branchId, id, input);
  }
  @Delete("groups/:id")
  groupDelete(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("id", uuid) id: string) {
    return this.catalogue.deleteGroup(auth, branchId, id);
  }

  @Post("groups/:groupId/options")
  optionCreate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("groupId", uuid) groupId: string,
    @Body() input: OptionInput) {
    return this.catalogue.createOption(auth, branchId, groupId, input);
  }
  @Patch("options/:id")
  optionUpdate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("id", uuid) id: string,
    @Body() input: OptionPatch) {
    return this.catalogue.updateOption(auth, branchId, id, input);
  }
  @Delete("options/:id")
  optionDelete(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Param("id", uuid) id: string) {
    return this.catalogue.deleteOption(auth, branchId, id);
  }

  @Put("opening-hours")
  hoursUpdate(@Headers("authorization") auth: string | undefined,
    @Param("branchId", uuid) branchId: string, @Body() input: WeeklyHours) {
    return this.catalogue.openingHours(auth, branchId, input.days);
  }
}
