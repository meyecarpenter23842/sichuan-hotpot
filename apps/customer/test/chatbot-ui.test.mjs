import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const read = x => readFileSync(new URL(x, import.meta.url), "utf8");

test("Customer renders the approved chatbot avatar outside and inside chat", () => {
  const app = read("../App.tsx");
  const widget = read("../src/components/ChatbotWidget.tsx");
  assert.match(app, /<ChatbotWidget branchId=\{branchId\} active=\{authReady && screen !== "login"\}\/>/);
  assert.match(widget, /const CHATBOT_AVATAR = require\("\.\.\/\.\.\/assets\/avatar-chatbot\.jpg"\)/);
  assert.match(widget, /testID="chatbot-fab"/);
  assert.match(widget, /<BotAvatar size=\{48\} \/>/);
  assert.match(widget, /<View style=\{s\.headerAvatar\}><BotAvatar size=\{38\} \/><\/View>/);
  assert.match(widget, /<View style=\{s\.messageAvatar\}><BotAvatar size=\{28\} \/><\/View>/);
  assert.equal(existsSync(new URL("../assets/avatar-chatbot.jpg", import.meta.url)), true);
});

test("Customer chatbot header uses a Zalo app-style mark in the top-right action area", () => {
  const widget = read("../src/components/ChatbotWidget.tsx");
  assert.match(widget, /backgroundColor: palette\.red/);
  assert.match(widget, /accessibilityLabel="Mở Zalo hỗ trợ"/);
  assert.match(widget, /function ZaloLogo\(\)/);
  assert.match(widget, /<Text style=\{s\.zaloWord\}>Zalo<\/Text>/);
  assert.match(widget, /borderColor: "#0068FF"/);
  assert.match(widget, /https:\/\/zalo\.me\//);
  assert.doesNotMatch(widget, /<Text style=\{s\.zaloMark\}>Z<\/Text>/);
});

test("Customer shows human-like animated typing dots while waiting for Dialogflow", () => {
  const widget = read("../src/components/ChatbotWidget.tsx");
  assert.match(widget, /function TypingIndicator\(\)/);
  assert.match(widget, /Animated\.loop/);
  assert.match(widget, /Animated\.stagger\(120/);
  assert.match(widget, /accessibilityLabel="Chatbot đang nhập"/);
  assert.match(widget, /sending \? "Đang nhập…"/);
  assert.match(widget, /\{sending \? <AssistantBubble>/);
  assert.doesNotMatch(widget, /ActivityIndicator/);
});

test("Customer CX chat stays public, session-scoped and never receives Google credentials", () => {
  const widget = read("../src/components/ChatbotWidget.tsx");
  assert.match(widget, /\/chatbot\/message/);
  assert.match(widget, /sessionId: sessionId\.current/);
  assert.match(widget, /maxLength=\{500\}/);
  assert.doesNotMatch(widget, /private_key|credentialCiphertext|serviceAccountJson/);
});
