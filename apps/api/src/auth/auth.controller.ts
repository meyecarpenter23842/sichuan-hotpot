import {
  Body, Controller, Get, Headers, Param, Post, UseGuards,
} from "@nestjs/common";
import {
  IsString, Length, MaxLength, MinLength, IsEmail, Matches,
} from "class-validator";
import { ThrottlerGuard, Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";

class RequestRegistrationInput {
  @IsString() @Length(3, 32)
  username!: string;
  @IsEmail() @MaxLength(254)
  email!: string;
  @IsString() @MinLength(6) @MaxLength(8)
  password!: string;
}
class ConfirmCodeInput {
  @IsEmail() @MaxLength(254)
  email!: string;
  @IsString() @Matches(/^[0-9]{6}$/)
  code!: string;
}
class PasswordResetInput extends ConfirmCodeInput {
  @IsString() @MinLength(6) @MaxLength(8)
  password!: string;
}
class EmailOnlyInput {
  @IsEmail() @MaxLength(254)
  email!: string;
}
class LoginInput {
  @IsString() @Length(3, 64)
  username!: string;
  @IsString() @MaxLength(128)
  password!: string;
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

  @Post("register/request-code")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  requestRegistration(@Body() input: RequestRegistrationInput) {
    return this.auth.requestRegistration(input.username, input.email, input.password);
  }

  @Post("register/confirm-code")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  confirmRegistration(@Body() input: ConfirmCodeInput) {
    return this.auth.confirmRegistration(input.email, input.code);
  }

  @Post("password/request-code")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  requestPasswordReset(@Body() input: EmailOnlyInput) {
    return this.auth.requestPasswordReset(input.email);
  }

  @Post("password/reset")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  resetPassword(@Body() input: PasswordResetInput) {
    return this.auth.resetPassword(input.email, input.code, input.password);
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
