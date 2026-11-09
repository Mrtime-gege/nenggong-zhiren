import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { countTokens, capToTokens, applyStop, splitForStream } from "../src/text.mjs";
import { appendAiCard, MAX_AI_CARDS, aiInputSummary } from "../src/ai/cards.mjs";
import { StateStore } from "../src/data/state.mjs";

test("text helpers estimate, cap, stop and split deterministically", () => {
  assert.equal(countTokens(""), 0);
  assert.equal(countTokens("abcd"), 1);
  assert.ok(countTokens("中文") >= 2);
  assert.deepEqual(capToTokens("中文abc", 2), { text: "中文", truncated: true });
  assert.deepEqual(capToTokens("abc", 10), { text: "abc", truncated: false });
  assert.deepEqual(applyStop("hello world", ["world"]), { text: "hello ", hit: "world" });
  assert.deepEqual(applyStop("hello", []), { text: "hello", hit: null });
  const parts = splitForStream("hello 中文 world");
  assert.equal(parts.join(""), "hello 中文 world");
  assert.ok(parts.length >= 1);
});

test("AI card persistence caps cards and records safe metadata", () => {
  const ticket = { model: "human-1", messages: [{ role: "user", content: "hello" }] };
  assert.equal(aiInputSummary(ticket), "1 条消息 · 5 字符");
  for (let index = 0; index < MAX_AI_CARDS + 3; index += 1) {
    appendAiCard(ticket, { source: "manual", content: `card-${index}`, startedAt: 1000, finishedAt: 1500 });
  }
  assert.equal(ticket.aiCards.length, MAX_AI_CARDS);
  assert.equal(ticket.aiCards[0].content, "card-3");
  assert.equal(ticket.aiCards.at(-1).content, `card-${MAX_AI_CARDS + 2}`);
  assert.equal(ticket.aiCards.at(-1).source, "manual");
  assert.equal(ticket.aiCards.at(-1).elapsedMs, 500);
});

test("StateStore persists AI cards across a JSON restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ngzr-state-unit-"));
  const file = path.join(dir, "state.json");
  const dbFile = path.join(dir, "state.db");
  const now = Date.now();
  const ticket = {
    id: "chatcmpl-unit",
    created: now,
    finishedAt: now,
    state: "done",
    text: "result",
    messages: [],
    notes: [],
    aiCards: [{ id: "ai_unit", content: "persisted", source: "manual" }],
    requestInspection: { protocol: "openai", raw: "{\"model\":\"human-1\"}", truncated: false },
  };
  const first = new StateStore({ file, dbFile, backend: "json", logger: { error() {} } }).init();
  try {
    first.snapshot([ticket], []);
  } finally {
    first.close();
  }
  const second = new StateStore({ file, dbFile, backend: "json", logger: { error() {} } }).init();
  try {
    const restored = second.restoreTickets();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].aiCards[0].content, "persisted");
    assert.equal(restored[0].requestInspection.raw, "{\"model\":\"human-1\"}");
  } finally {
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
