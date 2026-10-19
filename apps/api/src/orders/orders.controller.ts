import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString,
  IsUUID, Max, MaxLength, Min, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import {
  BadRequestException, Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Query,
} from "@nestjs/common";
import { OrdersService } from "./orders.service";

class OrderCartItemInput {
  @IsUUID("4") productId!: string;
  @IsOptional() @IsUUID("4") variantId!: string | null;
  @IsArray() @ArrayMaxSize(30) @IsUUID("4", { each: true }) modifierIds!: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID("4", { each: true }) comboOptionIds?: string[];
  @IsInt() @Min(1) @Max(99) quantity!: number;
  @IsOptional() @IsIn(["SEPARATE"]) pricingMode?: "SEPARATE";
}
export class CheckoutInput {
  @IsUUID("4") branchId!: string;
  @IsUUID("4") addressId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => OrderCartItemInput)
  items!: OrderCartItemInput[];
  @IsUUID("4") idempotencyKey!: string;
  @IsString() @IsIn(["COD", "QR"]) paymentMethod!: "COD" | "QR";
  @IsOptional() @IsString() @MaxLength(500) customerNote?: string | null;
}

@Controller("customer/orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Header("Cache-Control", "no-store")
  create(@Headers("authorization") authorization: string | undefined, @Body() input: CheckoutInput) {
    return this.orders.checkout(authorization, {
      branchId: input.branchId, addressId: input.addressId,
      idempotencyKey: input.idempotencyKey, paymentMethod: input.paymentMethod,
      customerNote: input.customerNote ?? null,
      items: input.items.map(item => ({
        productId: item.productId, variantId: item.variantId ?? null,
        modifierIds: item.modifierIds, comboOptionIds: item.comboOptionIds ?? [],
        quantity: item.quantity,
        ...(item.pricingMode ? { pricingMode: item.pricingMode } : {}),
      })),
    });
  }

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Headers("authorization") authorization: string | undefined) {
    return this.orders.list(authorization);
  }

  @Get("pages")
  @Header("Cache-Control", "no-store")
  page(
    @Headers("authorization") authorization: string | undefined,
    @Query("cursor") cursor?: string, @Query("limit") rawLimit?: string,
    @Query("delivered") delivered?: string,
  ) {
    if (cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor))
      throw new BadRequestException("INVALID_ORDER_PAGE_CURSOR");
    if (delivered && delivered !== "1")
      throw new BadRequestException("INVALID_ORDER_PAGE_FILTER");
    if (rawLimit && !/^[1-9]\d?$/.test(rawLimit))
      throw new BadRequestException("INVALID_ORDER_PAGE_LIMIT");
    const limit = rawLimit ? Number(rawLimit) : 20;
    if (limit > 50) throw new BadRequestException("INVALID_ORDER_PAGE_LIMIT");
    return this.orders.listPage(authorization, cursor, delivered === "1", limit);
  }

  @Get("payment-methods")
  @Header("Cache-Control", "no-store")
  paymentMethods() { return this.orders.paymentMethods(); }

  @Get(":orderId")
  @Header("Cache-Control", "no-store")
  detail(
    @Headers("authorization") authorization: string | undefined,
    @Param("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
  ) {
    return this.orders.detail(authorization, orderId);
  }
}
