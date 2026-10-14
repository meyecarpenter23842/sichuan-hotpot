import {
  Body, Controller, ForbiddenException, UnauthorizedException, Get, Headers, Param, Post, Res, UseGuards,
} from "@nestjs/common";
import {
  IsString, Length, MaxLength, MinLength, IsEmail, Matches,
} from "class-validator";
import { ThrottlerGuard, Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { allowedCorsOrigins } from "../bootstrap";
import type { Response } from "express";

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
  // Customer passwords remain 6-8; OWNER resets accept strong, longer passwords.
  // The AuthService checks the account role before applying its password policy.
  @IsString() @MinLength(6) @MaxLength(128)
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
class BrowserSessionStartInput {
  @IsString() @MinLength(40) @MaxLength(255)
  refreshToken!: string;
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
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  requestRegistration(@Body() input: RequestRegistrationInput) {
    return this.auth.requestRegistration(input.username, input.email, input.password);
  }

  @Post("register/confirm-code")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  confirmRegistration(@Body() input: ConfirmCodeInput) {
    return this.auth.confirmRegistration(input.email, input.code);
  }

  @Post("password/request-code")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  requestPasswordReset(@Body() input: EmailOnlyInput) {
    return this.auth.requestPasswordReset(input.email);
  }

  @Post("password/reset")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
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

  private assertBrowserOrigin(origin?: string): void {
    if (!origin || !allowedCorsOrigins().has(origin)) {
      throw new ForbiddenException("Untrusted web session origin");
    }
  }

  private readonly browserCookieName = process.env.NODE_ENV === "test"
    ? "hotpot-browser-ci" : "__Host-hotpot-browser";
  private setBrowserCookie(response: Response, token: string | null): void {
    const secure = process.env.NODE_ENV === "test" ? "" : "; Secure";
    response.setHeader("Set-Cookie",
      this.browserCookieName + "=" + (token || "") +
      "; HttpOnly; SameSite=Strict; Path=/" + secure +
      "; Max-Age=" + (token ? 14 * 24 * 60 * 60 : 0));
  }
  private readBrowserCookie(header?: string): string | null {
    const cookie = header?.split(";").map(entry => entry.trim()).find(entry =>
      entry.startsWith(this.browserCookieName + "="));
    const value = cookie?.slice(this.browserCookieName.length + 1) ?? "";
    return /^[a-zA-Z0-9_-]{40,255}$/.test(value) ? value : null;
  }

  @Post("browser/start")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  startBrowser(
    @Headers("origin") origin: string | undefined,
    @Body() input: BrowserSessionStartInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertBrowserOrigin(origin);
    // Only the browser receives the HTTP-only cookie; response has no refresh token.
    this.setBrowserCookie(response, input.refreshToken);
    return { status: "ok" as const };
  }

  @Post("browser/refresh")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  async refreshBrowser(
    @Headers("origin") origin: string | undefined,
    @Headers("cookie") cookie: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertBrowserOrigin(origin);
    const refreshToken = this.readBrowserCookie(cookie);
    if (!refreshToken) throw new UnauthorizedException();
    try {
      const tokens = await this.auth.refresh(refreshToken);
      this.setBrowserCookie(response, tokens.refreshToken);
      return { accessToken: tokens.accessToken,
        accessTokenExpiresInSeconds: tokens.accessTokenExpiresInSeconds };
    } catch (error) {
      this.setBrowserCookie(response, null);
      throw error;
    }
  }

  @Post("browser/logout")
  async logoutBrowser(
    @Headers("origin") origin: string | undefined,
    @Headers("cookie") cookie: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertBrowserOrigin(origin);
    const refreshToken = this.readBrowserCookie(cookie);
    if (refreshToken) await this.auth.revokeRefresh(refreshToken);
    this.setBrowserCookie(response, null);
    return { status: "ok" as const };
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
