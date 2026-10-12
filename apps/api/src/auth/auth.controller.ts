import {
  Body, Controller, Get, Headers, Param, Post, UseGuards,
} from "@nestjs/common";
import {
  IsString, Length, MaxLength, MinLength,
} from "class-validator";
import { ThrottlerGuard, Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";

class RegisterInput {
  @IsString() @Length(3, 32)
  username!: string;
  @IsString() @MinLength(12) @MaxLength(128)
  password!: string;
}
class LoginInput {
  @IsString() username!: string;
  @IsString() password!: string;
}
class GoogleInput {
  @IsString() @MinLength(40) @MaxLength(12000)
  idToken!: string;
}
class RefreshInput {
  @IsString() @MinLength(40) @MaxLength(255)
  refreshToken!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  register(@Body() input: RegisterInput) {
    return this.auth.register(input.username, input.password);
  }

  @Post("login")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  login(@Body() input: LoginInput) {
    return this.auth.login(input.username, input.password);
  }

  @Post("google")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  google(@Body() input: GoogleInput) {
    return this.auth.google(input.idToken);
  }

  @Post("refresh")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  refresh(@Body() input: RefreshInput) {
    return this.auth.refresh(input.refreshToken);
  }

  @Post("logout")
  logout(@Headers("authorization") authorization?: string) {
    return this.auth.logout(authorization);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.auth.principal(authorization);
  }

  @Get("admin/:branchId")
  admin(
    @Headers("authorization") authorization: string | undefined,
    @Param("branchId") branchId: string,
  ) {
    return this.auth.adminAccess(authorization, branchId);
  }
}
