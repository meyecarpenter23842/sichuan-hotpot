import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { PushService } = require("../dist/push/push.service.js");
const RELAY_URL = "https://script.google.com/macros/s/AKfycb-test/exec";
const KEY = "ab".repeat(32);
const endpoint = { id: "test-endpoint", token: "fcm-client-token-" + "1".repeat(64) };
const message = { title: "Test notification", body: "Safe test",
  kind: "TEST", testId: "test-id", url: "/" };

function service() {
  const deleted = [];
  return {
    deleted,
    push: new PushService({ database: {
      pushEndpoint: { deleteMany: async value => { deleted.push(value); } },
    } }, {}),
  };
}

async function withRelay(fn) {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.FCM_RELAY_URL;
  const oldSecret = process.env.FCM_RELAY_SECRET_HEX;
  process.env.FCM_RELAY_URL = RELAY_URL;
  process.env.FCM_RELAY_SECRET_HEX = KEY;
  try { await fn(); }
  finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.FCM_RELAY_URL;
    else process.env.FCM_RELAY_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.FCM_RELAY_SECRET_HEX;
    else process.env.FCM_RELAY_SECRET_HEX = oldSecret;
  }
}

test("FCM Apps Script relay HMAC signs each short-lived Android Admin message", async () => {
  await withRelay(async () => {
    const { push } = service();
    let called = 0;
    globalThis.fetch = async (url, options) => {
      called++;
      assert.equal(url, RELAY_URL);
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "follow");
      const sent = JSON.parse(options.body);
      const signed = JSON.parse(Buffer.from(sent.payload, "base64url").toString("utf8"));
      const expected = createHmac("sha256", Buffer.from(KEY, "hex"))
        .update(sent.payload).digest("base64url");
      assert.equal(sent.signature, expected);
      assert.equal(signed.message.token, endpoint.token);
      assert.equal(signed.message.data.kind, "TEST");
      assert.equal(signed.message.android.notification.channel_id, "new-orders-v3");
      assert.ok(Math.abs(signed.ts - Date.now()) < 20_000);
      assert.match(signed.nonce, /^[0-9a-f-]{36}$/);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    await push.sendFcm(endpoint, message, true);
    assert.equal(called, 1);
  });
});

test("Relay rejects HTML/invalid response, never pretends sent", async () => {
  await withRelay(async () => {
    const { push } = service();
    globalThis.fetch = async () => new Response("login required", { status: 200 });
    await assert.rejects(push.sendFcm(endpoint, message, false),
      /FCM_RELAY_PROVIDER_REJECTED/);
  });
});

test("Relay removes only expired FCM device tokens", async () => {
  await withRelay(async () => {
    const { push, deleted } = service();
    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: false, code: "TOKEN_EXPIRED",
    }), { status: 200 });
    await assert.rejects(push.sendFcm(endpoint, message, false),
      /FCM_DEVICE_TOKEN_EXPIRED/);
    assert.deepEqual(deleted, [{ where: { id: "test-endpoint" } }]);
  });
});

test("Rejects unsafe relay URL or missing secret before sending", async () => {
  await withRelay(async () => {
    const { push } = service();
    process.env.FCM_RELAY_URL = "https://attacker.example.test/";
    globalThis.fetch = async () => { throw Error("must not reach network"); };
    await assert.rejects(push.sendFcm(endpoint, message, true),
      /FCM_RELAY_NOT_CONFIGURED/);
  });
});
