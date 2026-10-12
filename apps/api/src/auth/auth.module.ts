import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { GoogleTokenVerifier } from "./google-token.verifier";

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }])],
  providers: [AuthService, GoogleTokenVerifier],
  controllers: [AuthController],
})
export class AuthModule {}
