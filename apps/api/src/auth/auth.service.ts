import {
  Injectable, BadRequestException, ConflictException,
  ForbiddenException, ServiceUnavailableException, UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { PrismaService } from "../database/prisma.service";
import { GoogleTokenVerifier } from "./google-token.verifier";
import { VerificationMailSender } from "./verification-mail.sender";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
}
const ISSUER = "sichuan-hotpot";
const AUDIENCE = "sichuan-hotpot-api";
const REFRESH_MS = 14 * 24 * 60 * 60 * 1000;
const DUMMY_PASSWORD = "constant-no-existing-account-password-1234";
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
function emailOf(input: string): string {
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    throw new BadRequestException("Email không hợp lệ.");
  }
  return email;
}
function newPasswordOk(password: string): void {
  // No required special characters, digits, uppercase, or lowercase classes.
  if (password.length < 6 || password.length > 8) {
    throw new BadRequestException("Mật khẩu phải có 6–8 ký tự.");
  }
}

function usernameOf(input: string): string {
  const name = input.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(name)) {
    throw new BadRequestException("Invalid username");
  }
  return name;
}

function hashRefresh(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

@Injectable()
export class AuthService {
  private dummyHashPromise?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleTokens: GoogleTokenVerifier,
    private readonly emailSender: VerificationMailSender,
  ) {}

  private get jwtSecret(): string {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
      throw new ServiceUnavailableException("Sign-in unavailable");
    }
    return secret;
  }

  private readonly hashOptions = {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  } as const;

  private async createSession(userId: string): Promise<AuthTokens> {
    const secret = this.jwtSecret;
    const refreshToken = randomBytes(48).toString("base64url");
    const session = await this.prisma.database.authSession.create({
      data: {
        userId, refreshTokenHash: hashRefresh(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_MS),
      },
    });
    const accessToken = jwt.sign({ sid: session.id }, secret, {
      algorithm: "HS256", issuer: ISSUER, audience: AUDIENCE,
      subject: userId, expiresIn: "15m",
    });
    return { accessToken, refreshToken, accessTokenExpiresInSeconds: 900 };
  }

  private codeDigest(email: string, purpose: "REGISTER" | "RESET_PASSWORD", code: string): string {
    return createHmac("sha256", this.jwtSecret).update(purpose + ":" + email + ":" + code).digest("hex");
  }

  private async verifyCode(email: string, purpose: "REGISTER" | "RESET_PASSWORD", code: string) {
    const record = await this.prisma.database.emailChallenge.findUnique({
      where: { email_purpose: { email, purpose } },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()
        || record.attempts >= MAX_CODE_ATTEMPTS) {
      throw new BadRequestException("Mã không đúng hoặc đã hết hạn.");
    }
    const candidate = Buffer.from(this.codeDigest(email, purpose, code), "hex");
    const expected = Buffer.from(record.codeHash, "hex");
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      await this.prisma.database.emailChallenge.updateMany({
        where: { id: record.id, usedAt: null, attempts: { lt: MAX_CODE_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException("Mã không đúng hoặc đã hết hạn.");
    }
    return record;
  }

  private async issueCode(email: string, purpose: "REGISTER" | "RESET_PASSWORD",
                          normalizedUsername?: string, pendingPasswordHash?: string) {
    this.jwtSecret;
    const now = new Date();
    const old = await this.prisma.database.emailChallenge.findUnique({
      where: { email_purpose: { email, purpose } }, select: { createdAt: true },
    });
    if (old && now.getTime() - old.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new BadRequestException("Đợi 60 giây trước khi gửi lại mã.");
    }
    const code = randomInt(0, 1000000).toString().padStart(6, "0");
    const codeHash = this.codeDigest(email, purpose, code);
    await this.prisma.database.emailChallenge.upsert({
      where: { email_purpose: { email, purpose } },
      update: { codeHash, normalizedUsername, pendingPasswordHash,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS), createdAt: now,
        usedAt: null, attempts: 0 },
      create: { email, purpose, codeHash, normalizedUsername, pendingPasswordHash,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS) },
    });
    try {
      await this.emailSender.sendCode(email, code, purpose);
    } catch (error) {
      await this.prisma.database.emailChallenge.updateMany({
        where: { email, purpose, codeHash }, data: { usedAt: new Date(), pendingPasswordHash: null },
      });
      throw error;
    }
    return { status: "sent" as const, expiresInSeconds: 600 };
  }

  async requestRegistration(username: string, emailInput: string, password: string) {
    const normalizedUsername = usernameOf(username);
    const email = emailOf(emailInput);
    newPasswordOk(password);
    this.jwtSecret;
    const occupied = await this.prisma.database.localCredential.findFirst({
      where: { OR: [{ normalizedUsername }, { verifiedEmail: email }] }, select: { id: true },
    });
    if (occupied) throw new ConflictException("Tên đăng nhập hoặc email đã được sử dụng.");
    const pendingPasswordHash = await hash(password, this.hashOptions);
    return this.issueCode(email, "REGISTER", normalizedUsername, pendingPasswordHash);
  }

  async confirmRegistration(emailInput: string, code: string): Promise<AuthTokens> {
    const email = emailOf(emailInput);
    const record = await this.verifyCode(email, "REGISTER", code);
    if (!record.normalizedUsername || !record.pendingPasswordHash) {
      throw new BadRequestException("Đăng ký không hợp lệ.");
    }
    try {
      const userId = await this.prisma.database.$transaction(async tx => {
        const accepted = await tx.emailChallenge.updateMany({
          where: { id: record.id, usedAt: null, attempts: { lt: MAX_CODE_ATTEMPTS },
            expiresAt: { gt: new Date() } },
          data: { usedAt: new Date(), pendingPasswordHash: null },
        });
        if (accepted.count !== 1) throw new BadRequestException("Mã đã sử dụng.");
        const credential = await tx.localCredential.create({
          data: { normalizedUsername: record.normalizedUsername!,
            verifiedEmail: email, passwordHash: record.pendingPasswordHash!,
            user: { create: { role: "CUSTOMER" } } },
          select: { userId: true },
        });
        return credential.userId;
      });
      return this.createSession(userId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Tên đăng nhập hoặc email đã được sử dụng.");
      }
      throw error;
    }
  }

  async requestPasswordReset(emailInput: string) {
    const email = emailOf(emailInput);
    this.jwtSecret;
    const credential = await this.prisma.database.localCredential.findUnique({
      where: { verifiedEmail: email }, select: { userId: true },
    });
    if (credential) await this.issueCode(email, "RESET_PASSWORD");
    // Generic to avoid account enumeration.
    return { status: "sent" as const, expiresInSeconds: 600 };
  }

  async resetPassword(emailInput: string, code: string, password: string) {
    const email = emailOf(emailInput);
    newPasswordOk(password);
    const record = await this.verifyCode(email, "RESET_PASSWORD", code);
    const passwordHash = await hash(password, this.hashOptions);
    await this.prisma.database.$transaction(async tx => {
      const accepted = await tx.emailChallenge.updateMany({
        where: { id: record.id, usedAt: null, attempts: { lt: MAX_CODE_ATTEMPTS },
          expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (accepted.count !== 1) throw new BadRequestException("Mã đã sử dụng.");
      const credential = await tx.localCredential.findUnique({
        where: { verifiedEmail: email }, select: { userId: true },
      });
      if (!credential) throw new BadRequestException("Mã không hợp lệ.");
      await tx.localCredential.update({
        where: { verifiedEmail: email }, data: { passwordHash },
      });
      await tx.authSession.updateMany({
        where: { userId: credential.userId, revokedAt: null }, data: { revokedAt: new Date() },
      });
    });
    return { status: "ok" as const };
  }

  async login(username: string, password: string): Promise<AuthTokens> {
    const normalizedUsername = usernameOf(username);
    this.jwtSecret;
    const credential = await this.prisma.database.localCredential.findUnique({
      where: { normalizedUsername },
      select: { passwordHash: true, userId: true },
    });
    this.dummyHashPromise ??= hash(DUMMY_PASSWORD, this.hashOptions);
    const ok = await verify(credential?.passwordHash ?? await this.dummyHashPromise, password)
      .catch(() => false);
    if (!credential || !ok) throw new UnauthorizedException("Invalid credentials");
    return this.createSession(credential.userId);
  }

  async google(idToken: string): Promise<AuthTokens> {
    this.jwtSecret;
    const providerSubject = await this.googleTokens.verify(idToken);
    // The unique (provider, providerSubject) key handles concurrent first logins.
    const identity = await this.prisma.database.authIdentity.upsert({
      where: { provider_providerSubject: { provider: "GOOGLE", providerSubject } },
      update: {},
      create: {
        provider: "GOOGLE", providerSubject,
        user: { create: { role: "CUSTOMER" } },
      },
      select: { userId: true },
    });
    return this.createSession(identity.userId);
  }

  async principal(authorization?: string): Promise<{ id: string; role: string }> {
    const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
    if (!token) throw new UnauthorizedException();
    let payload: string | jwt.JwtPayload;
    try {
      payload = jwt.verify(token, this.jwtSecret, {
        algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException();
    }
    if (
      typeof payload === "string" || typeof payload.sub !== "string"
      || typeof payload.sid !== "string"
    ) throw new UnauthorizedException();
    const session = await this.prisma.database.authSession.findUnique({
      where: { id: payload.sid },
      select: {
        userId: true, revokedAt: true, expiresAt: true,
        user: { select: { id: true, role: true } },
      },
    });
    if (
      !session || session.userId !== payload.sub || session.revokedAt
      || session.expiresAt.getTime() <= Date.now()
    ) throw new UnauthorizedException();
    return session.user;
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    this.jwtSecret;
    const found = await this.prisma.database.authSession.findUnique({
      where: { refreshTokenHash: hashRefresh(refreshToken) },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true },
    });
    if (!found || found.revokedAt || found.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException();
    }
    // Atomic compare-and-revoke: concurrent use of the same refresh token
    // can rotate only once, never mint two active sessions.
    const revoked = await this.prisma.database.authSession.updateMany({
      where: { id: found.id, revokedAt: null, refreshTokenHash: hashRefresh(refreshToken) },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) throw new UnauthorizedException();
    return this.createSession(found.userId);
  }

  async logout(authorization?: string): Promise<{ status: "ok" }> {
    const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
    await this.principal(authorization);
    const payload = jwt.decode(token!) as jwt.JwtPayload;
    if (typeof payload.sid !== "string") throw new UnauthorizedException();
    await this.prisma.database.authSession.updateMany({
      where: { id: payload.sid, revokedAt: null }, data: { revokedAt: new Date() },
    });
    return { status: "ok" };
  }

  async adminAccess(authorization: string | undefined, branchId: string): Promise<{ status: "ok" }> {
    const user = await this.principal(authorization);
    // OWNER is global; MANAGER and other staff are always branch-scoped.
    if (user.role !== "OWNER") {
      const membership = await this.prisma.database.branchMember.findUnique({
        where: { branchId_userId: { branchId, userId: user.id } },
        select: { role: true },
      });
      if (!membership || !["OWNER", "MANAGER"].includes(membership.role)) {
        throw new ForbiddenException();
      }
    }
    return { status: "ok" };
  }
}
