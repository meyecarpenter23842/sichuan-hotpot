import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { GoogleTokenVerifier } from "./google-token.verifier";
import { VerificationMailSender } from "./verification-mail.sender";

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }])],
  providers: [AuthService, GoogleTokenVerifier, VerificationMailSender],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
