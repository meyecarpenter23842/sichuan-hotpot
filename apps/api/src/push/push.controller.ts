import {
  Body, Controller, Get, Header, Headers, IsIn, IsOptional, IsString,
  IsUUID, MaxLength, MinLength, Post,
} from "@nestjs/common";
import type { PushScope, PushTransport } from "@prisma/client";
import { PushService } from "./push.service";

class RegisterPushInput {
  @IsIn(["CUSTOMER", "STAFF"])
  scope!: PushScope;

  @IsIn(["WEB_PUSH", "FCM"])
  transport!: PushTransport;

  @IsString() @MinLength(16) @MaxLength(4096)
  token!: string;

  @IsOptional() @IsUUID("4")
  branchId?: string;

  @IsOptional() @IsString() @MaxLength(256)
  p256dh?: string;

  @IsOptional() @IsString() @MaxLength(128)
  auth?: string;
}

class RemovePushInput {
  @IsString() @MinLength(16) @MaxLength(4096)
  token!: string;
}

@Controller("push")
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get("config")
  @Header("Cache-Control", "public, max-age=300")
  config() {
    return this.push.publicConfig();
  }

  @Post("subscriptions")
  @Header("Cache-Control", "no-store")
  register(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: RegisterPushInput,
  ) {
    return this.push.register(authorization, {
      scope: input.scope, transport: input.transport, token: input.token,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.p256dh ? { p256dh: input.p256dh } : {}),
      ...(input.auth ? { auth: input.auth } : {}),
    });
  }

  @Post("subscriptions/remove")
  @Header("Cache-Control", "no-store")
  remove(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: RemovePushInput,
  ) {
    return this.push.remove(authorization, input.token);
  }
}
