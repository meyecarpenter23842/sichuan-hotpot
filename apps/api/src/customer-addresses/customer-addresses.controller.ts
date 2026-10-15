import {
  BadRequestException, Body, Controller, Delete, ForbiddenException,
  Get, Headers, NotFoundException, Param, ParseUUIDPipe, Patch, Post,
} from "@nestjs/common";
import { IsOptional, IsString, Length, Matches } from "class-validator";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";

export class CreateAddressInput {
  @IsString() @Length(1, 100)
  label!: string;
  @IsString() @Length(8, 500)
  line1!: string;
  @IsString() @Matches(/^(?:\+84|0)[35789][0-9]{8}$/)
  phone!: string;
  @IsString() @Matches(/^-?[0-9]{1,3}(?:\.[0-9]{1,7})?$/)
  latitude!: string;
  @IsString() @Matches(/^-?[0-9]{1,3}(?:\.[0-9]{1,7})?$/)
  longitude!: string;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9_-]{2,40}$/)
  catalogVersion?: string | null;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9_-]{1,24}$/)
  provinceCode?: string | null;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9_-]{1,24}$/)
  wardCode?: string | null;
}

@Controller("customer/addresses")
export class CustomerAddressesController {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}

  private async customerId(authorization?: string): Promise<string> {
    const user = await this.auth.principal(authorization);
    if (user.role !== "CUSTOMER") throw new ForbiddenException("Customer account required");
    return user.id;
  }

  @Get()
  async list(@Headers("authorization") authorization?: string) {
    const userId = await this.customerId(authorization);
    const [user, addresses] = await Promise.all([
      this.prisma.database.user.findUniqueOrThrow({
        where: { id: userId }, select: { phoneE164: true },
      }),
      this.prisma.database.address.findMany({
        where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, label: true, line1: true, latitude: true, longitude: true,
          catalogVersion: true, provinceCode: true, wardCode: true },
      }),
    ]);
    return { phone: user.phoneE164, addresses: addresses.map(a => ({
      ...a, latitude: a.latitude.toString(), longitude: a.longitude.toString(),
    })) };
  }

  @Post()
  async create(@Headers("authorization") authorization: string | undefined, @Body() input: CreateAddressInput) {
    const userId = await this.customerId(authorization);
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
        || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new BadRequestException("Invalid delivery coordinates");
    }
    const phone = input.phone.startsWith("0") ? "+84" + input.phone.slice(1) : input.phone;
    if ([input.catalogVersion, input.provinceCode, input.wardCode].some(Boolean)
      && ![input.catalogVersion, input.provinceCode, input.wardCode].every(Boolean)) {
      throw new BadRequestException("ADDRESS_REGION_INCOMPLETE");
    }
    // Atomic profile phone + address save; only verified JWT owner can create.
    return this.prisma.database.$transaction(async tx => {
      const count = await tx.address.count({ where: { userId } });
      if (count >= 10) throw new BadRequestException("Maximum ten saved addresses");
      const row = await tx.address.create({
        data: { userId, label: input.label.trim(), line1: input.line1.trim(),
          latitude: input.latitude, longitude: input.longitude,
          catalogVersion: input.catalogVersion ?? null,
          provinceCode: input.provinceCode ?? null, wardCode: input.wardCode ?? null },
        select: { id: true, label: true, line1: true, latitude: true, longitude: true,
          catalogVersion: true, provinceCode: true, wardCode: true },
      });
      await tx.user.update({ where: { id: userId }, data: { phoneE164: phone } });
      return { id: row.id, label: row.label, line1: row.line1,
        latitude: row.latitude.toString(), longitude: row.longitude.toString(),
        catalogVersion: row.catalogVersion, provinceCode: row.provinceCode, wardCode: row.wardCode };
    });
  }


  @Patch(":addressId")
  async update(@Headers("authorization") authorization: string | undefined,
               @Param("addressId", new ParseUUIDPipe({ version: "4" })) addressId: string,
               @Body() input: CreateAddressInput) {
    const userId = await this.customerId(authorization);
    const latitude = Number(input.latitude), longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
        || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new BadRequestException("Invalid delivery coordinates");
    }
    const label = input.label.trim(), line1 = input.line1.trim();
    if (!label || line1.length < 8) throw new BadRequestException("Invalid address label or street");
    const phone = input.phone.startsWith("0") ? "+84" + input.phone.slice(1) : input.phone;
    if ([input.catalogVersion, input.provinceCode, input.wardCode].some(Boolean)
      && ![input.catalogVersion, input.provinceCode, input.wardCode].every(Boolean)) {
      throw new BadRequestException("ADDRESS_REGION_INCOMPLETE");
    }
    // Update only this customer's existing record. Never create a duplicate during edit.
    return this.prisma.database.$transaction(async tx => {
      const changed = await tx.address.updateMany({
        where: { id: addressId, userId },
        data: { label, line1, latitude: input.latitude, longitude: input.longitude,
          catalogVersion: input.catalogVersion ?? null,
          provinceCode: input.provinceCode ?? null, wardCode: input.wardCode ?? null },
      });
      if (changed.count !== 1) throw new NotFoundException("Address not found");
      await tx.user.update({ where: { id: userId }, data: { phoneE164: phone } });
      const row = await tx.address.findFirstOrThrow({
        where: { id: addressId, userId },
        select: { id: true, label: true, line1: true, latitude: true, longitude: true,
          catalogVersion: true, provinceCode: true, wardCode: true },
      });
      return { ...row, latitude: row.latitude.toString(), longitude: row.longitude.toString() };
    });
  }

  @Delete(":addressId")
  async remove(@Headers("authorization") authorization: string | undefined,
               @Param("addressId", new ParseUUIDPipe({ version: "4" })) addressId: string) {
    const userId = await this.customerId(authorization);
    const result = await this.prisma.database.address.deleteMany({ where: { id: addressId, userId } });
    if (result.count !== 1) throw new NotFoundException("Address not found");
    return { status: "ok" };
  }
}
