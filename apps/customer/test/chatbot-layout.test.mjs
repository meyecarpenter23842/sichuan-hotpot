import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("../src/components/ChatbotWidget.tsx", import.meta.url), "utf8");

test("chatbot FAB and panel clear the bottom navigation and safe area", () => {
  assert.match(chat, /useSafeAreaInsets/);
  assert.match(chat, /const bottomClearance = 78 \+ Math\.max\(0, insets\.bottom\)/);
  assert.match(chat, /\{ bottom: bottomClearance \}/);
  assert.match(chat, /paddingBottom: Math\.max\(72, bottomClearance - 6\)/);
  assert.doesNotMatch(chat, /bottom: 76/);
  assert.doesNotMatch(chat, /paddingBottom: 70/);
});
