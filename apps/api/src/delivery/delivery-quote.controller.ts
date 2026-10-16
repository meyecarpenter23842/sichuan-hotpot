import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Body, Controller, Header, Headers, Post } from "@nestjs/common";
import { DeliveryQuoteService } from "./delivery-quote.service";

class ModifierQuantityInput {
  @IsUUID("4") id!: string;
  @IsInt() @Min(2) @Max(20) quantity!: number;
}
class QuoteCartLineInput {
  @IsUUID("4") productId!: string;
  @IsOptional() @IsUUID("4") variantId!: string | null;
  @IsArray() @ArrayMaxSize(30) @IsUUID("4", { each: true }) modifierIds!: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30)
  @ValidateNested({each:true}) @Type(() => ModifierQuantityInput)
  modifierQuantities?: ModifierQuantityInput[];
  @IsInt() @Min(1) @Max(99) quantity!: number;
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
        modifierIds: item.modifierIds,
        modifierQuantities: item.modifierQuantities, quantity: item.quantity,
      })),
    });
  }
}
