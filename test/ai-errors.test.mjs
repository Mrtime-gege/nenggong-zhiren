import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { suggestWithAi, AiAssistError } from "../src/ai/assist.mjs";
import { suggestNative } from "../src/ai/native.mjs";
import { relayReply } from "../src/ai/relay.mjs";

const ticket = { model: "human-1", messages: [{ role: "user", content: "hello" }], tools: [] };

async function withJsonServer(status, payload, fn) {
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}/v1`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("AI assistants reject missing configuration and task input", async () => {
  await assert.rejects(() => suggestWithAi({ settings: {}, apiKey: "sk", ticket, task: "summary" }), (error) => error instanceof AiAssistError && error.code === "ai_not_configured");
  await assert.rejects(() => suggestNative({ settings: {}, apiKey: "sk", ticket }), (error) => error.code === "ai_not_configured");
  await assert.rejects(() => suggestWithAi({ settings: { endpoint: "http://127.0.0.1:1/v1", model: "m" }, apiKey: "", ticket, task: "summary" }), (error) => error.code === "ai_not_configured");
  await assert.rejects(() => suggestWithAi({ settings: { endpoint: "http://127.0.0.1:1/v1", model: "m" }, apiKey: "sk", ticket, task: "unknown" }), (error) => error.code === "ai_invalid_task");
  await assert.rejects(() => suggestWithAi({ settings: { endpoint: "http://127.0.0.1:1/v1", model: "m" }, apiKey: "sk", ticket, task: "translate" }), (error) => error.code === "ai_selection_required");
});

test("suggestWithAi surfaces HTTP, 429, non-JSON and empty output failures", async () => {
  await withJsonServer(500, { error: "down" }, async (endpoint) => {
    await assert.rejects(() => suggestWithAi({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket, task: "summary" }), (error) => error.code === "ai_provider_error");
  });
  await withJsonServer(429, { error: "slow" }, async (endpoint) => {
    await assert.rejects(() => suggestWithAi({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket, task: "summary" }), (error) => error.status === 429 && error.retryAfterMs === 5000);
  });
  await withJsonServer(200, "not-json", async (endpoint) => {
    await assert.rejects(() => suggestWithAi({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket, task: "summary" }), (error) => error.code === "ai_invalid_output");
  });
  await withJsonServer(200, { choices: [{ message: { content: "" } }] }, async (endpoint) => {
    await assert.rejects(() => suggestWithAi({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket, task: "summary" }), (error) => error.code === "ai_invalid_output");
  });
});

test("suggestNative surfaces context, rate-limit and malformed response errors", async () => {
  await withJsonServer(400, { error: "context too long" }, async (endpoint) => {
    await assert.rejects(() => suggestNative({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket }), (error) => error.code === "ai_input_too_large");
  });
  await withJsonServer(429, { error: "slow" }, async (endpoint) => {
    await assert.rejects(() => suggestNative({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket }), (error) => error.status === 429);
  });
  await withJsonServer(200, "not-json", async (endpoint) => {
    await assert.rejects(() => suggestNative({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket }), (error) => error.code === "ai_invalid_output");
  });
  await withJsonServer(200, { choices: [{ message: { content: "" }, finish_reason: "stop" }] }, async (endpoint) => {
    await assert.rejects(() => suggestNative({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket }), (error) => error.code === "ai_invalid_output");
  });
});

test("native tool-call contract rejects undeclared, malformed and schema-invalid calls", async () => {
  const toolTicket = {
    model: "human-1",
    messages: [{ role: "user", content: "lookup" }],
    tools: [{ function: { name: "lookup", description: "lookup", parameters: { type: "object", required: ["id"], properties: { id: { type: "integer" } } } } }],
  };
  const payloadFor = (call) => ({ choices: [{ message: { content: "", tool_calls: [call] }, finish_reason: "tool_calls" }] });
  await withJsonServer(200, payloadFor({ function: { name: "missing", arguments: "{}" } }), async (endpoint) => {
    await assert.rejects(() => suggestNative({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket: toolTicket }), (error) => error.code === "ai_invalid_tool");
  });
  await withJsonServer(200, payloadFor({ function: { name: "lookup", arguments: "{bad" } }), async (endpoint) => {
    await assert.rejects(() => suggestNative({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket: toolTicket }), (error) => error.code === "ai_invalid_tool_arguments");
  });
  await withJsonServer(200, payloadFor({ function: { name: "lookup", arguments: "{\"id\":\"x\"}" } }), async (endpoint) => {
    await assert.rejects(() => suggestNative({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket: toolTicket }), (error) => error.code === "ai_invalid_tool_arguments");
  });
  await withJsonServer(200, { choices: [{ message: { content: "done" }, finish_reason: "length" }] }, async (endpoint) => {
    await assert.rejects(() => suggestNative({ settings: { endpoint, model: "m" }, apiKey: "sk", ticket: toolTicket }), (error) => error.code === "ai_output_truncated");
  });
});


test("relay forwards image parts, native tools, response format and instructions", async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      received = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok", tool_calls: [] }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await relayReply({
      settings: { endpoint: `http://127.0.0.1:${server.address().port}/v1`, model: "relay-model" },
      apiKey: "sk",
      ticket: {
        messages: [
          { role: "system", content: "base" },
          { role: "user", content: "look", parts: [{ type: "image", url: "data:image/png;base64,AA", detail: "high" }] },
        ],
        tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
        toolChoice: { type: "function", name: "lookup" },
        parallelToolCalls: false,
        responseFormat: { type: "json_object" },
        maxTokens: 12,
        stops: ["END"],
      },
      instruction: "be concise",
    });
    assert.equal(result.content, "ok");
    assert.equal(received.messages[0].content.includes("be concise"), true);
    assert.equal(received.messages[1].content[1].type, "image_url");
    assert.equal(received.messages[1].content[1].image_url.detail, "high");
    assert.deepEqual(received.tool_choice, { type: "function", function: { name: "lookup" } });
    assert.equal(received.parallel_tool_calls, false);
    assert.deepEqual(received.response_format, { type: "json_object" });
    assert.equal(received.max_tokens, 12);
    assert.deepEqual(received.stop, ["END"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("relay rejects missing config and invalid endpoints without network access", async () => {
  await assert.rejects(() => relayReply({ settings: {}, apiKey: "sk", ticket }), (error) => error.code === "ai_not_configured");
  await assert.rejects(() => relayReply({ settings: { endpoint: "http://x", model: "m" }, apiKey: "", ticket }), (error) => error.code === "ai_not_configured");
  await assert.rejects(() => relayReply({ settings: { endpoint: "not a url", model: "m" }, apiKey: "sk", ticket }), (error) => error.code === "ai_invalid_config");
  await assert.rejects(() => relayReply({ settings: { endpoint: "ftp://x", model: "m" }, apiKey: "sk", ticket }), (error) => error.code === "ai_invalid_config");
});
