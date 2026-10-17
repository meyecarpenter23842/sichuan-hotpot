import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ChatbotService } from "../dist/chatbot/chatbot.service.js";

const branch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fixture(row = null) {
  const db = {
    branch: { findUnique: async ({ where }) => where.id === branch ? { id: branch } : null },
    chatbotConfig: { findUnique: async () => row },
  };
  const auth = { principal: async () => ({ id: "owner", role: "OWNER" }) };
  return new ChatbotService({ database: db }, auth);
}

test("chatbot public defaults keep Zalo available without exposing Google credentials", async () => {
  const payload = await fixture().publicGet(branch);
  assert.equal(payload.enabled, false);
  assert.equal(payload.configured, false);
  assert.equal(payload.zaloEnabled, true);
  assert.equal(payload.zaloPhone, "0902964685");
  assert.equal("credentialCiphertext" in payload, false);
  assert.equal("private_key" in payload, false);
});

test("chatbot public config only enables CX when encrypted credentials and an agent exist", async () => {
  const payload = await fixture({
    enabled: true, zaloEnabled: true, projectId: "hotpot-demo",
    credentialCiphertext: "cipher", credentialIv: "iv", credentialTag: "tag",
    agentResourceName: "projects/hotpot-demo/locations/asia-southeast1/agents/abc",
  }).publicGet(branch);
  assert.equal(payload.enabled, true);
  assert.equal(payload.configured, true);
});

test("chatbot migration is additive and stores credentials encrypted", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20261017060000_dialogflow_cx_chatbot/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE "ChatbotConfig"/);
  assert.match(sql, /"credentialCiphertext" TEXT/);
  assert.match(sql, /credentials_all_or_none_check/);
  assert.doesNotMatch(sql, /private_key|client_email|DROP TABLE|DELETE FROM/);
});

test("chatbot controllers keep secret upload admin-only and public chat separate", () => {
  const controller = readFileSync(new URL("../src/chatbot/chatbot.controller.ts", import.meta.url), "utf8");
  assert.match(controller, /@Controller\("admin\/branches\/:branchId\/chatbot"\)/);
  assert.match(controller, /@Put\("credentials"\)/);
  assert.match(controller, /@Controller\("catalog\/branches\/:branchId\/chatbot"\)/);
  assert.match(controller, /@Post\("message"\)/);
});
