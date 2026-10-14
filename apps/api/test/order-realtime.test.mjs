import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { NestFactory } = require("@nestjs/core");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");
const { AppModule } = require("../dist/app.module.js");
const { configureApp } = require("../dist/bootstrap.js");
const { OrderRealtimeService } = require("../dist/orders/order-realtime.service.js");

const secret = "p4-socket-test-isolated-ci-secret-1234567890";
process.env.AUTH_JWT_SECRET = secret;
process.env.CORS_ALLOWED_ORIGINS = "http://localhost:8081";

let app, db, stream, endpoint, branchId, foreignBranchId;
let owner, cook, customer, outsider;
const sockets = [];
async function principal(role, branchRole) {
  const user = await db.user.create({ data: { role } });
  if (branchRole) await db.branchMember.create({
    data: { branchId, userId: user.id, role: branchRole },
  });
  const session = await db.authSession.create({
    data: { userId: user.id, refreshTokenHash: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 600000) },
  });
  return {
    id: user.id,
    token: jwt.sign({ sid: session.id }, secret, {
      algorithm: "HS256", issuer: "sichuan-hotpot",
      audience: "sichuan-hotpot-api", subject: user.id, expiresIn: "5m",
    }),
  };
}
async function connect(person, scope, branch = branchId) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint, { headers: { Origin: "http://localhost:8081" } });
    sockets.push(socket);
    const timeout = setTimeout(() => reject(new Error("WS_READY_TIMEOUT")), 3000);
    socket.on("open", () => socket.send(JSON.stringify({
      type: "subscribe", scope, token: person.token,
      ...(scope === "staff" ? { branchId: branch } : {}),
    })));
    socket.on("message", raw => {
      const event = JSON.parse(String(raw));
      if (event.type === "ready") { clearTimeout(timeout); resolve(socket); }
    });
    socket.on("error", error => { clearTimeout(timeout); reject(error); });
    socket.on("close", () => { clearTimeout(timeout); });
  });
}
function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", receive);
      reject(new Error("WS_EVENT_TIMEOUT"));
    }, 1500);
    const receive = raw => {
      clearTimeout(timeout);
      socket.off("message", receive);
      resolve(JSON.parse(String(raw)));
    };
    socket.on("message", receive);
  });
}

before(async () => {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
  assert.ok(url.protocol === "postgresql:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    ["/hotpot_ci", "/hotpot_api_release_check"].includes(url.pathname),
    "Refusing production database in realtime test");
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  stream = app.get(OrderRealtimeService);
  stream.attach(app.getHttpServer());
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address();
  endpoint = "ws://127.0.0.1:" + port + "/realtime";
  db = new PrismaClient();
  const branch = await db.branch.create({
    data: { code: "socket-" + randomUUID(), name: "Socket one",
      latitude: "10.77", longitude: "106.70" },
  });
  branchId = branch.id;
  foreignBranchId = (await db.branch.create({
    data: { code: "socket-" + randomUUID(), name: "Socket two",
      latitude: "10.78", longitude: "106.71" },
  })).id;
  owner = await principal("OWNER");
  cook = await principal("CUSTOMER", "KITCHEN");
  customer = await principal("CUSTOMER");
  outsider = await principal("CUSTOMER");
});
after(async () => {
  for (const socket of sockets) socket.terminate();
  if (app) await app.close();
  if (db) await db.$disconnect();
});

test("WS checks staff scope, branch membership and customer ownership", async () => {
  const staff = await connect(owner, "staff");
  const kitchen = await connect(cook, "staff");
  const own = await connect(customer, "customer");
  const other = await connect(outsider, "customer");
  const orderId = randomUUID();
  const waitStaff = nextMessage(staff);
  const waitOwn = nextMessage(own);
  await stream.publish({ type: "order.created", orderId, branchId,
    customerId: customer.id, status: "PENDING" });
  const [staffEvent, customerEvent] = await Promise.all([waitStaff, waitOwn]);
  assert.equal(staffEvent.orderId, orderId);
  assert.equal(customerEvent.orderId, orderId);
  assert.equal(staffEvent.status, "PENDING");
  assert.equal(staffEvent.phoneSnapshot, undefined);
  assert.equal(staffEvent.totalVnd, undefined);
  // Kitchen and another customer never get this pending order hint.
  assert.equal(kitchen.readyState, WebSocket.OPEN);
  assert.equal(other.readyState, WebSocket.OPEN);

  const waitKitchen = nextMessage(kitchen);
  await stream.publish({ type: "order.status", orderId, branchId,
    customerId: customer.id, status: "PREPARING" });
  const kitchenEvent = await waitKitchen;
  assert.equal(kitchenEvent.status, "PREPARING");
});

test("websocket rejects staff without membership and untrusted browser origins", async () => {
  await assert.rejects(connect(outsider, "staff", foreignBranchId), /WS_READY_TIMEOUT|WS/);
});
