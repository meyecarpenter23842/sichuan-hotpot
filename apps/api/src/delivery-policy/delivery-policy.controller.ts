import {
  Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post,
} from "@nestjs/common";
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsOptional,
  IsString, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { DeliveryPolicyService } from "./delivery-policy.service";

class DeliveryZoneDto {
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(24) provinceCode!: string;
  @IsString() @MaxLength(40) catalogVersion!: string;
  @IsArray() @ArrayMaxSize(300) @IsString({ each: true }) wardCodes!: string[];
  @IsInt() @Min(0) @Max(10000000) feeVnd!: number;
  @IsBoolean() isActive!: boolean;
}


export class CreateDeliveryPolicyInput {
  @IsOptional() @IsIn(["DISTANCE", "ZONE"]) pricingMode?: "DISTANCE" | "ZONE";
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => DeliveryZoneDto)
  zones?: DeliveryZoneDto[];
  @IsBoolean() acceptingOrders!: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100000) baseMeters!: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000000) baseFeeVnd!: number;
  @IsOptional() @IsInt() @Min(1) @Max(100000) extraStepMeters!: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000000) extraStepFeeVnd!: number;
  @IsOptional() @IsInt() @Min(1) @Max(300000) maxRoadMeters!: number;
  @IsInt() @Min(0) @Max(1000000000) minSubtotalVnd!: number;
  @IsDefined()
  @ValidateIf((_input: CreateDeliveryPolicyInput, value: unknown) => value !== null)
  @IsInt() @Min(0) @Max(1000000000)
  freeDeliveryAtSubtotalVnd!: number | null;
}

@Controller("admin/branches/:branchId/delivery-policy")
export class DeliveryPolicyController {
  constructor(private readonly policies: DeliveryPolicyService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  current(
    @Headers("authorization") authorization: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
  ) {
    return this.policies.current(authorization, branchId);
  }

  @Post()
  @Header("Cache-Control", "no-store")
  create(
    @Headers("authorization") authorization: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Body() input: CreateDeliveryPolicyInput,
  ) {
    return this.policies.create(authorization, branchId, input);
  }
}
