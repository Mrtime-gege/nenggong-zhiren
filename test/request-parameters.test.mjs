import assert from "node:assert/strict";
import test from "node:test";

import { describeRequestParameters, summarizeParameterWarnings } from "../src/protocol/request-parameters.mjs";

test("OpenAI request parameters include meanings, nested fields and unknown fields", () => {
  const rows = describeRequestParameters("openai", {
    model: "human-1",
    messages: [{ role: "user", content: "hello", tool_call_id: "call_1" }],
    tools: [{ type: "function", function: { name: "lookup", description: "Look up", parameters: { type: "object" } } }],
    stream: true,
    max_tokens: 100,
    future_parameter: { enabled: true },
  }, {
    model: "human-1",
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    toolChoice: "auto",
    parallelToolCalls: true,
    responseFormat: undefined,
    maxTokens: 100,
    stops: [],
    stream: true,
    includeUsage: false,
    attachments: [],
    clientUser: undefined,
    effort: undefined,
    protocol: "openai",
  });
  const byPath = new Map(rows.map((row) => [row.path, row]));
  assert.equal(byPath.get("model").status, "supported");
  assert.match(byPath.get("model").meaning, /模型/);
  assert.equal(byPath.get("messages[].role").status, "nested");
  assert.equal(byPath.get("tools[].function.name").status, "nested");
  assert.equal(byPath.get("future_parameter").status, "unknown");
  assert.ok(rows.some((row) => row.path === "normalized.toolChoice" && row.status === "derived"));
  assert.equal(byPath.get("max_tokens").normalizedField, "maxTokens");
  assert.equal(byPath.get("future_parameter").diff, "unknown");
  assert.ok(byPath.get("future_parameter").warning);
  const warnings = summarizeParameterWarnings(rows);
  assert.ok(warnings.some((item) => item.path === "future_parameter" && item.level === "warn"));
});

test("Anthropic request parameters map system and metadata fields", () => {
  const rows = describeRequestParameters("anthropic", {
    model: "human-1",
    system: "be useful",
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 200,
    metadata: { user_id: "u1", trace: "x" },
    stop_sequences: ["END"],
  }, {
    protocol: "anthropic",
    model: "human-1",
    messages: [],
    maxTokens: 200,
    stops: ["END"],
    clientUser: "u1",
    stream: false,
    includeUsage: true,
  });
  const byPath = new Map(rows.map((row) => [row.path, row]));
  assert.equal(byPath.get("system").normalizedField, "messages");
  assert.equal(byPath.get("metadata").normalizedField, "clientUser");
  assert.equal(byPath.get("max_tokens").normalizedValue, "200");
  assert.equal(byPath.get("stop_sequences").normalizedField, "stops");
});
