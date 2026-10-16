import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Body, Controller, Header, Headers, Post } from "@nestjs/common";
import { DeliveryQuoteService } from "./delivery-quote.service";

class QuoteCartLineInput {
  @IsUUID("4") productId!: string;
  @IsOptional() @IsUUID("4") variantId!: string | null;
  @IsArray() @ArrayMaxSize(30) @IsUUID("4", { each: true }) modifierIds!: string[];
  @IsInt() @Min(1) @Max(99) quantity!: number;
  @IsOptional() @IsIn(["SEPARATE"]) pricingMode?: "SEPARATE";
}
export class DeliveryQuoteInput {
  @IsUUID("4") branchId!: string;
  @IsUUID("4") addressId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => QuoteCartLineInput)
  items!: QuoteCartLineInput[];
}

@Controller("customer/delivery")
export class DeliveryQuoteController {
  constructor(private readonly quoteService: DeliveryQuoteService) {}

  @Post("quote")
  @Header("Cache-Control", "no-store")
  quote(@Headers("authorization") authorization: string | undefined, @Body() input: DeliveryQuoteInput) {
    return this.quoteService.calculate(authorization, {
      branchId: input.branchId,
      addressId: input.addressId,
      items: input.items.map(item => ({
        productId: item.productId, variantId: item.variantId ?? null,
        modifierIds: item.modifierIds, quantity: item.quantity,
        ...(item.pricingMode ? { pricingMode: item.pricingMode } : {}),
      })),
    });
  }
}
