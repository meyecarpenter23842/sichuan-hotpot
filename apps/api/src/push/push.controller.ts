import { Body, Controller, Get, Header, Headers, Post } from "@nestjs/common";
import {
  IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from "class-validator";
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

class TestPushInput {
  @IsString() @MinLength(16) @MaxLength(4096)
  token!: string;

  @IsOptional() @IsInt() @Min(0) @Max(20)
  delaySeconds?: number;
}

class TestReceiptInput extends TestPushInput {
  @IsUUID("4")
  testId!: string;
}

class TestStatusInput {
  @IsUUID("4")
  testId!: string;
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

  @Post("test")
  @Header("Cache-Control", "no-store")
  test(@Headers("authorization") authorization: string | undefined,
    @Body() input: TestPushInput) {
    return this.push.sendTest(authorization, input.token, input.delaySeconds ?? 0);
  }

  @Post("test/receipt")
  @Header("Cache-Control", "no-store")
  receipt(@Headers("authorization") authorization: string | undefined,
    @Body() input: TestReceiptInput) {
    return this.push.acknowledgeTest(authorization, input.testId, input.token);
  }

  @Post("test/status")
  @Header("Cache-Control", "no-store")
  testStatus(@Headers("authorization") authorization: string | undefined,
    @Body() input: TestStatusInput) {
    return this.push.testStatus(authorization, input.testId);
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
