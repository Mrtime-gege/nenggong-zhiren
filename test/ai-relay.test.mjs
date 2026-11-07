import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("AI reply combines text and validated tool calls", async () => {
  const { suggestWithAi } = await import("../src/ai/assist.mjs");
  let received = "";
  const mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      received = raw;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: `<NGZR_REPLY>\n${JSON.stringify({ text: "我先查一下订单。", tool_calls: [{ name: "LOOKUP_ORDER", arguments: { order_id: "A-1" } }], reason: "用户提供了订单号" })}\n</NGZR_REPLY>` } }],
        usage: { prompt_tokens: 80, completion_tokens: 20 },
      }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const port = mock.address().port;
  try {
    const result = await suggestWithAi({
      settings: {
        endpoint: `http://127.0.0.1:${port}/v1`,
        model: "mock-tool",
        timeoutMs: 5000,
        maxInputChars: 12000,
        maxOutputChars: 4000,
      },
      apiKey: "sk-tool-test",
      ticket: {
        id: "ticket-tool",
        model: "human-1",
        messages: [{ role: "user", content: "查订单 A-1" }],
        tools: [{
          type: "function",
          function: {
            name: "lookup_order",
            description: "查询订单",
            parameters: {
              type: "object",
              properties: { order_id: { type: "string" } },
              required: ["order_id"],
              additionalProperties: false,
            },
          },
        }],
        toolChoice: { type: "function", name: "lookup_order" },
      },
      task: "reply",
    });
    assert.equal(result.suggestion.text, "我先查一下订单。");
    assert.equal(result.suggestion.toolCalls.length, 1);
    assert.equal(result.suggestion.toolCalls[0].name, "lookup_order");
    assert.deepEqual(result.suggestion.toolCalls[0].arguments, { order_id: "A-1" });
    assert.match(received, /可用工具名/);
    assert.match(received, /lookup_order/);
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("native AI mode forwards canonical requests and returns native tool calls", async () => {
  const { suggestNative } = await import("../src/ai/native.mjs");
  let received = "";
  const mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      received = raw;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: "我先查一下。",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "lookup_order", arguments: "{\"order_id\":\"A-1\"}" },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 30, completion_tokens: 12 },
      }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    const result = await suggestNative({
      settings: {
        endpoint: `http://127.0.0.1:${mock.address().port}/v1`,
        model: "native-mock",
        timeoutMs: 5000,
        maxOutputChars: 4000,
      },
      apiKey: "sk-native",
      ticket: {
        id: "native-ticket",
        model: "human-1",
        messages: [{ role: "user", content: "查订单 A-1" }],
        tools: [{
          type: "function",
          function: {
            name: "lookup_order",
            description: "查询订单",
            parameters: {
              type: "object",
              properties: { order_id: { type: "string" } },
              required: ["order_id"],
              additionalProperties: false,
            },
          },
        }],
        toolChoice: "auto",
        parallelToolCalls: true,
      },
    });
    assert.equal(result.native, true);
    assert.equal(result.suggestion.text, "我先查一下。");
    assert.deepEqual(result.suggestion.toolCalls[0].arguments, { order_id: "A-1" });
    const body = JSON.parse(received);
    assert.equal(body.model, "native-mock");
    assert.ok(Array.isArray(body.messages));
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.tools[0].function.name, "lookup_order");
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("native AI extracts tool calls embedded as text", async () => {
  const { suggestNative } = await import("../src/ai/native.mjs");
  const mock = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: '建议正文：先查看目录。\n\n建议的 tool_calls（顺序执行）：\n\n```json\n[{"tool":"bash","arguments":{"description":"查看目录","command":"ls -la"}}]\n```',
          },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    const result = await suggestNative({
      settings: {
        endpoint: `http://127.0.0.1:${mock.address().port}/v1`,
        model: "mock",
        timeoutMs: 5000,
        maxOutputChars: 4000,
      },
      apiKey: "sk",
      ticket: {
        id: "embedded-ticket",
        model: "human-1",
        messages: [{ role: "user", content: "查看目录" }],
        tools: [{ type: "function", function: { name: "bash", parameters: { type: "object", properties: { description: { type: "string" }, command: { type: "string" } }, required: ["description", "command"] } } }],
        toolChoice: "auto",
      },
    });
    assert.equal(result.suggestion.text, "建议正文：先查看目录。");
    assert.equal(result.suggestion.toolCalls[0].name, "bash");
    assert.equal(result.suggestion.toolCalls[0].arguments.command, "ls -la");
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("AI relay forwards the original request without an added system prompt", async () => {
  const { relayReply } = await import("../src/ai/relay.mjs");
  let received = "";
  const mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      received = raw;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: "好的，我来处理。",
            reasoning_content: "先查订单，再确认配送。",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: "{\"id\":\"A-1\"}" },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    const result = await relayReply({
      settings: { endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: "relay-mock", timeoutMs: 5000 },
      apiKey: "sk",
      ticket: {
        id: "relay-ticket",
        messages: [
          { role: "system", content: "caller system" },
          { role: "user", content: "查订单" },
        ],
        tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } }],
        toolChoice: "auto",
        parallelToolCalls: true,
      },
    });
    assert.equal(result.content, "好的，我来处理。");
    assert.equal(result.reasoning, "先查订单，再确认配送。");
    assert.equal(result.toolCalls[0].name, "lookup");
    assert.equal(result.toolCalls[0].arguments, "{\"id\":\"A-1\"}");
    assert.deepEqual(result.toolCalls[0].parsedArguments, { id: "A-1" });
    const body = JSON.parse(received);
    assert.deepEqual(body.messages, [
      { role: "system", content: "caller system" },
      { role: "user", content: "查订单" },
    ]);
    assert.equal(body.model, "relay-mock");
    assert.equal(body.messages.length, 2);
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("AI relay caps forwarded messages before appending operator guidance", async () => {
  const { relayReply } = await import("../src/ai/relay.mjs");
  let received = null;
  const mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      received = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 1 },
      }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    await relayReply({
      settings: {
        endpoint: `http://127.0.0.1:${mock.address().port}/v1`,
        model: "relay-mock",
        timeoutMs: 5000,
        maxInputChars: 50_000,
      },
      apiKey: "sk",
      ticket: {
        id: "long-thread",
        messages: Array.from({ length: 300 }, (_, index) => ({ role: "user", content: `m${index}` })),
        tools: [],
        toolChoice: "auto",
      },
      instruction: "保持简短",
    });
    assert.ok(received.messages.length <= 256);
    assert.equal(received.messages.length, 256);
    assert.equal(received.messages[0].role, "system");
    assert.match(received.messages[0].content, /保持简短/);
    assert.equal(received.messages.at(-1).content, "m299");
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("model output speed is per-model, persisted, and validates range", async () => {
  const { ModelStore } = await import("../src/data/models.mjs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "ngzr-model-speed-"));
  const file = path.join(dir, "models.json");
  try {
    const store = new ModelStore({ file, seed: [{ id: "human-1", name: "Human 1" }], logger: { log() {}, error() {} } }).init();
    const slow = store.add({ id: "human-slow", name: "Slow", speedMs: 0 });
    const fast = store.add({ id: "human-fast", name: "Fast", speedMs: 120 });
    assert.equal(slow.speedMs, 0);
    assert.equal(fast.speedMs, 120);
    const updated = store.update("human-slow", { speedMs: 45 });
    assert.equal(updated.speedMs, 45);
    assert.equal(store.get("human-fast").speedMs, 120);
    assert.throws(() => store.update("human-fast", { speedMs: 60001 }), (error) => error.code === "invalid_model_speed");
    const reloaded = new ModelStore({ file, logger: { log() {}, error() {} } }).init();
    assert.equal(reloaded.get("human-slow").speedMs, 45);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AI relay strips textual tool annotations while preserving native tool calls", async () => {
  const { relayReply } = await import("../src/ai/relay.mjs");
  let received = "";
  const mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      received = raw;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: "好的，开始执行。\n[tool use: shell_open]\n\n已调用工具",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "shell_open", arguments: "{\"tasks\":[{\"action\":{\"kind\":\"open\"}}]}" },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    const result = await relayReply({
      settings: { endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: "mock", timeoutMs: 5000 },
      apiKey: "sk",
      ticket: {
        id: "tool-annotation-ticket",
        messages: [{ role: "user", content: "请执行任务\n[tool use: shell_open]\n已调用工具" }],
        tools: [{ type: "function", function: { name: "shell_open", parameters: { type: "object", properties: { tasks: { type: "array" } }, required: ["tasks"] } } }],
        toolChoice: "auto",
      },
    });
    assert.equal(result.content, "好的，开始执行。");
    assert.equal(result.toolCalls[0].name, "shell_open");
    const body = JSON.parse(received);
    assert.equal(body.messages[0].content, "请执行任务");
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("AI relay appends an optional operator instruction", async () => {
  const { relayReply } = await import("../src/ai/relay.mjs");
  let received = "";
  const mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      received = raw;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: "简要回复" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    await relayReply({
      settings: { endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: "mock", timeoutMs: 5000 },
      apiKey: "sk",
      ticket: { id: "prompt-ticket", messages: [{ role: "user", content: "原始请求" }], tools: [] },
      instruction: "回答更简短，先确认订单号",
    });
    const body = JSON.parse(received);
    assert.equal(body.messages[0].role, "system");
    assert.match(body.messages[0].content, /回答更简短/);
    assert.match(body.messages[0].content, /当前情况/);
    assert.match(body.messages[0].content, /辅助模型/);
    assert.match(body.messages[0].content, /不是调用方的新消息/);
    assert.match(body.messages[0].content, /不要以任何形式透露/);
    assert.match(body.messages[0].content, /不得在正文/);
    assert.match(body.messages[0].content, /根据要求/);
    assert.equal(body.messages[1].content, "原始请求");
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("AI relay streams chat-completion chunks", async () => {
  const { relayReply } = await import("../src/ai/relay.mjs");
  const mock = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}\n\n`);
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "流式" } }] })}\n\n`);
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "结果" }, finish_reason: "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      }, 30);
    }, 30);
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    const result = await relayReply({
      settings: { endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: "stream-mock" },
      apiKey: "sk",
      ticket: { id: "stream-ticket", messages: [{ role: "user", content: "stream" }], tools: [] },
    });
    assert.equal(result.content, "流式结果");
    assert.equal(result.finishReason, "stop");
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("AI relay keeps only the newest 255 messages", async () => {
  const { relayReply } = await import("../src/ai/relay.mjs");
  let received = "";
  const mock = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      received = raw;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    const messages = Array.from({ length: 300 }, (_, index) => ({ role: "user", content: `message-${index}` }));
    await relayReply({
      settings: { endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: "mock" },
      apiKey: "sk",
      ticket: { id: "message-limit-ticket", messages, tools: [] },
    });
    const body = JSON.parse(received);
    assert.equal(body.messages.length, 255);
    assert.equal(body.messages.at(-1).content, "message-299");
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("AI relay exposes safe upstream diagnostics", async () => {
  const { relayReply } = await import("../src/ai/relay.mjs");
  const mock = http.createServer((req, res) => {
    req.resume();
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "provider unavailable" } }));
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(
      () => relayReply({
        settings: { endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: "mock" },
        apiKey: "sk",
        ticket: { id: "diagnostic-ticket", messages: [{ role: "user", content: "hello" }], tools: [] },
      }),
      (error) => {
        assert.equal(error.code, "ai_provider_error");
        assert.equal(error.stage, "upstream_http");
        assert.equal(error.upstreamStatus, 503);
        assert.equal(error.partialOutput, false);
        return true;
      },
    );
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

