import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsISO8601, IsIn, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { DiningService } from "./dining.service";

class DiningLineInput {
  @IsUUID("4") productId!: string;
  @IsOptional() @IsUUID("4") variantId?: string | null;
  @IsArray() @ArrayMaxSize(30) @IsUUID("4", { each: true }) modifierIds!: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsUUID("4", { each: true }) comboOptionIds?: string[];
  @IsInt() @Min(1) @Max(99) quantity!: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  // Dining uses the shared LEGACY price mode: unit * quantity is enforced by DB.
}
export class DiningTicketInput {
  @IsString() @Length(8, 128) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(500) customerNote?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => DiningLineInput)
  items!: DiningLineInput[];
}
export class DiningAreaCreateInput {
  @IsString() @Length(1, 120) name!: string;
  @IsInt() @Min(0) @Max(9999) sortOrder!: number;
}
export class DiningAreaUpdateInput {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class DiningTableCreateInput {
  @IsUUID("4") areaId!: string;
  @IsString() @Length(1, 40) code!: string;
  @IsString() @Length(1, 120) name!: string;
  @IsInt() @Min(0) @Max(9999) sortOrder!: number;
}
export class DiningTableUpdateInput {
  @IsOptional() @IsUUID("4") areaId?: string;
  @IsOptional() @IsString() @Length(1, 40) code?: string;
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class OpenSessionInput {
  @IsOptional() @IsInt() @Min(1) @Max(100) guestCount?: number;
}
export class DiningTicketEditInput {
  @IsISO8601() expectedUpdatedAt!: string;
  @IsOptional() @IsString() @MaxLength(500) customerNote?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => DiningLineInput)
  items!: DiningLineInput[];
}
class TransferSessionInput {
  @IsUUID("4") expectedTableId!: string;
  @IsUUID("4") targetTableId!: string;
}
class KitchenProgressInput {
  @IsIn(["APPROVED", "PREPARING", "READY"])
  expectedStatus!: "APPROVED" | "PREPARING" | "READY";
  @IsIn(["PREPARING", "READY", "SERVED"])
  nextStatus!: "PREPARING" | "READY" | "SERVED";
}
class RejectTicketInput {
  @IsString() @Length(3, 500) reason!: string;
}

@Controller("dining/branches/:branchId")
export class DiningStaffController {
  constructor(private readonly dining: DiningService) {}

  @Get("areas")
  @Header("Cache-Control", "no-store")
  areas(@Headers("authorization") auth: string | undefined, @Param("branchId", ParseUUIDPipe) branchId: string) {
    return this.dining.areas(auth, branchId);
  }
  @Get("tables")
  @Header("Cache-Control", "no-store")
  tables(@Headers("authorization") auth: string | undefined, @Param("branchId", ParseUUIDPipe) branchId: string) {
    return this.dining.tables(auth, branchId);
  }
  @Get("configuration")
  @Header("Cache-Control", "no-store")
  configuration(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string) {
    return this.dining.configuration(auth, branchId);
  }
  @Post("areas")
  @Header("Cache-Control", "no-store")
  createArea(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string, @Body() input: DiningAreaCreateInput) {
    return this.dining.createArea(auth, branchId, input);
  }
  @Patch("areas/:areaId")
  @Header("Cache-Control", "no-store")
  editArea(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Param("areaId", ParseUUIDPipe) areaId: string, @Body() input: DiningAreaUpdateInput) {
    return this.dining.editArea(auth, branchId, areaId, input);
  }
  @Post("tables")
  @Header("Cache-Control", "no-store")
  createTable(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string, @Body() input: DiningTableCreateInput) {
    return this.dining.createTable(auth, branchId, input);
  }
  @Patch("tables/:tableId")
  @Header("Cache-Control", "no-store")
  editTable(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Param("tableId", ParseUUIDPipe) tableId: string, @Body() input: DiningTableUpdateInput) {
    return this.dining.editTable(auth, branchId, tableId, input);
  }
  @Post("tables/:tableId/rotate-qr")
  @Header("Cache-Control", "no-store")
  rotateTableQr(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Param("tableId", ParseUUIDPipe) tableId: string) {
    return this.dining.rotateQr(auth, branchId, tableId);
  }
  @Post("tables/:tableId/sessions")
  @Header("Cache-Control", "no-store")
  open(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string, @Param("tableId", ParseUUIDPipe) tableId: string,
    @Body() input: OpenSessionInput) {
    return this.dining.open(auth, branchId, tableId, input.guestCount);
  }
  @Post("sessions/:sessionId/close")
  @Header("Cache-Control", "no-store")
  close(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string, @Param("sessionId", ParseUUIDPipe) sessionId: string) {
    return this.dining.close(auth, branchId, sessionId);
  }
  @Post("sessions/:sessionId/transfer")
  @Header("Cache-Control", "no-store")
  transfer(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() input: TransferSessionInput) {
    return this.dining.transfer(auth, branchId, sessionId, input.expectedTableId, input.targetTableId);
  }
  @Get("sessions/:sessionId")
  @Header("Cache-Control", "no-store")
  session(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string, @Param("sessionId", ParseUUIDPipe) sessionId: string) {
    return this.dining.staffBill(auth, branchId, sessionId);
  }
  @Post("sessions/:sessionId/tickets")
  @Header("Cache-Control", "no-store")
  addTicket(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string, @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() input: DiningTicketInput) {
    return this.dining.staffTicket(auth, branchId, sessionId, input);
  }
  @Put("tickets/:ticketId/items")
  @Header("Cache-Control", "no-store")
  editPending(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Body() input: DiningTicketEditInput) {
    return this.dining.editPending(auth, branchId, ticketId, input);
  }
  @Get("approvals")
  @Header("Cache-Control", "no-store")
  approvals(@Headers("authorization") auth: string | undefined, @Param("branchId", ParseUUIDPipe) branchId: string) {
    return this.dining.approvals(auth, branchId);
  }
  @Post("tickets/:ticketId/approve")
  @Header("Cache-Control", "no-store")
  approve(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string, @Param("ticketId", ParseUUIDPipe) ticketId: string) {
    return this.dining.review(auth, branchId, ticketId, "APPROVED");
  }
  @Post("tickets/:ticketId/reject")
  @Header("Cache-Control", "no-store")
  reject(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string, @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Body() input: RejectTicketInput) {
    return this.dining.review(auth, branchId, ticketId, "REJECTED", input.reason);
  }
  @Post("tickets/:ticketId/kitchen-status")
  @Header("Cache-Control", "no-store")
  kitchenStatus(@Headers("authorization") auth: string | undefined,
    @Param("branchId", ParseUUIDPipe) branchId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Body() input: KitchenProgressInput) {
    return this.dining.advanceKitchen(auth, branchId, ticketId, input.expectedStatus, input.nextStatus);
  }
  @Get("kitchen")
  @Header("Cache-Control", "no-store")
  kitchen(@Headers("authorization") auth: string | undefined, @Param("branchId", ParseUUIDPipe) branchId: string) {
    return this.dining.kitchen(auth, branchId);
  }
}

@UseGuards(ThrottlerGuard)
@Controller("dining")
export class DiningGuestController {
  constructor(private readonly dining: DiningService) {}

  @Get("qr/:qrHandle")
  @Header("Cache-Control", "no-store")
  locator(@Param("qrHandle") handle: string) {
    return this.dining.locator(handle);
  }
  @Post("qr/:qrHandle/grants")
  @Header("Cache-Control", "no-store")
  grant(@Param("qrHandle") handle: string) {
    return this.dining.issueGrant(handle);
  }
  @Post("guest/renew")
  @Header("Cache-Control", "no-store")
  renew(@Headers("authorization") credential: string | undefined) {
    return this.dining.renewGuestGrant(credential);
  }
  @Post("guest/tickets")
  @Header("Cache-Control", "no-store")
  ticket(@Headers("authorization") credential: string | undefined, @Body() input: DiningTicketInput) {
    return this.dining.guestTicket(credential, input);
  }
  @Get("guest/tickets")
  @Header("Cache-Control", "no-store")
  tickets(@Headers("authorization") credential: string | undefined) {
    return this.dining.guestTickets(credential);
  }
  @Get("guest/bill")
  @Header("Cache-Control", "no-store")
  bill(@Headers("authorization") credential: string | undefined) {
    return this.dining.guestBill(credential);
  }
}
