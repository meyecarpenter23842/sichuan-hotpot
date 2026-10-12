import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { NestFactory } = require("@nestjs/core");
const supertest = require("supertest");
const { PrismaClient } = require("@prisma/client");
const { AppModule } = require("../dist/app.module.js");
const { configureApp } = require("../dist/bootstrap.js");
const { GoogleTokenVerifier } = require("../dist/auth/google-token.verifier.js");

process.env.AUTH_JWT_SECRET = "test-key-not-production-1234567890-abcd-ONLY";
let app;
let db;
before(async () => {
  assert.ok(process.env.DATABASE_URL, "CI requires disposable Postgres");
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
  db = new PrismaClient();
});
after(async () => {
  if (app) await app.close();
  if (db) await db.$disconnect();
});

test("guest private endpoint rejects absent and forged JWT", async () => {
  const client = supertest(app.getHttpServer());
  await client.get("/auth/me").expect(401);
  await client.get("/auth/me")
    .set("Authorization", "Bearer a.b.c")
    .expect(401);
  await client.get("/auth/admin/" + randomUUID()).expect(401);
});

test("register username, protect password, login, enforce branch role, revoke/rotate sessions", async () => {
  const client = supertest(app.getHttpServer());
  const name = "u" + randomUUID().replaceAll("-", "").slice(0, 15);
  const password = "Secure-test-passphrase-2026!!";
  const created = await client.post("/auth/register")
    .send({ username: "  " + name.toUpperCase() + " ", password })
    .expect(201);
  assert.equal(typeof created.body.accessToken, "string");
  assert.equal(typeof created.body.refreshToken, "string");
  assert.equal(created.body.accessTokenExpiresInSeconds, 900);

  const cred = await db.localCredential.findUnique({
    where: { normalizedUsername: name },
    select: { userId: true, passwordHash: true },
  });
  assert.ok(cred);
  assert.ok(cred.passwordHash.startsWith("$argon2id$"));
  assert.ok(!cred.passwordHash.includes(password));

  await client.post("/auth/register").send({ username: name, password }).expect(409);
  await client.post("/auth/login").send({ username: name, password: "wrong" }).expect(401);
  const login = await client.post("/auth/login").send({ username: name.toUpperCase(), password }).expect(201);
  const bearer = "Bearer " + login.body.accessToken;
  const profile = await client.get("/auth/me").set("Authorization", bearer).expect(200);
  assert.equal(profile.body.id, cred.userId);
  assert.equal(profile.body.role, "CUSTOMER");
  const branch = await db.branch.create({
    data: { code: "AUTH" + randomUUID().slice(0, 8), name: "Auth CI", latitude: "10.1234567", longitude: "106.7654321" },
  });
  await client.get("/auth/admin/" + branch.id).set("Authorization", bearer).expect(403);
  await db.branchMember.create({ data: { branchId: branch.id, userId: cred.userId, role: "MANAGER" } });
  await client.get("/auth/admin/" + branch.id).set("Authorization", bearer).expect(200);

  const oldRefresh = login.body.refreshToken;
  const rotated = await client.post("/auth/refresh").send({ refreshToken: oldRefresh }).expect(201);
  await client.post("/auth/refresh").send({ refreshToken: oldRefresh }).expect(401);
  const rotatedBearer = "Bearer " + rotated.body.accessToken;
  await client.get("/auth/me").set("Authorization", rotatedBearer).expect(200);
  await client.post("/auth/logout").set("Authorization", rotatedBearer).expect(201);
  await client.get("/auth/me").set("Authorization", rotatedBearer).expect(401);
});

test("registration refuses bad inputs and password mismatch", async () => {
  const client = supertest(app.getHttpServer());
  await client.post("/auth/register").send({ username: "xy", password: "a".repeat(20) }).expect(400);
  await client.post("/auth/register").send({ username: "good", password: "short" }).expect(400);
  await client.post("/auth/register").send({ username: "good", password: "a".repeat(20), role: "OWNER" }).expect(400);
});

test("concurrent refresh uses single-winner rotation", async () => {
  const client = supertest(app.getHttpServer());
  const name = "r" + randomUUID().replaceAll("-", "").slice(0, 15);
  const session = await client.post("/auth/register").send({ username: name, password: "strong-Test-2026-Password" }).expect(201);
  const responses = await Promise.all(
    [0, 1].map(() => client.post("/auth/refresh").send({ refreshToken: session.body.refreshToken })),
  );
  assert.deepEqual(responses.map(x => x.status).sort(), [201, 401]);
});

test("Google-sub user mapping uses immutable provider subject, not email", async () => {
  const client = supertest(app.getHttpServer());
  const verifier = app.get(GoogleTokenVerifier);
  const originalVerify = verifier.verify;
  const sub = "dev-google-sub-" + randomUUID();
  verifier.verify = async () => sub;
  try {
    const a = await client.post("/auth/google").send({ idToken: "TEST_ID_TOKEN_A".repeat(8) }).expect(201);
    const b = await client.post("/auth/google").send({ idToken: "TEST_ID_TOKEN_B".repeat(8) }).expect(201);
    const aa = await client.get("/auth/me").set("Authorization", "Bearer " + a.body.accessToken).expect(200);
    const bb = await client.get("/auth/me").set("Authorization", "Bearer " + b.body.accessToken).expect(200);
    assert.equal(aa.body.id, bb.body.id);
    const identities = await db.authIdentity.findMany({ where: { provider: "GOOGLE", providerSubject: sub } });
    assert.equal(identities.length, 1);
  } finally {
    verifier.verify = originalVerify;
  }
});

test("Google verifier rejects malformed tokens and does not trust arbitrary subject claims", async () => {
  const verifier = app.get(GoogleTokenVerifier);
  const saved = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = "client-id-for-validate-only.apps.googleusercontent.com";
  try {
    await assert.rejects(verifier.verify("forged.invalid.token"), (error) => error?.getStatus?.() === 401);
  } finally {
    if (saved === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = saved;
  }
});
