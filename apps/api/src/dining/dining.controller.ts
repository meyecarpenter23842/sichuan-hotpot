import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested } from "class-validator";
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
