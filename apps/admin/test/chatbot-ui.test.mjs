import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = x => readFileSync(new URL(x, import.meta.url), "utf8");

test("Admin settings exposes Dialogflow CX chatbot as an OWNER popup setting", () => {
  const hub = read("../src/SettingsHub.tsx");
  const panel = read("../src/ChatbotPanel.tsx");
  assert.match(hub, /id: "chatbot", label: "Chatbot AI", icon: "chat"/);
  assert.match(hub, /selected === "chatbot" && <ChatbotPanel/);
  assert.match(panel, /Chọn file JSON Google/);
  assert.match(panel, /Tải Agent/);
  assert.match(panel, /Environment/);
  assert.match(panel, /Bật Chatbot AI/);
});

test("Admin loads a real JSON file and never asks for manual Agent ID", () => {
  const panel = read("../src/ChatbotPanel.tsx");
  assert.match(panel, /input\.type = "file"/);
  assert.match(panel, /File\.pickFileAsync/);
  assert.match(panel, /\/credentials/);
  assert.match(panel, /\/agents/);
  assert.match(panel, /\/environments/);
  assert.match(panel, /accessibilityRole="radio"/);
  assert.doesNotMatch(panel, /Nhập Agent ID|Agent ID thủ công/);
});

test("Admin describes secret handling and keeps Zalo in chatbot config", () => {
  const panel = read("../src/ChatbotPanel.tsx");
  assert.match(panel, /được mã hóa trước khi lưu/);
  assert.match(panel, /Private key không được trả lại/);
  assert.match(panel, /0902964685/);
  assert.match(panel, /góc phải trên header đỏ/);
});
