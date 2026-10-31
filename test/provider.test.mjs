import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 19000 + Math.floor(Math.random() * 700);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "ngzr-test-"));
const PROJECT = path.join(DATA_DIR, "project");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const API_KEYS_FILE = path.join(DATA_DIR, "api-keys.json");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");
const ADMIN = "admin";
const ADMIN_PASSWORD = `test-${randomBytes(12).toString("base64url")}`;
const ALICE_PASSWORD = `test-${randomBytes(12).toString("base64url")}`;
const BOB_PASSWORD = `test-${randomBytes(12).toString("base64url")}`;
const CALLER_KEY = `sk-test-${randomBytes(8).toString("hex")}`;
let child;
let serverLog = "";
let adminSession;
let aliceSession;
let bobSession;
let markerSeq = 0;

function copyProject(destination = PROJECT) {
  mkdirSync(destination, { recursive: true });
  for (const entry of ["server.mjs", "src", "public", "scripts", "docs", "package.json"]) {
    cpSync(path.join(ROOT, entry), path.join(destination, entry), { recursive: true });
  }
  return destination;
}

function writeConfig(project, { port, usersFile, apiKeysFile, waitMs = 3000, responseMs = 15000 } = {}) {
  const config = {
    server: {
      host: "127.0.0.1",
      port,
      cookieSecure: "auto",
      trustedHosts: [],
      corsOrigins: ["*"],
    },
    storage: {
      usersFile,
      apiKeysFile,
      stateFile: path.join(path.dirname(usersFile), `state-${port}.json`),
      usageFile: path.join(path.dirname(usersFile), `usage-${port}.json`),
    },
    auth: {
      sessionTtlMs: 43200000,
      sessionIdleMs: 7200000,
      loginRateWindowMs: 300000,
      loginIpMaxFailures: 10,
      loginUserMaxFailures: 5,
    },
    queue: {
      waitTimeoutMs: waitMs,
      responseTimeoutMs: responseMs,
      retentionMs: 30000,
      streamDelayMs: 1,
    },
    limits: { maxConcurrentPerKey: 4, bodyLimitBytes: 2097152 },
    attachments: { reencodeImages: true, pdfPagePreview: true },
    models: { ids: ["human-1", "human-1-fast"], default: "human-1" },
    tls: { enabled: false, certFile: "", keyFile: "" },
    logging: { content: false },
  };
  writeFileSync(path.join(project, "config.jsonc"), JSON.stringify(config, null, 2));
}

async function seedApiKey(file, token, name = "test-caller") {
  const { ApiKeyStore } = await import("../src/data/api-keys.mjs");
  const store = new ApiKeyStore({ file, logger: { log() {}, error() {} } }).init();
  store.importKey(token, name);
  store.close();
}

function runCli(args, password = "", project = PROJECT) {
  return new Promise((resolve, reject) => {
    const cli = spawn(process.execPath, ["scripts/user.mjs", ...args], {
      cwd: project,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    cli.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    cli.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    cli.on("error", reject);
    cli.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new Error(`CLI failed (${code}): ${stderr || stdout}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
    cli.stdin.end(password ? `${password}\n` : "");
  });
}

function spawnServer(project, port, output = () => {}) {
  const proc = spawn(process.execPath, ["server.mjs"], {
    cwd: project,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (chunk) => output(chunk.toString()));
  proc.stderr.on("data", (chunk) => output(chunk.toString()));
  return proc;
}

function marker(label) {
  markerSeq += 1;
  return `TEST-${label}-${Date.now()}-${markerSeq}`;
}


async function waitForHealth(origin = BASE, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {
      /* not ready */
    }
    await sleep(40);
  }
  throw new Error(`server did not start:\n${serverLog}`);
}

before(async () => {
  copyProject();
  writeConfig(PROJECT, { port: PORT, usersFile: USERS_FILE, apiKeysFile: API_KEYS_FILE });
  await seedApiKey(API_KEYS_FILE, CALLER_KEY);
  await runCli(["add", ADMIN, "--role", "admin"], ADMIN_PASSWORD);
  await runCli(["add", "alice", "--role", "operator"], ALICE_PASSWORD);
  await runCli(["add", "bob", "--role", "operator"], BOB_PASSWORD);

  child = spawnServer(PROJECT, PORT, (chunk) => {
    serverLog += chunk;
  });
  await waitForHealth();

  adminSession = await session(ADMIN, ADMIN_PASSWORD);
  aliceSession = await session("alice", ALICE_PASSWORD);
  bobSession = await session("bob", BOB_PASSWORD);
});

after(() => {
  child?.kill("SIGKILL");
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

function login(username, password, { origin = BASE, next = "/console" } = {}) {
  const form = new URLSearchParams({ username, password, next });
  return fetch(`${BASE}/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(origin === null ? {} : { Origin: origin }),
    },
    body: form,
  });
}

function setCookieFrom(response) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  return (cookies[0] || "").split(";")[0];
}

async function session(username, password) {
  const response = await login(username, password);
  assert.equal(response.status, 303, await response.text());
  const cookie = setCookieFrom(response);
  assert.match(cookie, /^ngzr_session=/);
  const meResponse = await fetch(`${BASE}/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(meResponse.status, 200);
  const me = await meResponse.json();
  return { username, password, cookie, csrf: me.csrfToken, user: me.user };
}

async function op(ctx, pathname, { method = "GET", body } = {}) {
  const headers = { Cookie: ctx.cookie };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = ctx.csrf;
  return fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function opJson(ctx, pathname, options) {
  const response = await op(ctx, pathname, options);
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

async function waitForTicket(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await opJson(adminSession, "/op/api/tickets");
    const ticket = data.tickets.find(predicate);
    if (ticket) return ticket;
    await sleep(20);
  }
  throw new Error("ticket did not appear");
}

async function startChat(body, extra = {}) {
  return fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CALLER_KEY}`,
      "Content-Type": "application/json",
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

async function startMessages(body) {
  return fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": CALLER_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function collectAnthropicSse(response) {
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let event = "";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (event || data) events.push({ event, data: data ? JSON.parse(data) : null });
    }
  }
  return events;
}

async function claim(ctx, ticketId) {
  return opJson(ctx, `/op/api/tickets/${ticketId}/claim`, { method: "POST", body: {} });
}

async function finish(ctx, ticketId, body = {}) {
  return op(ctx, `/op/api/tickets/${ticketId}/finish`, { method: "POST", body });
}

async function finishJson(ctx, ticketId, body = {}) {
  return opJson(ctx, `/op/api/tickets/${ticketId}/finish`, { method: "POST", body });
}

async function collectSse(response) {
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          events.push({ done: true });
        } else if (payload) {
          events.push(JSON.parse(payload));
        }
      }
    }
  }
  return events;
}

function deltaText(events) {
  return events
    .filter((event) => !event.done && typeof event.choices?.[0]?.delta?.content === "string")
    .map((event) => event.choices[0].delta.content)
    .join("");
}

function rawRequest(pathname, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port: PORT, path: pathname, method, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

test("login page and protected routes", async () => {
  const page = await fetch(`${BASE}/login`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.match(page.headers.get("x-request-id"), /^req_/);

  const consoleResponse = await fetch(`${BASE}/console`, { redirect: "manual" });
  assert.equal(consoleResponse.status, 302);
  assert.equal(consoleResponse.headers.get("location"), "/login?next=%2Fconsole");

  const opResponse = await fetch(`${BASE}/op/api/tickets`);
  assert.equal(opResponse.status, 401);

  const modelsResponse = await fetch(`${BASE}/v1/models`);
  assert.equal(modelsResponse.status, 401);
});

test("only embedded console pages allow same-origin framing", async () => {
  const embedded = await fetch(`${BASE}/console/users?embed=1`, { redirect: "manual" });
  assert.equal(embedded.status, 302);
  assert.match(embedded.headers.get("content-security-policy"), /frame-ancestors 'self'/);
  assert.equal(embedded.headers.get("x-frame-options"), "SAMEORIGIN");

  const normal = await fetch(`${BASE}/console/users`, { redirect: "manual" });
  assert.match(normal.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(normal.headers.get("x-frame-options"), "DENY");
});

test("login creates a strict HttpOnly session and CSRF is required", async () => {
  const response = await login(ADMIN, ADMIN_PASSWORD);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/console#status");
  const setCookie = response.headers.getSetCookie()[0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.doesNotMatch(setCookie, /Secure/);
  const cookie = setCookie.split(";")[0];

  const me = await fetch(`${BASE}/auth/me`, { headers: { Cookie: cookie } }).then((r) => r.json());
  assert.equal(me.user.username, ADMIN);
  assert.equal(me.user.role, "admin");
  const csrf = me.csrfToken;

  const claimNoCsrf = await fetch(`${BASE}/op/api/tickets/not-a-ticket/claim`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(claimNoCsrf.status, 403);

  const claimWrongCsrf = await fetch(`${BASE}/op/api/tickets/not-a-ticket/claim`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": "wrong",
    },
    body: "{}",
  });
  assert.equal(claimWrongCsrf.status, 403);

  const claimWithCsrf = await fetch(`${BASE}/op/api/tickets/not-a-ticket/claim`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body: "{}",
  });
  assert.equal(claimWithCsrf.status, 404);

  const logout = await fetch(`${BASE}/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie, "X-CSRF-Token": csrf },
  });
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${BASE}/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401);
});

test("wrong password and unknown user return the same generic error", async () => {
  const wrong = await login(ADMIN, "definitely-wrong-password");
  assert.equal(wrong.status, 401);
  const wrongBody = await wrong.text();
  assert.match(wrongBody, /用户名或密码错误/);

  const unknown = await login("no-such-user", "definitely-wrong-password");
  assert.equal(unknown.status, 401);
  const unknownBody = await unknown.text();
  assert.match(unknownBody, /用户名或密码错误/);
  assert.doesNotMatch(unknownBody, /不存在/);
});

test("CLI users, multi-user login and last-admin protection", async () => {
  const list = await runCli(["list"]);
  assert.match(list.stdout, /admin\tadmin/);
  assert.match(list.stdout, /alice\toperator/);
  assert.match(list.stdout, /bob\toperator/);
  assert.equal(adminSession.user.role, "admin");
  assert.equal(aliceSession.user.username, "alice");
  assert.equal(bobSession.user.username, "bob");

  await assert.rejects(
    () => runCli(["remove", ADMIN]),
    (error) => /最后一个管理员/.test(error.stderr),
  );
});

test("models and rate-limit/request-id headers", async () => {
  const models = await fetch(`${BASE}/v1/models`, {
    headers: { Authorization: `Bearer ${CALLER_KEY}` },
  });
  assert.equal(models.status, 200);
  const body = await models.json();
  assert.equal(body.object, "list");
  assert.ok(body.data.some((model) => model.id === "human-1"));
  assert.equal(models.headers.get("x-ratelimit-limit-requests"), "4");
  assert.match(models.headers.get("x-ratelimit-remaining-requests"), /^\d+$/);
  assert.match(models.headers.get("x-request-id"), /^req_/);

  const invalid = await fetch(`${BASE}/v1/models`, {
    headers: { Authorization: "Bearer wrong" },
  });
  assert.equal(invalid.status, 401);

  const cors = await fetch(`${BASE}/v1/models`, {
    headers: {
      Authorization: `Bearer ${CALLER_KEY}`,
      Origin: "http://web.example",
    },
  });
  assert.equal(cors.status, 200);
  assert.equal(cors.headers.get("access-control-allow-origin"), "*");

  const preflight = await fetch(`${BASE}/v1/chat/completions`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://web.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
});

test("explicitly unsupported protocol fields are rejected", async () => {
  const n2 = await startChat({
    model: "human-1",
    n: 2,
    messages: [{ role: "user", content: "n>1" }],
  });
  assert.equal(n2.status, 400);
  assert.equal((await n2.json()).error.code, "unsupported_n");

  const logprobs = await startChat({
    model: "human-1",
    logprobs: true,
    messages: [{ role: "user", content: "logprobs" }],
  });
  assert.equal(logprobs.status, 400);
  assert.equal((await logprobs.json()).error.code, "unsupported_logprobs");

  const responses = await fetch(`${BASE}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CALLER_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(responses.status, 404);
});

test("non-stream completion, usage details and operator attribution", async () => {
  const tag = marker("nonstream");
  const pending = startChat({
    model: "human-1",
    messages: [{ role: "user", content: tag }],
  });
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  await claim(adminSession, ticket.id);
  await finishJson(adminSession, ticket.id, { text: "hello from admin" });

  const response = await pending;
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.object, "chat.completion");
  assert.equal(body.choices[0].message.content, "hello from admin");
  assert.equal(body.choices[0].finish_reason, "stop");
  assert.equal(body.usage.prompt_tokens_details.cached_tokens, 0);
  assert.equal(body.usage.completion_tokens_details.reasoning_tokens, 0);
  assert.equal(response.headers.get("x-ratelimit-limit-requests"), "4");
  assert.match(response.headers.get("x-request-id"), /^req_/);
});

test("stream completion emits role, content, finish, usage and [DONE]", async () => {
  const tag = marker("stream");
  const pending = startChat({
    model: "human-1-fast",
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: tag }],
  });
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  await claim(adminSession, ticket.id);
  const response = await pending;
  const eventsPromise = collectSse(response);
  await finishJson(adminSession, ticket.id, { text: "streamed answer" });
  const events = await eventsPromise;
  assert.equal(deltaText(events), "streamed answer");
  assert.ok(events.some((event) => event.choices?.[0]?.delta?.role === "assistant"));
  assert.ok(events.some((event) => event.choices?.[0]?.finish_reason === "stop"));
  assert.ok(events.some((event) => event.usage?.total_tokens > 0));
  assert.ok(events.at(-1).done);
});

test("reasoning can stream before tool calls", async () => {
  const tag = marker("reasoning-stream");
  const tool = {
    type: "function",
    function: {
      name: "get_weather",
      description: "weather",
      parameters: {
        type: "object",
        properties: { city: { type: "string", minLength: 1 } },
        required: ["city"],
        additionalProperties: false,
      },
    },
  };
  const pending = startChat({
    model: "human-1",
    stream: true,
    tools: [tool],
    messages: [{ role: "user", content: tag }],
  });
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  await claim(adminSession, ticket.id);
  const response = await pending;
  const eventsPromise = collectSse(response);
  const reasoning = await opJson(adminSession, `/op/api/tickets/${ticket.id}/reasoning`, {
    method: "POST",
    body: { text: "先检查天气工具，再返回结果。" },
  });
  assert.equal(reasoning.ok, true);
  await finishJson(adminSession, ticket.id, {
    toolCalls: [{ name: "get_weather", arguments: { city: "北京" } }],
  });
  const events = await eventsPromise;
  const reasoningText = events
    .filter((event) => !event.done && typeof event.choices?.[0]?.delta?.reasoning_content === "string")
    .map((event) => event.choices[0].delta.reasoning_content)
    .join("");
  assert.equal(reasoningText, "先检查天气工具，再返回结果。");
  assert.ok(events.some((event) => event.choices?.[0]?.delta?.tool_calls?.length));
  assert.ok(events.some((event) => event.choices?.[0]?.finish_reason === "tool_calls"));
  assert.ok(events.at(-1).done);
});

test("tool arguments are validated against JSON Schema", async () => {
  const tag = marker("schema");
  const tool = {
    type: "function",
    function: {
      name: "get_weather",
      description: "weather",
      parameters: {
        type: "object",
        properties: { city: { type: "string", minLength: 1 } },
        required: ["city"],
        additionalProperties: false,
      },
    },
  };
  const pending = startChat({
    model: "human-1",
    tools: [tool],
    messages: [{ role: "user", content: tag }],
  });
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  await claim(adminSession, ticket.id);

  const missing = await finish(adminSession, ticket.id, {
    toolCalls: [{ name: "get_weather", arguments: {} }],
  });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.code, "invalid_tool_arguments");

  const empty = await finish(adminSession, ticket.id, {
    toolCalls: [{ name: "get_weather", arguments: { city: "" } }],
  });
  assert.equal(empty.status, 400);

  const unknown = await finish(adminSession, ticket.id, {
    toolCalls: [{ name: "other", arguments: {} }],
  });
  assert.equal(unknown.status, 400);

  await finishJson(adminSession, ticket.id, {
    toolCalls: [{ name: "get_weather", arguments: { city: "上海" } }],
  });
  const response = await pending;
  const body = await response.json();
  assert.equal(body.choices[0].finish_reason, "tool_calls");
  assert.equal(body.choices[0].message.content, null);
  assert.equal(body.choices[0].message.tool_calls[0].function.name, "get_weather");
  assert.deepEqual(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments), {
    city: "上海",
  });
});

test("response_format buffers and rejects invalid JSON until fixed", async () => {
  const tag = marker("json");
  const pending = startChat({
    model: "human-1",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: tag }],
  });
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  await claim(adminSession, ticket.id);

  const invalid = await finish(adminSession, ticket.id, {
    text: "not json",
    replaceText: true,
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "invalid_response_json");

  await finishJson(adminSession, ticket.id, {
    text: '{"ok":true}',
    replaceText: true,
  });
  const response = await pending;
  const body = await response.json();
  assert.deepEqual(JSON.parse(body.choices[0].message.content), { ok: true });
  assert.equal(body.choices[0].finish_reason, "stop");
});

test("response_format json_schema validates the returned object", async () => {
  const tag = marker("json-schema");
  const pending = startChat({
    model: "human-1",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "answer",
        strict: true,
        schema: {
          type: "object",
          properties: { answer: { type: "string", minLength: 1 } },
          required: ["answer"],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: "user", content: tag }],
  });
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  await claim(adminSession, ticket.id);
  const invalid = await finish(adminSession, ticket.id, {
    text: '{"answer":""}',
    replaceText: true,
  });
  assert.equal(invalid.status, 400);
  await finishJson(adminSession, ticket.id, {
    text: '{"answer":"ok"}',
    replaceText: true,
  });
  const body = await (await pending).json();
  assert.deepEqual(JSON.parse(body.choices[0].message.content), { answer: "ok" });
});

test("streaming Idempotency-Key replays the same SSE bytes", async () => {
  const tag = marker("idem-stream");
  const body = {
    model: "human-1",
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: tag }],
  };
  const headers = { "Idempotency-Key": "test-idempotency-stream" };
  const firstPending = startChat(body, headers);
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  await claim(adminSession, ticket.id);
  const firstResponse = await firstPending;
  const firstEventsPromise = collectSse(firstResponse);
  await finishJson(adminSession, ticket.id, { text: "stream idempotent" });
  const firstEvents = await firstEventsPromise;

  const replayResponse = await startChat(body, headers);
  const replayEvents = await collectSse(replayResponse);
  assert.equal(deltaText(firstEvents), deltaText(replayEvents));
  assert.equal(
    firstEvents.find((event) => event.choices?.[0]?.finish_reason)?.choices[0].finish_reason,
    replayEvents.find((event) => event.choices?.[0]?.finish_reason)?.choices[0].finish_reason,
  );
});

test("non-stream reasoning content is returned and counted", async () => {
  const tag = marker("reasoning-json");
  const pending = startChat({
    model: "human-1",
    messages: [{ role: "user", content: tag }],
  });
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  await claim(adminSession, ticket.id);
  await finishJson(adminSession, ticket.id, { text: "answer", reasoning: "thinking" });
  const body = await (await pending).json();
  assert.equal(body.choices[0].message.reasoning_content, "thinking");
  assert.ok(body.usage.completion_tokens_details.reasoning_tokens > 0);
});

test("refusal returns refusal + content_filter (non-stream and stream)", async () => {
  const tag = marker("refusal");
  const pending = startChat({
    model: "human-1",
    messages: [{ role: "user", content: tag }],
  });
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  await claim(adminSession, ticket.id);
  await finishJson(adminSession, ticket.id, { refusal: "无法协助这个请求。" });
  const body = await (await pending).json();
  assert.equal(body.choices[0].message.content, null);
  assert.equal(body.choices[0].message.refusal, "无法协助这个请求。");
  assert.equal(body.choices[0].finish_reason, "content_filter");

  const tag2 = marker("refusal-stream");
  const pending2 = startChat({
    model: "human-1",
    stream: true,
    messages: [{ role: "user", content: tag2 }],
  });
  const ticket2 = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag2)));
  await claim(adminSession, ticket2.id);
  const response = await pending2;
  const eventsPromise = collectSse(response);
  await finishJson(adminSession, ticket2.id, { refusal: "不能帮助。" });
  const events = await eventsPromise;
  assert.ok(events.some((event) => event.choices?.[0]?.delta?.refusal));
  assert.ok(events.some((event) => event.choices?.[0]?.finish_reason === "content_filter"));
});

test("reasoning is streamed separately and counted in usage", async () => {
  const tag = marker("reasoning");
  const pending = startChat({
    model: "human-1",
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: tag }],
  });
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  await claim(adminSession, ticket.id);
  const response = await pending;
  const eventsPromise = collectSse(response);
  await finishJson(adminSession, ticket.id, {
    text: "最终答案。",
    reasoning: "先分析，再回答。",
  });
  const events = await eventsPromise;
  const reasoning = events
    .filter((event) => typeof event.choices?.[0]?.delta?.reasoning_content === "string")
    .map((event) => event.choices[0].delta.reasoning_content)
    .join("");
  assert.equal(reasoning, "先分析，再回答。");
  assert.equal(deltaText(events), "最终答案。");
  const usage = events.find((event) => event.usage)?.usage;
  assert.ok(usage.completion_tokens_details.reasoning_tokens > 0);
});

test("Idempotency-Key replays completed requests, joins active ones and rejects conflicts", async () => {
  const tag = marker("idem");
  const body = { model: "human-1", messages: [{ role: "user", content: tag }] };
  const headers = { "Idempotency-Key": "test-idempotency-1" };
  const firstPending = startChat(body, headers);
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  await claim(adminSession, ticket.id);
  await finishJson(adminSession, ticket.id, { text: "same answer" });
  const first = await firstPending;
  const firstBody = await first.json();

  const replay = await startChat(body, headers);
  const replayBody = await replay.json();
  assert.equal(replayBody.id, firstBody.id);
  assert.equal(replayBody.choices[0].message.content, "same answer");

  const conflict = await startChat(
    { model: "human-1", messages: [{ role: "user", content: `${tag}-different` }] },
    headers,
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "idempotency_key_conflict");

  const activeTag = marker("idem-active");
  const activeBody = { model: "human-1", messages: [{ role: "user", content: activeTag }] };
  const activeHeaders = { "Idempotency-Key": "test-idempotency-2" };
  const activeFirst = startChat(activeBody, activeHeaders);
  const activeTicket = await waitForTicket((item) =>
    item.messages.some((m) => m.content.includes(activeTag)),
  );
  const activeSecond = startChat(activeBody, activeHeaders);
  await sleep(80);
  const activeList = await opJson(adminSession, "/op/api/tickets");
  assert.equal(
    activeList.tickets.filter((item) => item.messages.some((m) => m.content.includes(activeTag))).length,
    1,
  );
  await claim(adminSession, activeTicket.id);
  await finishJson(adminSession, activeTicket.id, { text: "active answer" });
  const [a, b] = await Promise.all([activeFirst, activeSecond]);
  assert.equal((await a.json()).id, (await b.json()).id);
});

test("image input becomes an operator attachment", async () => {
  const tag = marker("image");
  const pending = startChat({
    model: "human-1",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: tag },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      },
    ],
  });
  const ticket = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tag)));
  assert.equal(ticket.attachments.length, 1);
  assert.match(ticket.attachments[0].url, /^data:image\/png/);
  await claim(adminSession, ticket.id);
  await finishJson(adminSession, ticket.id, { text: "image seen" });
  assert.equal((await pending).status, 200);
});

test("two logged-in operators claim different tickets; attribution is by username", async () => {
  const tagA = marker("alice");
  const tagB = marker("bob");
  const pendingA = startChat({ model: "human-1", messages: [{ role: "user", content: tagA }] });
  const pendingB = startChat({ model: "human-1", messages: [{ role: "user", content: tagB }] });
  const ticketA = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tagA)));
  const ticketB = await waitForTicket((item) => item.messages.some((m) => m.content.includes(tagB)));

  await claim(aliceSession, ticketA.id);
  await claim(bobSession, ticketB.id);
  const queue = await opJson(adminSession, "/op/api/tickets");
  const claimedA = queue.tickets.find((item) => item.id === ticketA.id);
  const claimedB = queue.tickets.find((item) => item.id === ticketB.id);
  assert.equal(claimedA.claimedBy, "alice");
  assert.equal(claimedB.claimedBy, "bob");

  const crossClaim = await op(aliceSession, `/op/api/tickets/${ticketB.id}/claim`, {
    method: "POST",
    body: {},
  });
  assert.equal(crossClaim.status, 409);

  await finishJson(aliceSession, ticketA.id, { text: "alice answer" });
  await finishJson(bobSession, ticketB.id, { text: "bob answer" });
  assert.equal((await pendingA).status, 200);
  assert.equal((await pendingB).status, 200);
});

test("ticket actions are restricted to the claimant", async () => {
  const text = marker("owner-only");
  const pending = startChat({ model: "human-1", messages: [{ role: "user", content: text }] });
  const ticket = await waitForTicket((item) => item.messages?.some((message) => message.content === text));
  assert.equal((await op(aliceSession, `/op/api/tickets/${ticket.id}/claim`, { method: "POST" })).status, 200);

  for (const [action, body] of [
    ["chunk", { text: "INJECTED" }],
    ["finish", { text: "HACKED", finishReason: "stop" }],
    ["release", {}],
    ["cancel", {}],
    ["transfer", { to: "bob" }],
  ]) {
    const response = await op(bobSession, `/op/api/tickets/${ticket.id}/${action}`, { method: "POST", body });
    assert.equal(response.status, 403, action);
  }

  // Same action, but the wrong CSRF source or no CSRF must not pass either.
  const noCsrf = await fetch(`${BASE}/op/api/tickets/${ticket.id}/finish`, {
    method: "POST",
    headers: { Cookie: bobSession.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "NO-CSRF", finishReason: "stop" }),
  });
  assert.equal(noCsrf.status, 403);
  const crossCsrf = await fetch(`${BASE}/op/api/tickets/${ticket.id}/finish`, {
    method: "POST",
    headers: {
      Cookie: bobSession.cookie,
      "X-CSRF-Token": aliceSession.csrf,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: "CROSS-CSRF", finishReason: "stop" }),
  });
  assert.equal(crossCsrf.status, 403);

  // Alternate method/path variants must not bypass the owner check.
  const wrongMethod = await fetch(`${BASE}/op/api/tickets/${ticket.id}/finish`, {
    method: "PUT",
    headers: { Cookie: bobSession.cookie, "X-CSRF-Token": bobSession.csrf, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "WRONG-METHOD", finishReason: "stop" }),
  });
  assert.equal(wrongMethod.status, 405);
  for (const suffix of ["finish/", "%66inish", "finish?bypass=1"]) {
    const response = await op(bobSession, `/op/api/tickets/${ticket.id}/${suffix}`, {
      method: "POST",
      body: { text: "PATH-VARIANT", finishReason: "stop" },
    });
    assert.ok([403, 404, 405].includes(response.status), suffix);
  }

  // Admin has explicit cancel/transfer powers, but not implicit edit/finish.
  for (const [action, body] of [
    ["chunk", { text: "ADMIN-INJECT" }],
    ["finish", { text: "ADMIN-FINISH", finishReason: "stop" }],
    ["release", {}],
  ]) {
    const response = await op(adminSession, `/op/api/tickets/${ticket.id}/${action}`, { method: "POST", body });
    assert.equal(response.status, 403, `admin ${action}`);
  }
  assert.equal((await opJson(adminSession, `/op/api/tickets/${ticket.id}`)).ticket.text, "");
  assert.equal((await op(adminSession, `/op/api/tickets/${ticket.id}/cancel`, { method: "POST" })).status, 200);
  await (await pending).text();

  // Positive control: an admin transfer changes the owner, then that owner can finish.
  const transferText = marker("transfer-owner");
  const transferPending = startChat({ model: "human-1", messages: [{ role: "user", content: transferText }] });
  const transferTicket = await waitForTicket((item) => item.messages?.some((message) => message.content === transferText));
  assert.equal((await op(aliceSession, `/op/api/tickets/${transferTicket.id}/claim`, { method: "POST" })).status, 200);
  assert.equal(
    (await op(adminSession, `/op/api/tickets/${transferTicket.id}/transfer`, { method: "POST", body: { to: "bob" } })).status,
    200,
  );
  assert.equal(
    (await op(bobSession, `/op/api/tickets/${transferTicket.id}/finish`, {
      method: "POST",
      body: { text: "OK", finishReason: "stop" },
    })).status,
    200,
  );
  assert.equal((await transferPending).status, 200);
});

test("admin user management API and role checks", async () => {
  const webUser = "webuser";
  const webPassword = `test-${randomBytes(12).toString("base64url")}`;
  const newPassword = `test-${randomBytes(12).toString("base64url")}`;

  const list = await opJson(adminSession, "/op/api/users");
  assert.ok(list.users.some((user) => user.username === ADMIN && user.role === "admin"));
  assert.ok(list.users.every((user) => !("hash" in user) && !("salt" in user)));

  const forbidden = await op(aliceSession, "/op/api/users");
  assert.equal(forbidden.status, 403);

  const created = await op(adminSession, "/op/api/users", {
    method: "POST",
    body: { username: webUser, password: webPassword, role: "operator" },
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).user.username, webUser);
  assert.equal(
    await fetch(`${BASE}/auth/me`, { headers: { Cookie: adminSession.cookie } }).then((r) => r.status),
    200,
  );

  const duplicate = await op(adminSession, "/op/api/users", {
    method: "POST",
    body: { username: webUser, password: webPassword, role: "operator" },
  });
  assert.equal(duplicate.status, 409);

  const weak = await op(adminSession, "/op/api/users", {
    method: "POST",
    body: { username: "weakuser", password: "short", role: "operator" },
  });
  assert.equal(weak.status, 400);

  const seven = await op(adminSession, "/op/api/users", {
    method: "POST",
    body: { username: "sevenuser", password: "1234567", role: "operator" },
  });
  assert.equal(seven.status, 400);

  // Length is the hard rule. Common passwords are advisory only in the UI.
  const eight = await op(adminSession, "/op/api/users", {
    method: "POST",
    body: { username: "eightuser", password: "12345678", role: "operator" },
  });
  assert.equal(eight.status, 201);
  await op(adminSession, "/op/api/users/eightuser", { method: "DELETE" });

  const webSession = await session(webUser, webPassword);
  assert.equal(webSession.user.role, "operator");
  const nonAdminCreate = await op(webSession, "/op/api/users", {
    method: "POST",
    body: { username: "shouldnotexist", password: newPassword, role: "operator" },
  });
  assert.equal(nonAdminCreate.status, 403);

  const reset = await op(adminSession, `/op/api/users/${webUser}`, {
    method: "PATCH",
    body: { password: newPassword },
  });
  assert.equal(reset.status, 200);
  assert.equal((await login(webUser, webPassword)).status, 401);
  assert.equal((await login(webUser, newPassword)).status, 303);

  const promote = await op(adminSession, `/op/api/users/${webUser}`, {
    method: "PATCH",
    body: { role: "admin" },
  });
  assert.equal(promote.status, 200);
  const promoted = await session(webUser, newPassword);
  assert.equal(promoted.user.role, "admin");

  const selfRole = await op(adminSession, `/op/api/users/${ADMIN}`, {
    method: "PATCH",
    body: { role: "operator" },
  });
  assert.equal(selfRole.status, 409);

  const selfDelete = await op(adminSession, `/op/api/users/${ADMIN}`, { method: "DELETE" });
  assert.equal(selfDelete.status, 409);

  const removed = await op(adminSession, `/op/api/users/${webUser}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.equal((await login(webUser, newPassword)).status, 401);
});

test("managed models constrain API keys and can be deleted safely", async () => {
  const modelId = `managed-${randomBytes(4).toString("hex")}`;
  const list = await opJson(adminSession, "/op/api/models");
  assert.ok(list.models.some((model) => model.id === "human-1"));

  const added = await op(adminSession, "/op/api/models", {
    method: "POST",
    body: { id: modelId, name: "Managed test model" },
  });
  assert.equal(added.status, 201);
  assert.equal((await added.json()).model.id, modelId);

  const duplicate = await op(adminSession, "/op/api/models", {
    method: "POST",
    body: { id: modelId, name: "duplicate" },
  });
  assert.equal(duplicate.status, 409);

  const unknownKey = await op(adminSession, "/op/api/keys", {
    method: "POST",
    body: { name: "unknown-model-key", allowedModels: ["no-such-model"] },
  });
  assert.equal(unknownKey.status, 400);

  const keyResponse = await op(adminSession, "/op/api/keys", {
    method: "POST",
    body: { name: "managed-key", allowedModels: [modelId] },
  });
  assert.equal(keyResponse.status, 201);
  const keyRecord = (await keyResponse.json()).record;

  const inUse = await op(adminSession, `/op/api/models/${modelId}`, { method: "DELETE" });
  assert.equal(inUse.status, 409);

  await op(adminSession, `/op/api/keys/${keyRecord.id}`, { method: "DELETE" });
  const removed = await op(adminSession, `/op/api/models/${modelId}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
});

test("operator model permissions hide and protect tickets", async () => {
  const username = `limited-${randomBytes(3).toString("hex")}`;
  const password = `test-${randomBytes(12).toString("base64url")}`;
  const created = await op(adminSession, "/op/api/users", {
    method: "POST",
    body: { username, password, role: "operator", allowedModels: ["human-1"] },
  });
  assert.equal(created.status, 201);
  const limited = await session(username, password);

  const tagAllowed = marker("limited-allowed");
  const tagHidden = marker("limited-hidden");
  const allowedPending = startChat({ model: "human-1", messages: [{ role: "user", content: tagAllowed }] });
  const hiddenPending = startChat({ model: "human-1-fast", messages: [{ role: "user", content: tagHidden }] });
  const allowedTicket = await waitForTicket((ticket) => ticket.messages.some((m) => m.content.includes(tagAllowed)));
  const hiddenTicket = await waitForTicket((ticket) => ticket.messages.some((m) => m.content.includes(tagHidden)));

  const visible = await opJson(limited, "/op/api/tickets");
  assert.ok(visible.tickets.some((ticket) => ticket.id === allowedTicket.id));
  assert.ok(!visible.tickets.some((ticket) => ticket.id === hiddenTicket.id));

  const hiddenClaim = await op(limited, `/op/api/tickets/${hiddenTicket.id}/claim`, { method: "POST", body: {} });
  assert.equal(hiddenClaim.status, 404);
  const allowedClaim = await op(limited, `/op/api/tickets/${allowedTicket.id}/claim`, { method: "POST", body: {} });
  assert.equal(allowedClaim.status, 200);
  await op(limited, `/op/api/tickets/${allowedTicket.id}/cancel`, { method: "POST", body: {} });
  await op(adminSession, `/op/api/tickets/${hiddenTicket.id}/cancel`, { method: "POST", body: {} });
  await Promise.allSettled([allowedPending, hiddenPending]);
  await op(adminSession, `/op/api/users/${username}`, { method: "DELETE" });
});

test("admin API key lifecycle and x-api-key authentication", async () => {
  const createResponse = await op(adminSession, "/op/api/keys", {
    method: "POST",
    body: { name: "测试密钥" },
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.match(created.key, /^sk-ngzr-/);
  assert.equal(created.record.name, "测试密钥");
  assert.equal(created.record.disabled, false);

  const customValue = `sk-custom-${randomBytes(8).toString("hex")}`;
  const customResponse = await op(adminSession, "/op/api/keys", {
    method: "POST",
    body: { name: "自定义密钥", value: customValue },
  });
  assert.equal(customResponse.status, 201);
  const custom = await customResponse.json();
  assert.equal(custom.key, customValue);
  assert.equal(
    await fetch(`${BASE}/v1/models`, { headers: { Authorization: `Bearer ${customValue}` } }).then((r) => r.status),
    200,
  );
  await op(adminSession, `/op/api/keys/${custom.record.id}`, { method: "DELETE" });

  const exposed = await opJson(adminSession, "/op/api/keys");
  assert.ok(exposed.keys.some((key) => key.id === created.record.id && !Object.prototype.hasOwnProperty.call(key, "hash")));
  assert.equal(
    await fetch(`${BASE}/v1/models`, { headers: { "x-api-key": created.key } }).then((response) => response.status),
    200,
  );

  await opJson(adminSession, `/op/api/keys/${created.record.id}`, {
    method: "PATCH",
    body: { disabled: true },
  });
  assert.equal(
    await fetch(`${BASE}/v1/models`, { headers: { "x-api-key": created.key } }).then((response) => response.status),
    401,
  );
  await opJson(adminSession, `/op/api/keys/${created.record.id}`, {
    method: "PATCH",
    body: { disabled: false },
  });
  assert.equal(
    await fetch(`${BASE}/v1/models`, { headers: { "x-api-key": created.key } }).then((response) => response.status),
    200,
  );

  const denied = await op(aliceSession, "/op/api/keys");
  assert.equal(denied.status, 403);
  await opJson(adminSession, `/op/api/keys/${created.record.id}`, { method: "DELETE" });
  assert.equal(
    await fetch(`${BASE}/v1/models`, { headers: { "x-api-key": created.key } }).then((response) => response.status),
    401,
  );
});

test("operators, ticket transfer and CSV exports", async () => {
  const missingTicket = await op(aliceSession, "/op/api/operators");
  assert.equal(missingTicket.status, 400);

  const markerText = marker("transfer");
  const pending = startChat({ model: "human-1", messages: [{ role: "user", content: markerText }] });
  const ticket = await waitForTicket((item) => item.messages?.some((message) => message.content === markerText));
  const operators = await opJson(aliceSession, `/op/api/operators?ticket=${ticket.id}`);
  assert.ok(operators.operators.some((user) => user.username === "bob"));
  assert.equal(operators.operators.some((user) => "allowedModels" in user), false);
  const claimed = await op(aliceSession, `/op/api/tickets/${ticket.id}/claim`, { method: "POST" });
  assert.equal(claimed.status, 200);
  const transferred = await op(aliceSession, `/op/api/tickets/${ticket.id}/transfer`, {
    method: "POST",
    body: { to: "bob" },
  });
  assert.equal(transferred.status, 200);
  assert.equal((await transferred.json()).ticket.claimedBy, "bob");
  const finished = await op(bobSession, `/op/api/tickets/${ticket.id}/finish`, {
    method: "POST",
    body: { text: "OK", finishReason: "stop" },
  });
  assert.equal(finished.status, 200);
  assert.equal((await pending).status, 200);

  const unusedKey = await op(adminSession, "/op/api/keys", { method: "POST", body: { name: "=unused-formula" } });
  assert.equal(unusedKey.status, 201);
  const unused = await unusedKey.json();
  const usageCsv = await op(adminSession, "/op/api/usage.csv");
  assert.equal(usageCsv.status, 200);
  assert.match(usageCsv.headers.get("content-type"), /text\/csv/);
  const usageCsvText = await usageCsv.text();
  assert.match(usageCsvText, /key_id,name,hint/);
  assert.match(usageCsvText, /'=unused-formula/);
  await op(adminSession, `/op/api/keys/${unused.record.id}`, { method: "DELETE" });
  const auditCsv = await op(adminSession, "/op/api/audit.csv");
  assert.equal(auditCsv.status, 200);
  assert.match(await auditCsv.text(), /ticket.transfer/);
});

test("admin pages are separate and admin-only", async () => {
  const adminUsers = await fetch(`${BASE}/console/users`, { headers: { Cookie: adminSession.cookie } });
  assert.equal(adminUsers.status, 200);
  assert.match(await adminUsers.text(), /用户管理/);
  const adminKeys = await fetch(`${BASE}/console/keys`, { headers: { Cookie: adminSession.cookie } });
  assert.equal(adminKeys.status, 200);
  assert.match(await adminKeys.text(), /调用密钥/);
  const operatorUsers = await fetch(`${BASE}/console/users`, {
    headers: { Cookie: aliceSession.cookie },
    redirect: "manual",
  });
  assert.equal(operatorUsers.status, 302);
  assert.equal(operatorUsers.headers.get("location"), "/console");
  assert.equal((await fetch(`${BASE}/admin-users.js`)).status, 200);
  assert.equal((await fetch(`${BASE}/admin.css`)).status, 200);
  const navigation = await fetch(`${BASE}/navigation.js`);
  assert.equal(navigation.status, 200);
  assert.match(await navigation.text(), /const pages = \[/);
  const settingsMarkup = await fetch(`${BASE}/console/settings`, { headers: { Cookie: adminSession.cookie } }).then((r) => r.text());
  assert.match(settingsMarkup, /id="setPublicGuide"/);
  assert.match(settingsMarkup, /允许未登录访问新手教程/);
  for (const [pathname, label] of [
    ["/console/settings", "设置"],
    ["/console/usage", "用量"],
    ["/console/audit", "审计"],
    ["/console/status", "状态"],
  ]) {
    const response = await fetch(`${BASE}${pathname}`, { headers: { Cookie: adminSession.cookie } });
    assert.equal(response.status, 200, pathname);
    assert.match(await response.text(), new RegExp(label));
  }
  for (const asset of ["admin-settings.js", "admin-usage.js", "admin-audit.js", "admin-status.js"]) {
    assert.equal((await fetch(`${BASE}/${asset}`)).status, 200, asset);
  }
});

test("admin settings, usage, audit and status APIs", async () => {
  const settings = await opJson(adminSession, "/op/api/settings");
  assert.equal(settings.settings.limits.maxConcurrentPerKey > 0, true);
  assert.equal(typeof settings.mfaEnabled, "boolean");
  assert.equal(settings.settings.features.publicGuide, true);
  assert.equal(settings.readonly.port, PORT);

  const updated = await opJson(adminSession, "/op/api/settings", {
    method: "PATCH",
    body: { features: { usageDashboard: false } },
  });
  assert.equal(updated.settings.features.usageDashboard, false);
  const restored = await opJson(adminSession, "/op/api/settings", {
    method: "PATCH",
    body: { features: { usageDashboard: true } },
  });
  assert.equal(restored.settings.features.usageDashboard, true);
  for (const body of [{ queue: "x" }, { features: [] }, { limits: null }, { features: { publicGuide: "yes" } }]) {
    const invalid = await op(adminSession, "/op/api/settings", { method: "PATCH", body });
    assert.equal(invalid.status, 400, JSON.stringify(body));
  }

  const usage = await opJson(adminSession, "/op/api/usage");
  assert.ok(Array.isArray(usage.keys));
  assert.ok(usage.totals);
  const audit = await opJson(adminSession, "/op/api/audit");
  assert.ok(audit.events.some((event) => event.action === "settings.update"));
  const status = await opJson(adminSession, "/op/api/status");
  assert.equal(status.version, "0.6.0");
  assert.ok(status.storage.users.exists);
  assert.ok(Array.isArray(status.audit));
});

test("provider card and model capabilities", async () => {
  const providerResponse = await fetch(`${BASE}/provider`);
  assert.equal(providerResponse.status, 200);
  const provider = await providerResponse.json();
  assert.equal(provider.mode, "human-in-the-loop");
  assert.equal(provider.protocols.includes("anthropic-messages"), true);
  const models = await fetch(`${BASE}/v1/models`, {
    headers: { Authorization: `Bearer ${CALLER_KEY}` },
  }).then((response) => response.json());
  const human = models.data.find((model) => model.id === "human-1");
  assert.ok(human);
  assert.equal(human.human_in_the_loop, true);
  assert.ok(human.capabilities.includes("tools"));
  assert.ok(human.context_window > 0);
  const specResponse = await fetch(`${BASE}/openapi.json`);
  assert.equal(specResponse.status, 200);
  const spec = await specResponse.json();
  assert.ok(spec.paths["/v1/messages"]);
  assert.ok(spec.paths["/v1/chat/completions"]);
});

test("per-key RPM quota and model scope", async () => {
  const limitedResponse = await op(adminSession, "/op/api/keys", {
    method: "POST",
    body: {
      name: "限额测试",
      limits: { requestsPerMinute: 2, requestsPerDay: 2, requestsPerMonth: 2, maxConcurrent: 1 },
      allowedModels: ["human-1"],
    },
  });
  assert.equal(limitedResponse.status, 201);
  const limited = await limitedResponse.json();
  const auth = { "x-api-key": limited.key };
  assert.equal(await fetch(`${BASE}/v1/models`, { headers: auth }).then((r) => r.status), 200);
  assert.equal(await fetch(`${BASE}/v1/models`, { headers: auth }).then((r) => r.status), 200);
  const denied = await fetch(`${BASE}/v1/models`, { headers: auth });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get("retry-after")) >= 1);

  const scopedResponse = await op(adminSession, "/op/api/keys", {
    method: "POST",
    body: { name: "模型范围测试", allowedModels: ["human-1"] },
  });
  assert.equal(scopedResponse.status, 201);
  const scoped = await scopedResponse.json();
  const scopedModels = await fetch(`${BASE}/v1/models`, { headers: { "x-api-key": scoped.key } }).then((r) => r.json());
  assert.deepEqual(scopedModels.data.map((model) => model.id), ["human-1"]);
  assert.equal(
    await fetch(`${BASE}/v1/models/human-1-fast`, { headers: { "x-api-key": scoped.key } }).then((r) => r.status),
    404,
  );

  await op(adminSession, `/op/api/keys/${limited.record.id}`, { method: "DELETE" });
  await op(adminSession, `/op/api/keys/${scoped.record.id}`, { method: "DELETE" });
});

test("Anthropic Messages: non-stream, usage and stop_reason", async () => {
  const markerText = marker("ANTHROPIC-NS");
  const pending = startMessages({
    model: "human-1",
    max_tokens: 64,
    messages: [{ role: "user", content: markerText }],
  });
  const ticket = await waitForTicket((item) => item.messages.some((message) => message.content.includes(markerText)));
  assert.equal(ticket.protocol, "anthropic");
  await claim(adminSession, ticket.id);
  await finishJson(adminSession, ticket.id, { text: "Anthropic OK", finishReason: "stop" });
  const response = await pending;
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.type, "message");
  assert.equal(data.role, "assistant");
  assert.equal(data.stop_reason, "end_turn");
  assert.deepEqual(data.content, [{ type: "text", text: "Anthropic OK" }]);
  assert.equal(data.usage.input_tokens > 0, true);
  assert.equal(data.usage.output_tokens > 0, true);
});

test("Anthropic Messages: stream events and tool_use", async () => {
  const markerText = marker("ANTHROPIC-SSE");
  const pending = startMessages({
    model: "human-1",
    max_tokens: 64,
    stream: true,
    messages: [{ role: "user", content: markerText }],
  });
  const ticket = await waitForTicket((item) => item.messages.some((message) => message.content.includes(markerText)));
  await claim(adminSession, ticket.id);
  await opJson(adminSession, `/op/api/tickets/${ticket.id}/chunk`, {
    method: "POST",
    body: { text: "Hello" },
  });
  await finishJson(adminSession, ticket.id, { text: " world", finishReason: "stop" });
  const response = await pending;
  const events = await collectAnthropicSse(response);
  assert.equal(events[0].event, "message_start");
  assert.ok(events.some((event) => event.event === "content_block_delta" && event.data.delta.text === "Hello"));
  assert.equal(events.at(-1).event, "message_stop");

  const toolMarker = marker("ANTHROPIC-TOOL");
  const toolPending = startMessages({
    model: "human-1",
    max_tokens: 64,
    messages: [{ role: "user", content: toolMarker }],
    tools: [
      {
        name: "get_weather",
        description: "get weather",
        input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      },
    ],
    tool_choice: { type: "auto" },
  });
  const toolTicket = await waitForTicket((item) =>
    item.messages.some((message) => message.content.includes(toolMarker)),
  );
  await claim(adminSession, toolTicket.id);
  await finishJson(adminSession, toolTicket.id, {
    toolCalls: [{ name: "get_weather", arguments: { city: "上海" } }],
    finishReason: "tool_calls",
  });
  const toolResponse = await toolPending;
  assert.equal(toolResponse.status, 200);
  const toolData = await toolResponse.json();
  assert.equal(toolData.stop_reason, "tool_use");
  assert.deepEqual(toolData.content.at(-1), {
    type: "tool_use",
    id: toolData.content.at(-1).id,
    name: "get_weather",
    input: { city: "上海" },
  });
});

test("Anthropic Messages: missing max_tokens uses Anthropic error shape", async () => {
  const response = await startMessages({ model: "human-1", messages: [{ role: "user", content: "x" }] });
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.type, "error");
  assert.equal(data.error.type, "invalid_request_error");
  assert.match(data.error.message, /max_tokens/i);
});

test("completed idempotency survives a server restart", async () => {
  const persistData = mkdtempSync(path.join(os.tmpdir(), "ngzr-persist-"));
  const persistProject = path.join(persistData, "project");
  const persistPort = PORT + 3;
  const persistUsers = path.join(persistData, "users.json");
  const persistKeys = path.join(persistData, "api-keys.json");
  const persistUserPassword = "persist-password-123";
  copyProject(persistProject);
  writeConfig(persistProject, {
    port: persistPort,
    usersFile: persistUsers,
    apiKeysFile: persistKeys,
  });
  await seedApiKey(persistKeys, "sk-persist-test", "persist-caller");
  await runCli(["add", "admin", "--role", "admin"], persistUserPassword, persistProject);

  const origin = `http://127.0.0.1:${persistPort}`;
  const idempotency = `persist-${Date.now()}`;
  const requestBody = { model: "human-1", messages: [{ role: "user", content: "PERSIST-TEST" }] };
  let persistLog = "";
  let server = spawnServer(persistProject, persistPort, (chunk) => { persistLog += chunk; });
  try {
    await waitForHealth(origin);
    let loginResponse = await fetch(`${origin}/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: new URLSearchParams({ username: "admin", password: persistUserPassword }),
    });
    const cookie = setCookieFrom(loginResponse);
    const me = await fetch(`${origin}/auth/me`, { headers: { Cookie: cookie } }).then((r) => r.json());
    const pending = fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk-persist-test",
        "Idempotency-Key": idempotency,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    let ticket;
    for (let i = 0; i < 100; i += 1) {
      const data = await fetch(`${origin}/op/api/tickets`, { headers: { Cookie: cookie } }).then((r) => r.json());
      ticket = data.tickets.find((item) => item.messages.some((message) => message.content === "PERSIST-TEST"));
      if (ticket) break;
      await sleep(30);
    }
    assert.ok(ticket);
    await fetch(`${origin}/op/api/tickets/${ticket.id}/claim`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": me.csrfToken, "Content-Type": "application/json" },
      body: "{}",
    });
    await fetch(`${origin}/op/api/tickets/${ticket.id}/finish`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": me.csrfToken, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "persisted", finishReason: "stop" }),
    });
    const first = await pending;
    assert.equal(first.status, 200);
    assert.equal((await first.json()).choices[0].message.content, "persisted");
    await sleep(700);
    server.kill("SIGKILL");
    await sleep(300);
    server = spawnServer(persistProject, persistPort, (chunk) => { persistLog += chunk; });
    await waitForHealth(origin);
    loginResponse = await fetch(`${origin}/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: new URLSearchParams({ username: "admin", password: persistUserPassword }),
    });
    const replayCookie = setCookieFrom(loginResponse);
    assert.match(replayCookie, /^ngzr_session=/);
    const replay = await fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk-persist-test",
        "Idempotency-Key": idempotency,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    assert.equal(replay.status, 200);
    const replayBody = await replay.json();
    assert.equal(replayBody.choices[0].message.content, "persisted");
    assert.equal(replayBody.id, ticket.id);
  } finally {
    server.kill("SIGKILL");
    rmSync(persistData, { recursive: true, force: true });
  }
});

test("security: origin, host, open redirect, null origin and traversal", async () => {
  const evilOrigin = await login(ADMIN, ADMIN_PASSWORD, { origin: "http://evil.example" });
  assert.equal(evilOrigin.status, 403);

  const nullOrigin = await login(ADMIN, ADMIN_PASSWORD, { origin: "null" });
  assert.equal(nullOrigin.status, 303);
  const nullCookie = setCookieFrom(nullOrigin);

  const nullLogout = await fetch(`${BASE}/auth/logout`, {
    method: "POST",
    headers: { Cookie: nullCookie, Origin: "null" },
  });
  assert.equal(nullLogout.status, 403);

  const nullSameOrigin = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "null",
      "Sec-Fetch-Site": "same-origin",
    },
    body: new URLSearchParams({ username: ADMIN, password: ADMIN_PASSWORD }),
  });
  assert.equal(nullSameOrigin.status, 303);

  const evilHost = await rawRequest("/healthz", {
    headers: { Host: "evil.example" },
  });
  assert.equal(evilHost.status, 421);

  const malformedPath = await rawRequest("//");
  assert.equal(malformedPath.status, 400);
  assert.equal(JSON.parse(malformedPath.body).error.code, "invalid_url");

  const openRedirect = await login(ADMIN, ADMIN_PASSWORD, { next: "//evil.example/path" });
  assert.equal(openRedirect.status, 303);
  assert.equal(openRedirect.headers.get("location"), "/console#status");

  const traversal = await fetch(`${BASE}/console.css/..%2F..%2Fetc%2Fpasswd`);
  assert.equal(traversal.status, 404);

  const headerProbe = await fetch(`${BASE}/op/api/tickets`, {
    headers: { "X-Operator-Token": "whatever" },
  });
  assert.equal(headerProbe.status, 401);
});

test("security: session fixation, CSRF logout, escaped login errors and body limit", async () => {
  const fixation = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: BASE,
      Cookie: "ngzr_session=attacker-chosen-token",
    },
    body: new URLSearchParams({ username: ADMIN, password: ADMIN_PASSWORD }),
  });
  assert.equal(fixation.status, 303);
  const fixedCookie = setCookieFrom(fixation);
  assert.notEqual(fixedCookie, "ngzr_session=attacker-chosen-token");
  const oldSession = await fetch(`${BASE}/auth/me`, {
    headers: { Cookie: "ngzr_session=attacker-chosen-token" },
  });
  assert.equal(oldSession.status, 401);

  const noCsrfLogout = await fetch(`${BASE}/auth/logout`, {
    method: "POST",
    headers: { Cookie: fixedCookie },
  });
  assert.equal(noCsrfLogout.status, 403);

  const xssAttempt = await login("<script>alert(1)</script>", "wrong-password-123");
  assert.equal(xssAttempt.status, 401);
  const xssBody = await xssAttempt.text();
  assert.doesNotMatch(xssBody, /<script>alert\(1\)<\/script>/);

  const oversized = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: BASE,
    },
    body: "username=" + "a".repeat(20_000),
  });
  assert.equal(oversized.status, 413);

  const apiHeaders = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.match(apiHeaders.headers.get("x-request-id"), /^req_/);
  assert.match(apiHeaders.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("security: login brute-force throttling", async () => {
  let throttled = null;
  for (let index = 0; index < 14; index += 1) {
    const response = await login("ratelimit-target", `wrong-password-${index}`);
    if (response.status === 429) {
      throttled = response;
      break;
    }
  }
  assert.ok(throttled, "expected login throttling");
  assert.ok(Number(throttled.headers.get("retry-after")) > 0);
  const body = await throttled.text();
  assert.match(body, /尝试过多/);
});

test("CLI account changes hot-reload without dropping unrelated sessions", async () => {
  const reloadData = mkdtempSync(path.join(os.tmpdir(), "ngzr-reload-"));
  const reloadUsers = path.join(reloadData, "users.json");
  const reloadKeys = path.join(reloadData, "api-keys.json");
  const reloadProject = path.join(reloadData, "project");
  const reloadPort = PORT + 2;
  copyProject(reloadProject);
  writeConfig(reloadProject, {
    port: reloadPort,
    usersFile: reloadUsers,
    apiKeysFile: reloadKeys,
  });
  await seedApiKey(reloadKeys, "sk-reload");
  await runCli(["add", ADMIN, "--role", "admin"], ADMIN_PASSWORD, reloadProject);
  const reloadServer = spawnServer(reloadProject, reloadPort);
  try {
    const origin = `http://127.0.0.1:${reloadPort}`;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${origin}/healthz`)).ok) break;
      } catch {
        /* not ready */
      }
      await sleep(40);
    }
    const adminLogin = await fetch(`${origin}/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: origin,
      },
      body: new URLSearchParams({ username: ADMIN, password: ADMIN_PASSWORD }),
    });
    assert.equal(adminLogin.status, 303);
    const adminCookie = setCookieFrom(adminLogin);
    await runCli(["add", "charlie", "--role", "operator"], "charlie-password-123", reloadProject);
    await sleep(1200);
    const adminStillThere = await fetch(`${origin}/auth/me`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(adminStillThere.status, 200);

    const charlieLogin = await fetch(`${origin}/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: origin,
      },
      body: new URLSearchParams({ username: "charlie", password: "charlie-password-123" }),
    });
    assert.equal(charlieLogin.status, 303);
    const charlieCookie = setCookieFrom(charlieLogin);
    assert.equal(
      await fetch(`${origin}/auth/me`, { headers: { Cookie: charlieCookie } }).then((r) => r.status),
      200,
    );
    await runCli(["passwd", "charlie"], "charlie-password-456", reloadProject);
    await sleep(1200);
    assert.equal(
      await fetch(`${origin}/auth/me`, { headers: { Cookie: charlieCookie } }).then((r) => r.status),
      401,
    );
    assert.equal(
      await fetch(`${origin}/auth/me`, { headers: { Cookie: adminCookie } }).then((r) => r.status),
      200,
    );
  } finally {
    reloadServer.kill("SIGKILL");
    rmSync(reloadData, { recursive: true, force: true });
  }
});

test("random admin bootstrap prints a one-time password", async () => {
  const bootstrapData = mkdtempSync(path.join(os.tmpdir(), "ngzr-bootstrap-"));
  const bootstrapProject = path.join(bootstrapData, "project");
  const bootstrapPort = PORT + 1;
  let output = "";
  copyProject(bootstrapProject);
  writeConfig(bootstrapProject, {
    port: bootstrapPort,
    usersFile: path.join(bootstrapData, "users.json"),
    apiKeysFile: path.join(bootstrapData, "api-keys.json"),
  });
  const boot = spawnServer(bootstrapProject, bootstrapPort, (chunk) => {
    output += chunk;
  });
  try {
    const origin = `http://127.0.0.1:${bootstrapPort}`;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${origin}/healthz`)).ok) break;
      } catch {
        /* not ready */
      }
      await sleep(40);
    }
    const match = /password: (\S+)/.exec(output);
    assert.ok(match, `missing generated password in output:\n${output}`);
    const response = await fetch(`${origin}/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: origin,
      },
      body: new URLSearchParams({ username: "admin", password: match[1] }),
    });
    assert.equal(response.status, 303);
  } finally {
    boot.kill("SIGKILL");
    rmSync(bootstrapData, { recursive: true, force: true });
  }
});

test("session aggregation groups follow-up tickets and remembers the preferred operator", async () => {
  const tag = marker("SESSION");
  const sessionHeader = `session-${tag}`;
  const body = { model: "human-1", messages: [{ role: "user", content: tag }] };

  const firstPending = startChat(body, { "x-session-id": sessionHeader });
  const firstTicket = await waitForTicket((ticket) => ticket.messages?.some((message) => message.content === tag));
  assert.ok(firstTicket.sessionId);
  assert.equal(firstTicket.sessionTurn, 1);
  await claim(adminSession, firstTicket.id);
  await finishJson(adminSession, firstTicket.id, { text: "first", finishReason: "stop" });
  assert.equal((await firstPending).status, 200);

  const secondPending = startChat(body, { "x-session-id": sessionHeader });
  const secondTicket = await waitForTicket(
    (ticket) => ticket.id !== firstTicket.id && ticket.messages?.some((message) => message.content === tag),
  );
  assert.equal(secondTicket.sessionId, firstTicket.sessionId);
  assert.equal(secondTicket.sessionTurn, 2);
  assert.equal(secondTicket.preferredOperator, ADMIN);
  await claim(adminSession, secondTicket.id);
  await finishJson(adminSession, secondTicket.id, { text: "second", finishReason: "stop" });
  assert.equal((await secondPending).status, 200);
});

test("metrics, global history search and archive CSV are available", async () => {
  const tag = marker("HISTORY");
  const pending = startChat({ model: "human-1", messages: [{ role: "user", content: tag }] });
  const ticket = await waitForTicket((item) => item.messages?.some((message) => message.content === tag));
  await claim(adminSession, ticket.id);
  await finishJson(adminSession, ticket.id, { text: `archived-${tag}`, finishReason: "stop" });
  assert.equal((await pending).status, 200);

  const metrics = await fetch(`${BASE}/metrics`);
  assert.equal(metrics.status, 200);
  const text = await metrics.text();
  assert.match(text, /ngzr_up 1/);
  assert.match(text, /ngzr_tickets_state\{state="queued"\}/);
  assert.match(text, /ngzr_build_info\{version="0\.6\.0"\}/);

  const history = await opJson(adminSession, `/op/api/history?q=${encodeURIComponent(tag)}`);
  assert.equal(history.total, 1);
  assert.equal(history.items[0].id, ticket.id);
  assert.match(history.items[0].preview, new RegExp(tag));

  const csv = await op(adminSession, `/op/api/history.csv?q=${encodeURIComponent(tag)}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(await csv.text(), new RegExp(tag));
});

test("an idempotent SSE client can reconnect after disconnecting", async () => {
  const tag = marker("RECONNECT");
  const idempotency = `reconnect-${tag}`;
  const body = { model: "human-1", stream: true, messages: [{ role: "user", content: tag }] };
  const request = () => fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CALLER_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotency,
    },
    body: JSON.stringify(body),
  });

  const controller = new AbortController();
  const firstPromise = fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CALLER_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotency,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  const ticket = await waitForTicket((item) => item.messages?.some((message) => message.content === tag));
  await claim(adminSession, ticket.id);
  const first = await firstPromise;
  assert.equal(first.status, 200);
  controller.abort();
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const list = await opJson(adminSession, "/op/api/tickets");
    const current = list.tickets.find((item) => item.id === ticket.id);
    if (current?.clientGone) break;
    await sleep(20);
  }

  const second = await request();
  assert.equal(second.status, 200);
  const eventsPromise = collectSse(second);
  await sleep(80);
  await finishJson(adminSession, ticket.id, { text: "reconnected", finishReason: "stop" });
  const events = await eventsPromise;
  assert.equal(deltaText(events), "reconnected");
  assert.ok(events.some((event) => event.done));
});

test("active queue survives restart and an idempotent caller can reconnect", async () => {
  const persistData = mkdtempSync(path.join(os.tmpdir(), "ngzr-reconnect-"));
  const persistProject = path.join(persistData, "project");
  const persistPort = PORT + 5;
  const persistUsers = path.join(persistData, "users.json");
  const persistKeys = path.join(persistData, "api-keys.json");
  const password = "reconnect-password-123";
  copyProject(persistProject);
  writeConfig(persistProject, {
    port: persistPort,
    usersFile: persistUsers,
    apiKeysFile: persistKeys,
    waitMs: 6000,
    responseMs: 30000,
  });
  await seedApiKey(persistKeys, "sk-reconnect-test", "reconnect-caller");
  await runCli(["add", "admin", "--role", "admin"], password, persistProject);

  const origin = `http://127.0.0.1:${persistPort}`;
  const idempotency = `restart-reconnect-${Date.now()}`;
  const body = { model: "human-1", messages: [{ role: "user", content: "RECONNECT-RESTART-TEST" }] };
  let server = spawnServer(persistProject, persistPort);
  try {
    await waitForHealth(origin);
    let loginResponse = await fetch(`${origin}/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: new URLSearchParams({ username: "admin", password }),
    });
    const cookie = setCookieFrom(loginResponse);
    const me = await fetch(`${origin}/auth/me`, { headers: { Cookie: cookie } }).then((r) => r.json());
    const pending = fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk-reconnect-test",
        "Idempotency-Key": idempotency,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }).catch(() => null);
    let ticket;
    for (let i = 0; i < 100; i += 1) {
      const data = await fetch(`${origin}/op/api/tickets`, { headers: { Cookie: cookie } }).then((r) => r.json());
      ticket = data.tickets.find((item) => item.messages?.some((message) => message.content === "RECONNECT-RESTART-TEST"));
      if (ticket) break;
      await sleep(30);
    }
    assert.ok(ticket);
    const claimed = await fetch(`${origin}/op/api/tickets/${ticket.id}/claim`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": me.csrfToken, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(claimed.status, 200);
    await sleep(500);
    server.kill("SIGKILL");
    await sleep(350);
    server = spawnServer(persistProject, persistPort);
    await waitForHealth(origin);
    loginResponse = await fetch(`${origin}/auth/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: new URLSearchParams({ username: "admin", password }),
    });
    const cookie2 = setCookieFrom(loginResponse);
    const me2 = await fetch(`${origin}/auth/me`, { headers: { Cookie: cookie2 } }).then((r) => r.json());
    const reconnected = fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer sk-reconnect-test",
        "Idempotency-Key": idempotency,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    await sleep(120);
    const finished = await fetch(`${origin}/op/api/tickets/${ticket.id}/finish`, {
      method: "POST",
      headers: { Cookie: cookie2, "X-CSRF-Token": me2.csrfToken, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "survived restart", finishReason: "stop" }),
    });
    assert.equal(finished.status, 200, await finished.text());
    const response = await reconnected;
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.choices[0].message.content, "survived restart");
    await pending;
  } finally {
    server?.kill("SIGKILL");
    try { rmSync(persistData, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

async function uploadAttachment(buffer, { filename, type = "application/octet-stream", token = CALLER_KEY } = {}) {
  const response = await fetch(`${BASE}/v1/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": type,
      "X-Filename": filename,
    },
    body: buffer,
  });
  return { response, data: await response.json().catch(() => ({})) };
}

test("secure attachments: text, CSV, image and PDF previews with ownership checks", async () => {
  const text = await uploadAttachment(Buffer.from("hello attachment\n<script>alert(1)</script>\n", "utf8"), {
    filename: "../../secret.txt",
    type: "text/plain",
  });
  assert.equal(text.response.status, 201, JSON.stringify(text.data));
  assert.equal(text.data.filename, "secret.txt");
  const textId = text.data.id;

  const csv = await uploadAttachment(Buffer.from("name,value\na,1\nb,2\n", "utf8"), {
    filename: "rows.csv",
    type: "text/csv",
  });
  assert.equal(csv.response.status, 201, JSON.stringify(csv.data));

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const image = await uploadAttachment(png, { filename: "pixel.png", type: "image/png" });
  assert.equal(image.response.status, 201, JSON.stringify(image.data));

  const pdfBuffer = Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 72 720 Td (Hello PDF) Tj ET
endstream
endobj
trailer
<< /Root 1 0 R >>
%%EOF
`, "latin1");
  const pdf = await uploadAttachment(pdfBuffer, { filename: "valid.pdf", type: "application/pdf" });
  assert.equal(pdf.response.status, 201, JSON.stringify(pdf.data));

  const pending = startChat({
    model: "human-1",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "ATTACH-TEST" },
        { type: "file", file: { file_id: textId } },
      ],
    }],
  });
  const ticket = await waitForTicket((item) => item.messages?.some((message) => message.content.includes("ATTACH-TEST")));
  assert.equal(ticket.attachments[0].type, "file");
  assert.equal(ticket.attachments[0].fileId, textId);
  await claim(adminSession, ticket.id);
  await finishJson(adminSession, ticket.id, { text: "attachment seen", finishReason: "stop" });
  assert.equal((await pending).status, 200);

  const meta = await opJson(adminSession, `/op/api/tickets/${ticket.id}/attachments/${textId}/meta`);
  assert.equal(meta.kind, "text");
  assert.match(meta.preview.text, /script/);
  const raw = await op(adminSession, `/op/api/tickets/${ticket.id}/attachments/${textId}/raw`);
  assert.equal(raw.status, 200);
  assert.match(raw.headers.get("content-disposition"), /^attachment;/);
  const imageResponse = await op(adminSession, `/op/api/tickets/${ticket.id}/attachments/${image.data.id}/image`);
  assert.equal(imageResponse.status, 404); // not referenced by this ticket

  const wrongTicketImage = startChat({
    model: "human-1",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "ATTACH-IMAGE" },
        { type: "file", file: { file_id: image.data.id } },
      ],
    }],
  });
  const imageTicket = await waitForTicket((item) => item.messages?.some((message) => message.content.includes("ATTACH-IMAGE")));
  await claim(adminSession, imageTicket.id);
  const imagePreview = await op(adminSession, `/op/api/tickets/${imageTicket.id}/attachments/${image.data.id}/image`);
  assert.equal(imagePreview.status, 200);
  assert.equal(imagePreview.headers.get("content-type"), "image/png");
  await finishJson(adminSession, imageTicket.id, { text: "image seen", finishReason: "stop" });
  assert.equal((await wrongTicketImage).status, 200);

  const form = new FormData();
  form.append("purpose", "chat_attachment");
  form.append("file", new Blob([Buffer.from("multipart text\n")], { type: "text/plain" }), "multi.txt");
  const multipart = await fetch(`${BASE}/v1/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CALLER_KEY}` },
    body: form,
  });
  assert.equal(multipart.status, 201, await multipart.text());
});

test("malicious or unsupported attachments are rejected", async () => {
  const cases = [
    ["evil.html", Buffer.from("<html><script>alert(1)</script></html>"), "text/html", 415],
    ["evil.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/svg+xml", 415],
    ["evil.sh", Buffer.from("#!/bin/sh\necho hacked\n"), "application/x-sh", 415],
    ["evil.zip", Buffer.from("PK\u0003\u0004fakezip"), "application/zip", 415],
    ["fake.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("<html>")]), "image/jpeg", 415],
    ["evil.pdf", Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog /OpenAction 1 0 R >>\nendobj\n%%EOF\n"), "application/pdf", 400],
  ];
  for (const [filename, body, type, expected] of cases) {
    const { response, data } = await uploadAttachment(body, { filename, type });
    assert.equal(response.status, expected, `${filename}: ${JSON.stringify(data)}`);
  }

  const text = Buffer.from("safe text\n");
  const sanitized = await uploadAttachment(text, { filename: "../evil.log", type: "text/plain" });
  assert.equal(sanitized.response.status, 201);
  assert.equal(sanitized.data.filename, "evil.log");

  const traversal = await fetch(`${BASE}/v1/files/..%2F..%2Fetc%2Fpasswd`, {
    headers: { Authorization: `Bearer ${CALLER_KEY}` },
  });
  assert.equal(traversal.status, 404);
});

test("settings are split into per-user personalization and admin-only functions", async () => {
  const operatorPage = await fetch(`${BASE}/console/settings`, { headers: { Cookie: aliceSession.cookie } });
  assert.equal(operatorPage.status, 200);
  const operatorPageHtml = await operatorPage.text();
  assert.match(operatorPageHtml, /个性化设置/);
  assert.doesNotMatch(operatorPageHtml, /users\.json|state\.json|api-keys\.json/);
  assert.doesNotMatch(operatorPageHtml, /id="runtimeForm"|id="featureForm"|id="mfaSetupBox"|admin-only/);

  const alicePrefs = await opJson(aliceSession, "/op/api/preferences");
  assert.equal(alicePrefs.preferences.notificationSound, true);
  const updated = await opJson(aliceSession, "/op/api/preferences", {
    method: "PATCH",
    body: { notificationSound: false, browserNotifications: false, queueAlertSeconds: 45, autoClaimDefault: true },
  });
  assert.equal(updated.preferences.notificationSound, false);
  assert.equal(updated.preferences.browserNotifications, false);
  assert.equal(updated.preferences.queueAlertSeconds, 45);
  assert.equal(updated.preferences.autoClaimDefault, true);

  const aliceAgain = await opJson(aliceSession, "/op/api/preferences");
  assert.equal(aliceAgain.preferences.queueAlertSeconds, 45);
  const bobPrefs = await opJson(bobSession, "/op/api/preferences");
  assert.equal(bobPrefs.preferences.queueAlertSeconds, 120);
  assert.equal(bobPrefs.preferences.notificationSound, true);

  const operatorSettings = await op(aliceSession, "/op/api/settings");
  assert.equal(operatorSettings.status, 403);
  const operatorPatch = await op(aliceSession, "/op/api/settings", {
    method: "PATCH",
    body: { features: { auditLog: false } },
  });
  assert.equal(operatorPatch.status, 403);

  const aliceMe = await fetch(`${BASE}/auth/me`, { headers: { Cookie: aliceSession.cookie } }).then((r) => r.json());
  assert.equal(aliceMe.preferences.autoClaimDefault, true);
  assert.equal(aliceMe.preferences.notificationSound, false);
});

test("operator ticket polling supports ETag revalidation", async () => {
  const first = await op(adminSession, "/op/api/tickets");
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.match(etag, /^"t-[a-f0-9]{24}"$/);
  const second = await fetch(`${BASE}/op/api/tickets`, {
    headers: { Cookie: adminSession.cookie, "If-None-Match": etag },
  });
  assert.equal(second.status, 304);
  assert.equal(second.headers.get("etag"), etag);
});

test("upload quota accounting rejects the next file over the per-key daily limit", async () => {
  const { UsageStore } = await import("../src/data/usage.mjs");
  const quotaFile = path.join(DATA_DIR, "upload-quota.json");
  const store = new UsageStore({ file: quotaFile });
  store.init();
  store.checkUploadQuota("key-a", 100, 150);
  store.addUploadBytes("key-a", 100);
  assert.throws(
    () => store.checkUploadQuota("key-a", 60, 150),
    (error) => error.code === "upload_quota_exceeded" && error.retryAfterMs > 0,
  );
  store.checkUploadQuota("key-b", 100, 150);
  store.close();
});

test("compact ticket polling omits heavy messages but keeps queue metadata", async () => {
  const data = await opJson(adminSession, "/op/api/tickets?compact=1");
  assert.ok(Array.isArray(data.tickets));
  const ticket = data.tickets.find((item) => item.id === "chatcmpl-6506355b78f54621a6212205") || data.tickets[0];
  assert.ok(ticket);
  assert.equal(ticket.messages, undefined);
  assert.equal(typeof ticket.createdAt, "number");
  assert.equal(typeof ticket.caller, "string");
  assert.equal(typeof ticket.elapsedMs, "number");
  assert.equal(typeof ticket.preview, "string");
  assert.equal(typeof ticket.purpose?.label, "string");
  assert.equal(typeof ticket.searchText, "string");
});


test("onboarding guide is public and assets are served", async () => {
  const page = await fetch(`${BASE}/guide`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /新手教程/);
  assert.match(html, /href="\/guide.css"/);
  assert.doesNotMatch(html, /192\.168\.|zhiren-V1-flash|:7355|kfc-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(html, /<script|\son[a-z]+\s*=/i);
  assert.match(page.headers.get("x-robots-tag") || "", /noindex/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("access-control-allow-origin"), null);
  assert.equal(page.headers.get("set-cookie"), null);
  const query = await fetch(`${BASE}/guide?probe=%3Cscript%3Ealert(1)%3C/script%3E`);
  assert.equal(query.status, 200);
  assert.equal(await query.text(), html);
  const nested = await fetch(`${BASE}/guide/anything`);
  assert.equal(nested.status, 404);
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const response = await fetch(`${BASE}/guide`, { method });
    assert.equal(response.status, 405, `${method} guide`);
  }
  const normalizedAuthBypass = await fetch(`${BASE}/guide/%2e%2e/console`, { redirect: "manual" });
  assert.equal(normalizedAuthBypass.status, 302);
  const evilGuideHost = await rawRequest("/guide", { headers: { Host: "evil.example" } });
  assert.equal(evilGuideHost.status, 421);
  const css = await fetch(`${BASE}/guide.css`);
  assert.equal(css.status, 200);
  assert.match(await css.text(), /guide-hero/);
  assert.equal(css.headers.get("access-control-allow-origin"), null);
  const navigation = await fetch(`${BASE}/navigation.js`).then((r) => r.text());
  assert.match(navigation, /href: "\/console\/guide"/);
});

test("the public guide can be switched to login-only", async () => {
  const off = await opJson(adminSession, "/op/api/settings", {
    method: "PATCH",
    body: { features: { publicGuide: false } },
  });
  assert.equal(off.settings.features.publicGuide, false);
  const anonymous = await fetch(`${BASE}/guide`, { redirect: "manual" });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get("location"), "/login?next=%2Fguide");
  const anonymousSubpage = await fetch(`${BASE}/console/guide`, { redirect: "manual" });
  assert.equal(anonymousSubpage.status, 302);
  const loggedIn = await fetch(`${BASE}/guide`, { headers: { Cookie: adminSession.cookie }, redirect: "manual" });
  assert.equal(loggedIn.status, 302);
  assert.equal(loggedIn.headers.get("location"), "/console/guide");
  const subpage = await fetch(`${BASE}/console/guide?embed=1`, { headers: { Cookie: adminSession.cookie } });
  assert.equal(subpage.status, 200);
  assert.match(await subpage.text(), /新手教程/);
  const restored = await opJson(adminSession, "/op/api/settings", {
    method: "PATCH",
    body: { features: { publicGuide: true } },
  });
  assert.equal(restored.settings.features.publicGuide, true);
  assert.equal((await fetch(`${BASE}/guide`)).status, 200);
});

test("image URL and request-shape caps reject unbounded payloads", async () => {
  const tooManyImages = Array.from({ length: 9 }, (_, index) => ({
    type: "image_url",
    image_url: { url: `https://example.invalid/image-${index}.png` },
  }));
  const many = await startChat({
    model: "human-1",
    messages: [{ role: "user", content: [{ type: "text", text: marker("images") }, ...tooManyImages] }],
  });
  assert.equal(many.status, 400);
  assert.equal((await many.json()).error.code, "too_many_images");

  // Eight individually valid URLs, but the total URL payload exceeds 2,000,000 bytes.
  const longUrls = Array.from({ length: 8 }, (_, index) => ({
    type: "image_url",
    image_url: { url: `https://example.invalid/${index}/${"a".repeat(250000)}` },
  }));
  const tooLarge = await startChat({
    model: "human-1",
    messages: [{ role: "user", content: [{ type: "text", text: marker("imagebytes") }, ...longUrls] }],
  });
  assert.equal(tooLarge.status, 400);
  assert.equal((await tooLarge.json()).error.code, "image_payload_too_large");

  const tooManyMessages = await startChat({
    model: "human-1",
    messages: Array.from({ length: 257 }, (_, index) => ({ role: "user", content: `m${index}` })),
  });
  assert.equal(tooManyMessages.status, 400);
  assert.equal((await tooManyMessages.json()).error.code, "too_many_messages");

  const tooManyParts = await startChat({
    model: "human-1",
    messages: [{
      role: "user",
      content: Array.from({ length: 513 }, (_, index) => ({ type: "text", text: `p${index}` })),
    }],
  });
  assert.equal(tooManyParts.status, 400);
  assert.equal((await tooManyParts.json()).error.code, "too_many_content_parts");
});

test("audit rotation and the global attachment budget are bounded", async () => {
  const { AuditStore } = await import("../src/data/audit.mjs");
  const { AttachmentStore } = await import("../src/data/attachments.mjs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "ngzr-budget-"));
  try {
    const auditFile = path.join(dir, "audit.log");
    const auditStore = new AuditStore({ file: auditFile, maxBytes: 1024 * 1024, keepFiles: 2 });
    auditStore.init();
    auditStore.append({ actor: "test", action: "rotate.one" });
    auditStore.rotateIfNeeded(true);
    assert.equal(existsSync(`${auditFile}.1`), true);
    auditStore.append({ actor: "test", action: "rotate.two" });
    auditStore.rotateIfNeeded(true);
    assert.equal(existsSync(`${auditFile}.2`), true);
    auditStore.append({ actor: "test", action: "rotate.three" });
    auditStore.rotateIfNeeded(true);
    assert.equal(existsSync(`${auditFile}.3`), false);
    auditStore.close?.();

    const attachmentDir = path.join(dir, "attachments");
    const store = new AttachmentStore({
      dir: attachmentDir,
      maxBytes: 10 * 1024 * 1024,
      maxStoreBytes: 1024 * 1024,
    });
    store.init();
    const first = store.create({
      buffer: Buffer.from(`first ${"a".repeat(600_000)}`),
      filename: "first.txt",
      declaredType: "text/plain",
      ownerHash: "owner",
    });
    assert.equal(first.bytes > 500_000, true);
    assert.throws(
      () => store.create({
        buffer: Buffer.from(`second ${"b".repeat(600_000)}`),
        filename: "second.txt",
        declaredType: "text/plain",
        ownerHash: "owner",
      }),
      (error) => error.code === "attachment_store_full" && error.status === 507,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("protocol image aliases are accepted and produce typed image attachments", async () => {
  const openaiTag = marker("INPUT-IMAGE");
  const openaiPending = startChat({
    model: "human-1",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: openaiTag },
        { type: "input_image", image_url: "https://example.invalid/alias.png" },
      ],
    }],
  });
  const openaiTicket = await waitForTicket((item) => item.messages.some((message) => message.content.includes(openaiTag)));
  assert.equal(openaiTicket.attachments[0].type, "image");
  await claim(adminSession, openaiTicket.id);
  await finishJson(adminSession, openaiTicket.id, { text: "openai alias", finishReason: "stop" });
  assert.equal((await openaiPending).status, 200);

  const anthropicTag = marker("ANTHROPIC-IMAGE");
  const anthropicPending = startMessages({
    model: "human-1",
    max_tokens: 64,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: anthropicTag },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
      ],
    }],
  });
  const anthropicTicket = await waitForTicket((item) =>
    item.messages.some((message) => message.content.includes(anthropicTag)),
  );
  assert.equal(anthropicTicket.attachments[0].type, "image");
  await claim(adminSession, anthropicTicket.id);
  await finishJson(adminSession, anthropicTicket.id, { text: "anthropic image", finishReason: "stop" });
  assert.equal((await anthropicPending).status, 200);
});

test("server templates support shared/personal visibility and usage counts", async () => {
  const aliceCreate = await op(aliceSession, "/op/api/templates", {
    method: "POST",
    body: { name: "Alice 模板", content: "你好 {{caller}}", visibility: "personal", scope: "" },
  });
  assert.equal(aliceCreate.status, 201);
  const alicePersonal = await aliceCreate.json();
  const sharedCreate = await op(adminSession, "/op/api/templates", {
    method: "POST",
    body: { name: "共享模板", content: "模型：{{model}}", visibility: "shared", scope: "human-1" },
  });
  assert.equal(sharedCreate.status, 201);
  const shared = await sharedCreate.json();
  const aliceList = await opJson(aliceSession, "/op/api/templates");
  assert.ok(aliceList.templates.some((item) => item.id === alicePersonal.template.id));
  assert.ok(aliceList.templates.some((item) => item.id === shared.template.id));
  const bobList = await opJson(bobSession, "/op/api/templates");
  assert.equal(bobList.templates.some((item) => item.id === alicePersonal.template.id), false);
  assert.ok(bobList.templates.some((item) => item.id === shared.template.id));
  assert.equal((await op(aliceSession, "/op/api/templates", {
    method: "POST",
    body: { name: "偷建共享", content: "x", visibility: "shared" },
  })).status, 403);
  const used = await opJson(aliceSession, `/op/api/templates/${shared.template.id}/use`, { method: "POST", body: {} });
  assert.equal(used.template.uses, 1);
  assert.equal((await op(aliceSession, `/op/api/templates/${shared.template.id}`, { method: "DELETE" })).status, 403);
  await opJson(adminSession, `/op/api/templates/${shared.template.id}`, { method: "DELETE" });
  await opJson(aliceSession, `/op/api/templates/${alicePersonal.template.id}`, { method: "DELETE" });
});

test("ticket routing metadata and internal notes are operator-visible", async () => {
  const tag = marker("ROUTING");
  const pending = startChat({ model: "human-1", messages: [{ role: "user", content: tag }] });
  const ticket = await waitForTicket((item) => item.messages.some((message) => message.content.includes(tag)));
  const updated = await opJson(adminSession, `/op/api/tickets/${ticket.id}/meta`, {
    method: "PATCH",
    body: { tags: ["VIP", "中文"], priority: 3 },
  });
  assert.deepEqual(updated.ticket.tags, ["VIP", "中文"]);
  assert.equal(updated.ticket.priority, 3);
  const noteResponse = await op(adminSession, `/op/api/tickets/${ticket.id}/notes`, {
    method: "POST",
    body: { text: "客户要求优先处理" },
  });
  assert.equal(noteResponse.status, 201);
  const note = await noteResponse.json();
  assert.equal(note.note.author, ADMIN);
  const detail = await opJson(adminSession, `/op/api/tickets/${ticket.id}`);
  assert.equal(detail.ticket.notes.at(-1).text, "客户要求优先处理");
  const compact = await opJson(adminSession, "/op/api/tickets?compact=1");
  const summary = compact.tickets.find((item) => item.id === ticket.id);
  assert.equal(summary.noteCount, 1);
  assert.deepEqual(summary.tags, ["VIP", "中文"]);
  await claim(adminSession, ticket.id);
  await finishJson(adminSession, ticket.id, { text: "routing ok", finishReason: "stop" });
  assert.equal((await pending).status, 200);
});

test("AI assist respects user feature flags, settings, secret handling and quotas", async () => {
  const requests = [];
  const mockProvider = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      requests.push({ headers: req.headers, body: raw });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { content: "1. 用户需要退款进度\n2. 尚未提供订单号" } }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      }));
    });
  });
  await new Promise((resolve) => mockProvider.listen(0, "127.0.0.1", resolve));
  const mockPort = mockProvider.address().port;
  const tag = marker("AI-ASSIST");
  let pending = null;
  try {
    const catalog = await opJson(adminSession, "/op/api/features");
    assert.ok(catalog.features.some((feature) => feature.key === "aiAssist"));
    const settings = await opJson(adminSession, "/op/api/settings");
    assert.equal(settings.settings.aiAssist.enabled, false);
    const configured = await opJson(adminSession, "/op/api/settings", {
      method: "PATCH",
      body: {
        aiAssist: {
          enabled: true,
          endpoint: `http://127.0.0.1:${mockPort}/v1`,
          model: "mock-assist",
          timeoutMs: 5000,
          maxInputChars: 12000,
          maxOutputChars: 4000,
          dailyRequestsPerOperator: 20,
          dailyTokensPerOperator: 100000,
          dailyRequestsTotal: 100,
          maxConcurrent: 2,
        },
        apiKey: "sk-mock-secret",
      },
    });
    assert.equal(configured.aiAssistKey.configured, true);
    assert.equal(JSON.stringify(configured).includes("sk-mock-secret"), false);
    const visible = await opJson(adminSession, "/op/api/settings");
    assert.equal(JSON.stringify(visible).includes("sk-mock-secret"), false);
    assert.equal(visible.settings.aiAssist.enabled, true);

    pending = startChat({ model: "human-1", messages: [{ role: "user", content: tag }] });
    const ticket = await waitForTicket((item) => item.messages.some((message) => message.content.includes(tag)));
    const aiResponse = await op(adminSession, `/op/api/tickets/${ticket.id}/ai/suggest`, {
      method: "POST",
      body: { task: "summary" },
    });
    assert.equal(aiResponse.status, 200);
    const ai = await aiResponse.json();
    assert.match(ai.suggestion, /退款进度/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.authorization, "Bearer sk-mock-secret");
    assert.match(requests[0].body, /UNTRUSTED_TICKET_CONTENT/);
    const afterAi = await opJson(adminSession, `/op/api/tickets/${ticket.id}`);
    assert.equal(afterAi.ticket.state, "queued");

    await opJson(adminSession, `/op/api/users/${ADMIN}`, {
      method: "PATCH",
      body: { features: { aiAssist: false } },
    });
    const denied = await op(adminSession, `/op/api/tickets/${ticket.id}/ai/suggest`, {
      method: "POST",
      body: { task: "summary" },
    });
    assert.equal(denied.status, 403);
    await opJson(adminSession, `/op/api/users/${ADMIN}`, {
      method: "PATCH",
      body: { features: { aiAssist: true } },
    });

    const quotaSettings = await opJson(adminSession, "/op/api/settings");
    await opJson(adminSession, "/op/api/settings", {
      method: "PATCH",
      body: { aiAssist: { ...quotaSettings.settings.aiAssist, dailyRequestsPerOperator: 2 } },
    });
    const first = await op(adminSession, `/op/api/tickets/${ticket.id}/ai/suggest`, {
      method: "POST",
      body: { task: "summary" },
    });
    assert.equal(first.status, 200);
    const second = await op(adminSession, `/op/api/tickets/${ticket.id}/ai/suggest`, {
      method: "POST",
      body: { task: "summary" },
    });
    assert.equal(second.status, 429);
    assert.equal((await second.json()).error.code, "ai_quota_exceeded");

    await claim(adminSession, ticket.id);
    await finishJson(adminSession, ticket.id, { text: "ai ok", finishReason: "stop" });
    assert.equal((await pending).status, 200);
  } finally {
    if (pending) {
      // best effort: leave no active ticket if an assertion fails early
      const list = await op(adminSession, "/op/api/tickets").then((r) => r.json()).catch(() => ({ tickets: [] }));
      const open = list.tickets?.find((item) => item.messages?.some((message) => message.content.includes(tag)) && item.state === "queued");
      if (open) await op(adminSession, `/op/api/tickets/${open.id}/cancel`, { method: "POST", body: {} }).catch(() => {});
    }
    await new Promise((resolve) => mockProvider.close(resolve));
  }
});

test("SQLite history index supports full-text recall and filters", async () => {
  const { HistoryIndex } = await import("../src/data/history-index.mjs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "ngzr-history-"));
  const index = new HistoryIndex({ file: path.join(dir, "history.db") }).init();
  try {
    assert.equal(index.available, true);
    index.sync([{
      id: "chatcmpl-history-test",
      finishedAt: Date.now(),
      model: "human-1",
      state: "done",
      caller: "tester",
      operator: "admin",
      sessionId: "session-history",
      searchText: "history 退款进度 tester admin",
      summaryJson: JSON.stringify({ id: "chatcmpl-history-test", model: "human-1", state: "done", operator: "admin", preview: "退款进度" }),
    }]);
    const byText = index.query({ q: "退款进度", limit: 20, offset: 0 });
    assert.equal(byText.total, 1);
    assert.equal(byText.items[0].id, "chatcmpl-history-test");
    const byOperator = index.query({ operator: "admin", limit: 20, offset: 0 });
    assert.equal(byOperator.total, 1);
    const noMatch = index.query({ q: "不存在的关键字", limit: 20, offset: 0 });
    assert.equal(noMatch.total, 0);
  } finally {
    index.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("client IP only trusts forwarded headers from configured proxies", async () => {
  const { resolveClientIp } = await import("../src/net.mjs");
  const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });
  assert.equal(resolveClientIp(req("10.1.2.3", { "x-forwarded-for": "198.51.100.7" }), []), "10.1.2.3");
  assert.equal(
    resolveClientIp(
      req("10.1.2.3", { "x-forwarded-for": "198.51.100.7, 10.1.2.3" }),
      ["10.0.0.0/8"],
    ),
    "198.51.100.7",
  );
  assert.equal(
    resolveClientIp(req("10.1.2.3", { "x-forwarded-for": "203.0.113.9, 10.1.2.3" }), ["10.1.2.3"]),
    "203.0.113.9",
  );
});


test("isolated image worker re-encodes raster uploads", async (t) => {
  const { normalizeImageBuffer } = await import("../src/media/image-worker.mjs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "ngzr-image-worker-"));
  const input = path.join(dir, "input.jpg");
  try {
    const generated = spawnSync("python3", ["-c", [
      "from PIL import Image",
      `im=Image.new('RGB',(64,48),(30,90,150))`,
      `im.save(${JSON.stringify(input)},'JPEG',quality=95)`,
    ].join("; ")], { timeout: 5000 });
    if (generated.status !== 0) {
      t.skip("Pillow is not available for image worker test");
      return;
    }
    const original = (await import("node:fs")).readFileSync(input);
    const result = await normalizeImageBuffer(original, {
      script: path.join(ROOT, "scripts", "normalize-image.py"),
      maxBytes: 2_000_000,
    });
    assert.equal(result.mime, "image/jpeg");
    assert.equal(result.width, 64);
    assert.equal(result.height, 48);
    assert.ok(result.buffer.length > 0);
    assert.equal(result.buffer.subarray(0, 2).toString("hex"), "ffd8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PDF page preview renders one page on demand", async (t) => {
  if (spawnSync("python3", ["-c", "import pypdfium2"], { timeout: 5000 }).status !== 0) {
    t.skip("pypdfium2 is not available");
    return;
  }
  const pdfBuffer = Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 72 720 Td (PDF page test) Tj ET
endstream
endobj
trailer
<< /Root 1 0 R >>
%%EOF
`, "latin1");
  const uploaded = await uploadAttachment(pdfBuffer, { filename: "page.pdf", type: "application/pdf" });
  assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.data));
  const pending = startChat({
    model: "human-1",
    messages: [{ role: "user", content: [{ type: "text", text: "PDF-PAGE" }, { type: "file", file: { file_id: uploaded.data.id } }] }],
  });
  const ticket = await waitForTicket((item) => item.messages?.some((message) => message.content.includes("PDF-PAGE")));
  const page = await op(adminSession, `/op/api/tickets/${ticket.id}/attachments/${uploaded.data.id}/pdf-page?page=1`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-type"), "image/png");
  assert.ok((await page.arrayBuffer()).byteLength > 100);
  const invalid = await op(adminSession, `/op/api/tickets/${ticket.id}/attachments/${uploaded.data.id}/pdf-page?page=0`);
  assert.equal(invalid.status, 400);
  await claim(adminSession, ticket.id);
  await finishJson(adminSession, ticket.id, { text: "pdf seen", finishReason: "stop" });
  assert.equal((await pending).status, 200);
});

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
    assert.equal(body.messages.at(-1).role, "system");
    assert.match(body.messages.at(-1).content, /回答更简短/);
    assert.match(body.messages.at(-1).content, /不是调用方的新消息/);
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("AI relay timeout covers a delayed response body", async () => {
  const { relayReply } = await import("../src/ai/relay.mjs");
  const mock = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json" });
    setTimeout(() => {
      res.end(JSON.stringify({ choices: [{ message: { content: "late" } }] }));
    }, 500);
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    const started = Date.now();
    await assert.rejects(
      relayReply({
        settings: { endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: "mock", timeoutMs: 100 },
        apiKey: "sk",
        ticket: { id: "timeout-ticket", messages: [{ role: "user", content: "x" }], tools: [] },
      }),
      (error) => error.code === "ai_timeout",
    );
    assert.ok(Date.now() - started < 450, "relay should abort before the delayed body arrives");
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("brand icon and web manifest assets are served", async () => {
  const expected = new Map([
    ["/icon.svg", /image\/svg\+xml/],
    ["/favicon.ico", /image\/x-icon/],
    ["/icon-192.png", /image\/png/],
    ["/icon-512.png", /image\/png/],
    ["/apple-touch-icon.png", /image\/png/],
    ["/manifest.webmanifest", /application\/manifest\+json/],
  ]);
  for (const [pathname, type] of expected) {
    const response = await fetch(`${BASE}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get("content-type") || "", type, pathname);
  }
  const login = await fetch(`${BASE}/login`);
  assert.equal(login.status, 200);
  const html = await login.text();
  assert.match(html, /rel="icon" href="\/icon\.svg"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /class="login-mark" src="\/icon\.svg"/);
});
