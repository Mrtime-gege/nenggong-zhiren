import assert from "node:assert/strict";
import test from "node:test";

import { AI_TASKS, AiAssistError, buildTicketContext } from "../src/ai/assist.mjs";

test("AI task catalog and error metadata are stable", () => {
  assert.deepEqual([...AI_TASKS], ["summary", "translate", "reply"]);
  const error = new AiAssistError("bad", "ai_test", 503, 1500);
  assert.equal(error.name, "AiAssistError");
  assert.equal(error.code, "ai_test");
  assert.equal(error.status, 503);
  assert.equal(error.retryAfterMs, 1500);
});

test("AI context keeps tool names and redacts secrets", () => {
  const ticket = {
    tools: [
      { function: { name: "lookup_order", description: "Look up an order", parameters: { type: "object", properties: { id: { type: "string" } } } } },
      { function: { name: "refund_order", description: "Refund", parameters: { type: "object" } } },
    ],
    messages: [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Authorization: Bearer sk-secret-token and order 42" },
      { role: "assistant", content: "Working on it" },
    ],
  };
  const context = buildTicketContext(ticket, { includeTools: true, selection: "selected text", maxChars: 1000 });
  assert.match(context, /lookup_order/);
  assert.match(context, /refund_order/);
  assert.match(context, /\[REDACTED/);
  assert.doesNotMatch(context, /sk-secret-token/);
});

test("AI context truncates long content and keeps the newest messages", () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({ role: "user", content: `${index}:${"x".repeat(200)}` }));
  const context = buildTicketContext({ messages, tools: [] }, { maxChars: 400 });
  assert.ok(context.length <= 400);
  assert.match(context, /19:/);
  assert.match(context, /0:/);
});

test("AI context works without tools and selection", () => {
  const context = buildTicketContext({ messages: [{ role: "user", content: "hello" }], tools: [] });
  assert.match(context, /hello/);
  assert.doesNotMatch(context, /工具/);
});
