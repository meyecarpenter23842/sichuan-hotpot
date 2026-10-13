import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString,
  IsUUID, Max, Min, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import {
  Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post,
} from "@nestjs/common";
import { OrdersService } from "./orders.service";

class OrderCartItemInput {
  @IsUUID("4") productId!: string;
  @IsOptional() @IsUUID("4") variantId!: string | null;
  @IsArray() @ArrayMaxSize(30) @IsUUID("4", { each: true }) modifierIds!: string[];
  @IsInt() @Min(1) @Max(99) quantity!: number;
}
export class CheckoutInput {
  @IsUUID("4") branchId!: string;
  @IsUUID("4") addressId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => OrderCartItemInput)
  items!: OrderCartItemInput[];
  @IsUUID("4") idempotencyKey!: string;
  @IsString() @IsIn(["COD", "QR"]) paymentMethod!: "COD" | "QR";
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
      items: input.items.map(item => ({
        productId: item.productId, variantId: item.variantId ?? null,
        modifierIds: item.modifierIds, quantity: item.quantity,
      })),
    });
  }

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Headers("authorization") authorization: string | undefined) {
    return this.orders.list(authorization);
  }

  @Get(":orderId")
  @Header("Cache-Control", "no-store")
  detail(
    @Headers("authorization") authorization: string | undefined,
    @Param("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
  ) {
    return this.orders.detail(authorization, orderId);
  }
}
