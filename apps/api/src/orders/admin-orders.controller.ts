import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional,
  IsString, IsUUID, Length, Max, Min, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import {
  BadRequestException, Body, Controller, Get, Header, Headers, Param,
  ParseUUIDPipe, Patch, Put, Query,
} from "@nestjs/common";
import type { OrderStatus } from "@prisma/client";
import { AdminOrdersService } from "./admin-orders.service";

const statuses = [
  "PENDING", "CONFIRMED", "PREPARING", "READY",
  "DELIVERING", "DELIVERED", "CANCELED", "DELIVERY_FAILED",
] as const;
const actionTargets = [
  "CONFIRMED", "CANCELED", "PREPARING", "READY",
  "DELIVERING", "DELIVERED", "DELIVERY_FAILED",
] as const;

class OrderActionInput {
  @IsIn(statuses)
  expectedStatus!: OrderStatus;

  @IsIn(actionTargets)
  toStatus!: (typeof actionTargets)[number];

  @IsOptional() @IsString() @Length(5, 500)
  reason?: string;
}

class AssignDriverInput {
  @IsUUID("4")
  driverId!: string;
}

class OrderEditLineInput {
  @IsUUID("4")
  productId!: string;

  @IsOptional() @IsUUID("4")
  variantId!: string | null;

  @IsArray() @ArrayMaxSize(30) @IsUUID("4", { each: true })
  modifierIds!: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID("4", { each: true })
  comboOptionIds?: string[];

  @IsInt() @Min(1) @Max(99)
  quantity!: number;

  @IsOptional() @IsIn(["SEPARATE"])
  pricingMode?: "SEPARATE";
}

class OrderEditInput {
  @IsIn(["PENDING", "CONFIRMED"])
  expectedStatus!: "PENDING" | "CONFIRMED";

  @IsISO8601()
  expectedUpdatedAt!: string;

  @IsString() @Length(5, 500)
  reason!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => OrderEditLineInput)
  items!: OrderEditLineInput[];
}

@Controller("admin/orders")
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get("branches")
  @Header("Cache-Control", "no-store")
  branches(@Headers("authorization") auth: string | undefined) {
    return this.orders.branches(auth);
  }

  @Get(":branchId")
  @Header("Cache-Control", "no-store")
  list(
    @Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Query("status") status?: string,
  ) {
    if (status && !statuses.includes(status as OrderStatus)) {
      throw new BadRequestException("INVALID_ORDER_FILTER");
    }
    return this.orders.list(auth, branchId, status as OrderStatus | undefined);
  }

  @Get(":branchId/pages")
  @Header("Cache-Control", "no-store")
  page(
    @Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Query("group") group?: string, @Query("cursor") cursor?: string,
    @Query("limit") rawLimit?: string,
  ) {
    const allowed = ["new", "confirmed", "preparing", "ready",
      "delivering", "history", "kitchen", "delivery"] as const;
    if (!group || !allowed.includes(group as (typeof allowed)[number]))
      throw new BadRequestException("INVALID_ORDER_LANE");
    if (cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor))
      throw new BadRequestException("INVALID_ORDER_PAGE_CURSOR");
    if (rawLimit && !/^[1-9][0-9]?$/.test(rawLimit))
      throw new BadRequestException("INVALID_ORDER_PAGE_LIMIT");
    const limit = rawLimit ? Number(rawLimit) : 25;
    if (limit > 50) throw new BadRequestException("INVALID_ORDER_PAGE_LIMIT");
    return this.orders.listPage(auth, branchId, group as (typeof allowed)[number], cursor, limit);
  }

  @Get(":branchId/drivers")
  @Header("Cache-Control", "no-store")
  drivers(
    @Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
  ) {
    return this.orders.drivers(auth, branchId);
  }

  @Get(":branchId/:orderId")
  @Header("Cache-Control", "no-store")
  detail(
    @Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Param("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
  ) {
    return this.orders.detail(auth, branchId, orderId);
  }

  @Patch(":branchId/:orderId/status")
  @Header("Cache-Control", "no-store")
  transition(
    @Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Param("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
    @Body() input: OrderActionInput,
  ) {
    return this.orders.transition(auth, branchId, orderId, input);
  }

  @Put(":branchId/:orderId/driver")
  @Header("Cache-Control", "no-store")
  assignDriver(
    @Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Param("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
    @Body() input: AssignDriverInput,
  ) {
    return this.orders.assignDriver(auth, branchId, orderId, input.driverId);
  }

  @Put(":branchId/:orderId/items")
  @Header("Cache-Control", "no-store")
  editItems(
    @Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Param("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
    @Body() input: OrderEditInput,
  ) {
    return this.orders.editItems(auth, branchId, orderId, {
      ...input,
      items: input.items.map(item => ({
        productId: item.productId, variantId: item.variantId ?? null,
        modifierIds: item.modifierIds, comboOptionIds: item.comboOptionIds ?? [],
        quantity: item.quantity,
        ...(item.pricingMode ? { pricingMode: item.pricingMode } : {}),
      })),
    });
  }
}
