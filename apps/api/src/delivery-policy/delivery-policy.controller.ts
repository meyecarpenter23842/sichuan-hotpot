import {
  Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post,
} from "@nestjs/common";
import {
  IsBoolean, IsDefined, IsInt, Max, Min, ValidateIf,
} from "class-validator";
import { DeliveryPolicyService } from "./delivery-policy.service";

export class CreateDeliveryPolicyInput {
  @IsBoolean() acceptingOrders!: boolean;
  @IsInt() @Min(0) @Max(100000) baseMeters!: number;
  @IsInt() @Min(0) @Max(10000000) baseFeeVnd!: number;
  @IsInt() @Min(1) @Max(100000) extraStepMeters!: number;
  @IsInt() @Min(0) @Max(10000000) extraStepFeeVnd!: number;
  @IsInt() @Min(1) @Max(300000) maxRoadMeters!: number;
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
