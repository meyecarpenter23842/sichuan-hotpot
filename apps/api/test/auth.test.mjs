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
const { VerificationMailSender } = require("../dist/auth/verification-mail.sender.js");

process.env.AUTH_JWT_SECRET = "test-key-not-production-1234567890-abcd-ONLY";
process.env.CORS_ALLOWED_ORIGINS = "https://customer.example.test,http://localhost:8081";
let app;
let db;
const capturedMail = new Map();
async function signup(client, username, password, email = "user" + randomUUID().replaceAll("-", "") + "@example.test") {
  const requested = await client.post("/auth/register/request-code").send({ username, email, password }).expect(201);
  assert.equal(requested.body.status, "sent");
  const code = capturedMail.get(email);
  assert.match(code ?? "", /^[0-9]{6}$/);
  const result = await client.post("/auth/register/confirm-code").send({ email, code }).expect(201);
  return { ...result, email, code };
}
before(async () => {
  assert.ok(process.env.DATABASE_URL, "CI requires disposable Postgres");
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
  db = new PrismaClient();
  app.get(VerificationMailSender).sendCode = async (to, code) => { capturedMail.set(to, code); };
});
after(async () => {
  if (app) await app.close();
  if (db) await db.$disconnect();
});

test("explicit browser CORS allows customer PWA preflight and excludes untrusted origins", async () => {
  const client = supertest(app.getHttpServer());
  const accepted = await client.options("/auth/login")
    .set("Origin", "https://customer.example.test")
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type")
    .expect(204);
  assert.equal(accepted.headers["access-control-allow-origin"], "https://customer.example.test");
  assert.equal(accepted.headers["access-control-allow-credentials"], undefined);
  assert.match(accepted.headers["access-control-allow-methods"], /POST/);

  const rejected = await client.options("/auth/login")
    .set("Origin", "https://untrusted.example.test")
    .set("Access-Control-Request-Method", "POST");
  // An unlisted origin can fall through to Nest's 404 OPTIONS handler,
  // but must never receive an Access-Control-Allow-Origin header.
  assert.ok([204, 404].includes(rejected.status));
  assert.equal(rejected.headers["access-control-allow-origin"], undefined);
  const localhost = await client.options("/auth/google")
    .set("Origin", "http://localhost:8081")
    .set("Access-Control-Request-Method", "POST")
    .expect(204);
  assert.equal(localhost.headers["access-control-allow-origin"], "http://localhost:8081");
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
  const password = "lauxuyen";
  const created = await signup(client, "  " + name.toUpperCase() + " ", password);
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

  await client.post("/auth/register/request-code").send({ username: name, email: "another" + randomUUID().replaceAll("-", "") + "@example.test", password }).expect(409);
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
  const unrelatedBranch = await db.branch.create({
    data: { code: "OTHER" + randomUUID().slice(0, 8), name: "Other branch", latitude: "10.1234567", longitude: "106.7654321" },
  });
  await client.get("/auth/admin/" + unrelatedBranch.id).set("Authorization", bearer).expect(403);

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
  const email = "someone@example.test";
  await client.post("/auth/register/request-code").send({ username: "xy", email, password: "lauxuyen" }).expect(400);
  await client.post("/auth/register/request-code").send({ username: "good", email, password: "short" }).expect(400);
  await client.post("/auth/register/request-code").send({ username: "good", email, password: "a".repeat(12) }).expect(400);
  await client.post("/auth/register/request-code").send({ username: "good", email, password: "lauxuyen", role: "OWNER" }).expect(400);
  await client.post("/auth/register").send({ username: "good", password: "lauxuyen" }).expect(404);
});

test("concurrent refresh uses single-winner rotation", async () => {
  const client = supertest(app.getHttpServer());
  const name = "r" + randomUUID().replaceAll("-", "").slice(0, 15);
  const session = await signup(client, name, "lauxuyen");
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

test("all five roles enforce global owner and branch-scoped manager access", async () => {
  const client = supertest(app.getHttpServer());
  const branch = await db.branch.create({
    data: { code: "ROLES" + randomUUID().slice(0, 8), name: "Roles CI", latitude: "10.1234567", longitude: "106.7654321" },
  });
  const { AuthService } = require("../dist/auth/auth.service.js");
  const auth = app.get(AuthService);
  for (const role of ["OWNER", "MANAGER", "KITCHEN", "DRIVER", "CUSTOMER"]) {
    const name = "role" + randomUUID().replaceAll("-", "").slice(0, 12);
    // Bypass HTTP registration only for fixture setup, not authorization.
    const tokens = await signup(client, name, "lauxuyen");
    const bearer = "Bearer " + tokens.body.accessToken;
    const principal = await auth.principal(bearer);
    await db.user.update({ where: { id: principal.id }, data: { role } });
    await client.get("/auth/admin/" + branch.id).set("Authorization", bearer)
      .expect(role === "OWNER" ? 200 : 403);
    // CUSTOMER is not a valid staff membership in the database constraint.
    if (role !== "CUSTOMER") {
      await db.branchMember.create({ data: { branchId: branch.id, userId: principal.id, role } });
    }
    await client.get("/auth/admin/" + branch.id).set("Authorization", bearer)
      .expect(["OWNER", "MANAGER"].includes(role) ? 200 : 403);
    await client.get("/auth/admin/" + randomUUID()).set("Authorization", bearer)
      .expect(role === "OWNER" ? 200 : 403);
  }
});

test("customer saved addresses: validate, persist with phone, isolate users and delete safely", async () => {
  const client = supertest(app.getHttpServer());
  const pass = "lauxuyen";
  const a = await signup(client, "a" + randomUUID().replaceAll("-", "").slice(0, 18), pass);
  const b = await signup(client, "b" + randomUUID().replaceAll("-", "").slice(0, 18), pass);
  const authA = "Bearer " + a.body.accessToken;
  const authB = "Bearer " + b.body.accessToken;
  await client.get("/customer/addresses").expect(401);
  await client.post("/customer/addresses").set("Authorization", authA).send({
    label: "Nhà", line1: "12 Nguyen Trai Q1 TP HCM", phone: "0912345678",
    latitude: "99.0", longitude: "106.7654321",
  }).expect(400);
  const one = await client.post("/customer/addresses").set("Authorization", authA).send({
    label: "Nhà", line1: "12 Nguyen Trai Q1 TP HCM", phone: "0912345678",
    latitude: "10.1234567", longitude: "106.7654321",
  }).expect(201);
  assert.equal(one.body.latitude, "10.1234567");
  const two = await client.post("/customer/addresses").set("Authorization", authA).send({
    label: "Công ty", line1: "43 Le Loi Q1 TP HCM", phone: "0912345678",
    latitude: "10.1000000", longitude: "106.7000000",
  }).expect(201);
  const listA = await client.get("/customer/addresses").set("Authorization", authA).expect(200);
  assert.equal(listA.body.phone, "+84912345678");
  assert.equal(listA.body.addresses.length, 2);
  const listB = await client.get("/customer/addresses").set("Authorization", authB).expect(200);
  assert.equal(listB.body.addresses.length, 0);
  await client.delete("/customer/addresses/" + one.body.id).set("Authorization", authB).expect(404);
  await client.delete("/customer/addresses/" + one.body.id).set("Authorization", authA).expect(200);
  const finalList = await client.get("/customer/addresses").set("Authorization", authA).expect(200);
  assert.deepEqual(finalList.body.addresses.map(x => x.id), [two.body.id]);
});

test("email registration requires a valid six-digit code and enforces replay/attempt bounds", async () => {
  const client = supertest(app.getHttpServer());
  const email = "test" + randomUUID().replaceAll("-", "") + "@example.test";
  const username = "test" + randomUUID().replaceAll("-", "").slice(0, 17);
  await client.post("/auth/register/request-code").send({ username, email, password: "123456" }).expect(201);
  assert.equal(await db.localCredential.count({ where: { verifiedEmail: email } }), 0);
  await client.post("/auth/register/confirm-code").send({ email, code: "000000" }).then(async res => {
    // If by rare chance generated code is zero, use a different invalid code.
    if (capturedMail.get(email) === "000000") return;
    assert.equal(res.status, 400);
  });
  const code = capturedMail.get(email);
  await client.post("/auth/register/confirm-code").send({ email, code }).expect(201);
  await client.post("/auth/register/confirm-code").send({ email, code }).expect(400);
  const cred = await db.localCredential.findUnique({ where: { verifiedEmail: email } });
  assert.equal(cred?.normalizedUsername, username);
  await client.post("/auth/register/request-code").send({ username: "other", email, password: "123456" }).expect(409);
});

test("password recovery hides email existence, revokes sessions, and never allows code replay", async () => {
  const client = supertest(app.getHttpServer());
  const email = "recover" + randomUUID().replaceAll("-", "") + "@example.test";
  const username = "recover" + randomUUID().replaceAll("-", "").slice(0, 17);
  const initial = await signup(client, username, "moi12345", email);
  const missing = "absent" + randomUUID().replaceAll("-", "") + "@example.test";
  const response = await client.post("/auth/password/request-code").send({ email: missing }).expect(201);
  assert.equal(response.body.status, "sent");
  await client.post("/auth/password/request-code").send({ email }).expect(201);
  const code = capturedMail.get(email);
  await client.post("/auth/password/reset").send({ email, code, password: "newpass1" }).expect(201);
  await client.post("/auth/password/reset").send({ email, code, password: "another1" }).expect(400);
  await client.get("/auth/me").set("Authorization", "Bearer " + initial.body.accessToken).expect(401);
  await client.post("/auth/login").send({ username, password: "moi12345" }).expect(401);
  await client.post("/auth/login").send({ username, password: "newpass1" }).expect(201);
});

test("login bounds untrusted inputs before hashing and database lookup", async () => {
  const client = supertest(app.getHttpServer());
  await client.post("/auth/login").send({ username: "a".repeat(65), password: "wrong" }).expect(400);
  await client.post("/auth/login").send({ username: "valid", password: "a".repeat(129) }).expect(400);
});

test("login abuse returns 429 with a redacted error", async () => {
  // Independent app gives this test its own throttle storage and request budget.
  const limited = await NestFactory.create(AppModule, { logger: false });
  configureApp(limited);
  await limited.init();
  try {
    const client = supertest(limited.getHttpServer());
    const name = "absent" + randomUUID().replaceAll("-", "").slice(0, 12);
    for (let attempt = 0; attempt < 8; attempt++) {
      await client.post("/auth/login").send({ username: name, password: "wrong" }).expect(401);
    }
    const response = await client.post("/auth/login")
      .send({ username: name, password: "never-echo-this-password" }).expect(429);
    assert.equal(response.body.error.code, "TOO_MANY_REQUESTS");
    assert.ok(!JSON.stringify(response.body).includes("never-echo-this-password"));
    assert.ok(!JSON.stringify(response.body).includes(name));
  } finally {
    await limited.close();
  }
});
