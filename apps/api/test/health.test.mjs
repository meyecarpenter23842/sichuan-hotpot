import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const supertest = require("supertest");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("../dist/app.module.js");
const { configureApp } = require("../dist/bootstrap.js");
const { PrismaService } = require("../dist/database/prisma.service.js");

let app;
before(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();
});
after(async () => {
  if (app) await app.close();
});

test("GET /health/live responds independent of database availability", async () => {
  const res = await supertest(app.getHttpServer()).get("/health/live").expect(200);
  assert.deepEqual(res.body, { status: "ok" });
});

test("GET /health/ready proves PostgreSQL connectivity on isolated CI database", async () => {
  assert.ok(process.env.DATABASE_URL, "CI must set test DATABASE_URL");
  const res = await supertest(app.getHttpServer()).get("/health/ready").expect(200);
  assert.deepEqual(res.body, { status: "ok" });
});

test("readiness rejects absent or invalid datasource with no secrets in response", async () => {
  const saved = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    const missing = new PrismaService();
    assert.equal(await missing.isReady(), false);
    await missing.onModuleDestroy();
    process.env.DATABASE_URL = "not-a-postgresql-url";
    const bad = new PrismaService();
    assert.equal(await bad.isReady(), false);
    await bad.onModuleDestroy();
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

test("readiness endpoint refuses service when database connectivity fails", async () => {
  const { HealthController } = require("../dist/health/health.controller.js");
  const controller = new HealthController({ isReady: async () => false });
  await assert.rejects(
    controller.ready(),
    (err) => err?.getStatus?.() === 503,
  );
});

test("unmatched routes use redacted structured error response", async () => {
  const res = await supertest(app.getHttpServer())
    .get("/does-not-exist")
    .set("x-request-id", "test_request_id_1234")
    .expect(404);
  assert.equal(res.body.error.code, "NOT_FOUND");
  assert.equal(res.body.requestId, "test_request_id_1234");
  assert.equal(res.headers["x-request-id"], "test_request_id_1234");
});

test("invalid caller request ID is replaced, not reflected", async () => {
  const res = await supertest(app.getHttpServer())
    .get("/health/live")
    .set("x-request-id", "bad!value")
    .expect(200);
  assert.match(res.headers["x-request-id"], /^[0-9a-f-]{36}$/);
});

test("standard security headers are present", async () => {
  const res = await supertest(app.getHttpServer()).get("/health/live").expect(200);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
});
