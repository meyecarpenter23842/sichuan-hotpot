import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = x => readFileSync(new URL(x, import.meta.url), "utf8");

test("Customer renders a floating chatbot outside scrolling content", () => {
  const app = read("../App.tsx");
  const widget = read("../src/components/ChatbotWidget.tsx");
  assert.match(app, /<ChatbotWidget branchId=\{branchId\} active=\{authReady && screen !== "login"\}\/>/);
  assert.match(widget, /testID="chatbot-fab"/);
  assert.match(widget, /position: "absolute", right: 14, bottom: 76/);
  assert.match(widget, /<Modal visible=\{open\}/);
});

test("Customer chatbot header puts Zalo in the red top-right action area", () => {
  const widget = read("../src/components/ChatbotWidget.tsx");
  assert.match(widget, /backgroundColor: palette\.red/);
  assert.match(widget, /accessibilityLabel="Mở Zalo hỗ trợ"/);
  assert.match(widget, /<Text style=\{s\.zaloMark\}>Z<\/Text>/);
  assert.match(widget, /backgroundColor: "#0068FF"/);
  assert.match(widget, /https:\/\/zalo\.me\//);
  assert.match(widget, /accessibilityLabel="Đóng chatbot"/);
});

test("Customer CX chat stays public, session-scoped and never receives Google credentials", () => {
  const widget = read("../src/components/ChatbotWidget.tsx");
  assert.match(widget, /\/chatbot\/message/);
  assert.match(widget, /sessionId: sessionId\.current/);
  assert.match(widget, /maxLength=\{500\}/);
  assert.doesNotMatch(widget, /private_key|credentialCiphertext|serviceAccountJson/);
});
