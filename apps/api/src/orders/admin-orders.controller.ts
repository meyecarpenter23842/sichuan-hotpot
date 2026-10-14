import {
  Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Patch, Query,
  BadRequestException,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import type { OrderStatus } from "@prisma/client";
import { AdminOrdersService } from "./admin-orders.service";

const statuses = [
  "PENDING", "CONFIRMED", "PREPARING", "READY",
  "DELIVERING", "DELIVERED", "CANCELED", "DELIVERY_FAILED",
] as const;

class OrderActionInput {
  @IsIn(statuses)
  expectedStatus!: OrderStatus;
  @IsIn(["CONFIRMED", "CANCELED", "PREPARING", "READY"])
  toStatus!: "CONFIRMED" | "CANCELED" | "PREPARING" | "READY";
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

@Controller("admin/orders")
@Header("Cache-Control", "no-store")
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get("branches")
  branches(@Headers("authorization") auth: string | undefined) {
    return this.orders.branches(auth);
  }

  @Get(":branchId")
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

  @Get(":branchId/:orderId")
  detail(
    @Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Param("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
  ) {
    return this.orders.detail(auth, branchId, orderId);
  }

  @Patch(":branchId/:orderId/status")
  transition(
    @Headers("authorization") auth: string | undefined,
    @Param("branchId", new ParseUUIDPipe({ version: "4" })) branchId: string,
    @Param("orderId", new ParseUUIDPipe({ version: "4" })) orderId: string,
    @Body() input: OrderActionInput,
  ) {
    return this.orders.transition(auth, branchId, orderId, input);
  }
}
