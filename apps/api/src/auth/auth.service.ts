import {
  Injectable, BadRequestException, ConflictException,
  ForbiddenException, ServiceUnavailableException, UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { PrismaService } from "../database/prisma.service";
import { GoogleTokenVerifier } from "./google-token.verifier";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
}
const ISSUER = "sichuan-hotpot";
const AUDIENCE = "sichuan-hotpot-api";
const REFRESH_MS = 14 * 24 * 60 * 60 * 1000;
const DUMMY_PASSWORD = "constant-no-existing-account-password-1234";

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

  async register(username: string, password: string): Promise<AuthTokens> {
    const normalizedUsername = usernameOf(username);
    this.jwtSecret; // Fail closed before expensive hashing or writing.
    if (password.length < 12 || password.length > 128) {
      throw new BadRequestException("Invalid password length");
    }
    const passwordHash = await hash(password, this.hashOptions);
    try {
      const credential = await this.prisma.database.localCredential.create({
        data: {
          normalizedUsername, passwordHash,
          user: { create: { role: "CUSTOMER" } },
        },
        select: { userId: true },
      });
      return await this.createSession(credential.userId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2002"
      ) throw new ConflictException("Username unavailable");
      throw error;
    }
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
    if (!["OWNER", "MANAGER"].includes(user.role)) {
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
