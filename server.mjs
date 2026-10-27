#!/usr/bin/env node
/**
 * Human Provider — an OpenAI-compatible chat-completions endpoint whose
 * "model" is a human operator on the other side of a browser console.
 *
 * Zero dependencies. Node >= 20.
 *
 * Caller side:  POST /v1/chat/completions  (stream + non-stream)
 * Operator side: /op/api/* + /console
 */

import http from "node:http";
import https from "node:https";
import os from "node:os";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { AuthError, AuthService } from "./src/auth.mjs";
import { ROOT, loadConfig } from "./src/config.mjs";
import { ApiKeyError, ApiKeyStore } from "./src/data/index.mjs";
import { QuotaError, StateStore, UsageStore } from "./src/data/index.mjs";
import { AuditStore, SettingsError, SettingsStore } from "./src/data/index.mjs";
import { generateSecret, otpauthUrl } from "./src/totp.mjs";
import {
  ANTHROPIC_PROTOCOL,
  OPENAI_PROTOCOL,
  ProtocolError,
  normalizeRequest,
} from "./src/protocol/index.mjs";
import { anthropicMessageJson } from "./src/protocol/anthropic.mjs";
import {
  finishAnthropicStream,
  startAnthropicStream,
  appendAnthropicText,
  appendAnthropicToolCalls,
} from "./src/protocol/stream.mjs";
import { validateJsonSchema, formatSchemaErrors } from "./src/schema.mjs";

const PUBLIC_DIR = path.join(ROOT, "public");
const VERSION = "0.5.0";
const PUBLIC_CONFIG = (() => {
  try {
    return loadConfig();
  } catch (error) {
    console.error(`[config] ${error.message}`);
    process.exit(1);
  }
})();

const config = Object.freeze({
  host: PUBLIC_CONFIG.server.host,
  port: PUBLIC_CONFIG.server.port,
  usersFile: PUBLIC_CONFIG.storage.usersFile,
  apiKeysFile: PUBLIC_CONFIG.storage.apiKeysFile,
  stateFile: PUBLIC_CONFIG.storage.stateFile,
  usageFile: PUBLIC_CONFIG.storage.usageFile,
  settingsFile: PUBLIC_CONFIG.storage.settingsFile,
  auditFile: PUBLIC_CONFIG.storage.auditFile,
  features: PUBLIC_CONFIG.features,
  sessionTtlMs: PUBLIC_CONFIG.auth.sessionTtlMs,
  sessionIdleMs: PUBLIC_CONFIG.auth.sessionIdleMs,
  loginRateWindowMs: PUBLIC_CONFIG.auth.loginRateWindowMs,
  loginIpMaxFailures: PUBLIC_CONFIG.auth.loginIpMaxFailures,
  loginUserMaxFailures: PUBLIC_CONFIG.auth.loginUserMaxFailures,
  cookieSecure: PUBLIC_CONFIG.server.cookieSecure === true,
  cookieSecureMode: PUBLIC_CONFIG.server.cookieSecure,
  tlsEnabled: PUBLIC_CONFIG.tls.enabled,
  tlsCert: PUBLIC_CONFIG.tls.certFile,
  tlsKey: PUBLIC_CONFIG.tls.keyFile,
  trustedHosts: PUBLIC_CONFIG.server.trustedHosts,
  corsOrigins: PUBLIC_CONFIG.server.corsOrigins,
  queueTimeoutMs: PUBLIC_CONFIG.queue.waitTimeoutMs,
  responseTimeoutMs: PUBLIC_CONFIG.queue.responseTimeoutMs,
  streamDelayMs: PUBLIC_CONFIG.queue.streamDelayMs,
  maxConcurrentPerKey: PUBLIC_CONFIG.limits.maxConcurrentPerKey,
  retentionMs: PUBLIC_CONFIG.queue.retentionMs,
  bodyLimitBytes: PUBLIC_CONFIG.limits.bodyLimitBytes,
  logContent: PUBLIC_CONFIG.logging.content,
  configFile: PUBLIC_CONFIG.file,
  modelIds: PUBLIC_CONFIG.models.ids,
  modelCatalog: PUBLIC_CONFIG.models.catalog,
  defaultModel: PUBLIC_CONFIG.models.default,
});

const settingsStore = new SettingsStore({
  file: config.settingsFile,
  defaults: {
    queue: {
      waitTimeoutMs: config.queueTimeoutMs,
      responseTimeoutMs: config.responseTimeoutMs,
      retentionMs: config.retentionMs,
      streamDelayMs: config.streamDelayMs,
    },
    limits: {
      maxConcurrentPerKey: config.maxConcurrentPerKey,
      bodyLimitBytes: config.bodyLimitBytes,
    },
    features: { ...config.features },
  },
  logger: console,
}).init();
const live = settingsStore.values;
const audit = new AuditStore({
  file: config.auditFile,
  logger: console,
  enabled: () => live.features.auditLog,
}).init();


/* ------------------------------------------------------------------ */
/* Models                                                             */
/* ------------------------------------------------------------------ */

const MODELS = new Map();
for (const model of config.modelCatalog) {
  MODELS.set(model.id, {
    ...model,
    created: 1767225600, // 2026-01-01, stable fake creation date
    owned_by: "human-backend",
    humanInTheLoop: true,
    speedMs: model.id.includes("fast")
      ? Math.max(2, Math.round(live.queue.streamDelayMs / 4))
      : live.queue.streamDelayMs,
  });
}

function refreshModelSpeeds() {
  for (const model of MODELS.values()) {
    model.speedMs = model.id.includes("fast")
      ? Math.max(2, Math.round(live.queue.streamDelayMs / 4))
      : live.queue.streamDelayMs;
  }
}

function fingerprint(modelId) {
  return `fp_${createHash("sha256").update(`human:${modelId}`).digest("hex").slice(0, 12)}`;
}

/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

/** @type {Map<string, any>} */
const tickets = new Map();
/** @type {Map<string, number>} */
const slots = new Map();
const stats = {
  created: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  timedOut: 0,
  claimCount: 0,
  claimWaitMs: 0,
  handledCount: 0,
  handledMs: 0,
  completionTokens: 0,
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(status, message, type = "invalid_request_error", code = null, param = null, headers = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
    this.code = code;
    this.param = param;
    this.headers = headers;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
function log(...args) {
  console.log(nowIso(), ...args);
}

/* ------------------------------------------------------------------ */
/* Account auth                                                       */
/* ------------------------------------------------------------------ */

const auth = new AuthService({
  usersFile: config.usersFile,
  sessionTtlMs: config.sessionTtlMs,
  sessionIdleMs: config.sessionIdleMs,
  loginRateWindowMs: config.loginRateWindowMs,
  loginIpMaxFailures: config.loginIpMaxFailures,
  loginUserMaxFailures: config.loginUserMaxFailures,
  secureCookies: config.cookieSecure,
  logger: console,
}).init();

const apiKeys = new ApiKeyStore({
  file: config.apiKeysFile,
  logger: console,
}).init();

const usageStore = new UsageStore({
  file: config.usageFile,
  logger: console,
}).init();

const stateStore = new StateStore({
  file: config.stateFile,
  logger: console,
}).init();

const bootstrap = auth.ensureBootstrap({ username: "admin" });
if (bootstrap.created && bootstrap.generated) {
  log("============================================================");
  log("  初始管理员账号已生成（只显示这一次，请立即保存并修改密码）");
  log(`  username: ${bootstrap.username}`);
  log(`  password: ${bootstrap.password}`);
  log("============================================================");
}

const CJK_RE = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u;

function countTokens(text) {
  const value = String(text ?? "");
  if (!value) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of value) {
    if (CJK_RE.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.max(1, cjk + Math.ceil(other / 4));
}

function capToTokens(text, maxTokens) {
  let used = 0;
  let out = "";
  for (const ch of text) {
    const weight = CJK_RE.test(ch) ? 1 : 0.25;
    if (used + weight > maxTokens && out.length > 0) {
      return { text: out, truncated: true };
    }
    out += ch;
    used += weight;
  }
  return { text, truncated: false };
}

function applyStop(text, stops) {
  if (!stops?.length) return { text, hit: null };
  let cut = -1;
  let hit = null;
  for (const stop of stops) {
    const at = text.indexOf(stop);
    if (at !== -1 && (cut === -1 || at < cut)) {
      cut = at;
      hit = stop;
    }
  }
  return cut === -1 ? { text, hit: null } : { text: text.slice(0, cut), hit };
}

function splitForStream(text) {
  // Word-ish units for Latin text, per-character units for CJK, whitespace kept.
  const units = text.match(/[\u2e80-\u9fff\uac00-\ud7af]|[^\s\u2e80-\u9fff\uac00-\ud7af]+|\s+/gu) || [];
  const parts = [];
  let i = 0;
  while (i < units.length) {
    const n = 1 + Math.floor(Math.random() * 3);
    parts.push(units.slice(i, i + n).join(""));
    i += n;
  }
  return parts.filter(Boolean);
}

function isResOpen(res) {
  return Boolean(res) && !res.writableEnded && !res.destroyed;
}

function corsHeaders(req) {
  const configured = config.corsOrigins;
  let origin = "null";
  if (configured.includes("*")) origin = "*";
  else {
    const requestOrigin = String(req?.headers?.origin || "");
    if (requestOrigin && configured.includes(requestOrigin)) origin = requestOrigin;
  }
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization,Content-Type,Idempotency-Key,X-Api-Key,Anthropic-Version,Anthropic-Beta",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
  if (origin !== "*") headers.Vary = "Origin";
  return headers;
}

function applyCorsTo(req, res) {
  for (const [key, value] of Object.entries(corsHeaders(req))) res.setHeader(key, value);
}

function computeAllowedHosts() {
  const hosts = new Set();
  const add = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized) hosts.add(normalized);
  };
  add(`127.0.0.1:${config.port}`);
  add(`localhost:${config.port}`);
  add(`[::1]:${config.port}`);
  add("127.0.0.1");
  add("localhost");
  add("[::1]");
  if (config.host === "0.0.0.0" || config.host === "::" || config.host === "[::]") {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries || []) {
        if (entry.family === "IPv4" && !entry.internal) {
          add(`${entry.address}:${config.port}`);
          add(entry.address);
        }
      }
    }
  } else {
    add(`${config.host}:${config.port}`);
    add(config.host);
  }
  for (const host of config.trustedHosts) add(host);
  return hosts;
}

const ALLOWED_HOSTS = computeAllowedHosts();

function clientIp(req) {
  return String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "") || "unknown";
}

function hostAllowed(hostHeader) {
  const host = String(hostHeader || "").trim().toLowerCase();
  return Boolean(host) && ALLOWED_HOSTS.has(host);
}

function assertTrustedHost(req) {
  if (!hostAllowed(req.headers.host)) {
    log(`[security] untrusted host=${req.headers.host || "-"} ip=${clientIp(req)}`);
    throw new ApiError(421, "Misdirected request.", "invalid_request_error", "untrusted_host");
  }
}

function originAllowed(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (hostAllowed(url.host)) return true;
    const defaultPort = url.protocol === "https:" ? "443" : "80";
    return hostAllowed(`${url.hostname}:${url.port || defaultPort}`) || hostAllowed(url.hostname);
  } catch {
    return false;
  }
}

function assertSameOrigin(req) {
  if (String(req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site") {
    throw new ApiError(403, "Cross-site request rejected.", "invalid_request_error", "cross_site_request");
  }
  const origin = req.headers.origin;
  const secFetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  const loginPost = req.method === "POST" && String(req.url || "").split("?")[0] === "/auth/login";
  if (origin === "null") {
    // Some local browsers/proxies render a normal same-origin form submission
    // with an opaque Origin but still set Sec-Fetch-Site: same-origin. This is
    // not cross-site CSRF; allow it. Missing/cross-site values stay rejected
    // for operator APIs. Login is allowed without the marker because an opaque
    // origin can legitimately omit it and login CSRF only targets the login
    // response (there is no authenticated action and the session cookie is
    // SameSite=Strict).
    if (loginPost && ["", "none", "same-origin"].includes(secFetchSite)) {
      log(`[security] allowing null Origin for login host=${req.headers.host || "-"} site=${secFetchSite || "-"}`);
      return;
    }
    if (secFetchSite === "same-origin") {
      log(`[security] allowing null Origin for same-origin browser host=${req.headers.host || "-"}`);
      return;
    }
    log(`[security] rejected null origin host=${req.headers.host || "-"} ip=${clientIp(req)} site=${secFetchSite || "-"}`);
    throw new ApiError(403, "Origin is not allowed.", "invalid_request_error", "invalid_origin");
  }
  if (origin && !originAllowed(origin)) {
    log(`[security] rejected origin=${origin} host=${req.headers.host || "-"} ip=${clientIp(req)}`);
    throw new ApiError(403, "Origin is not allowed.", "invalid_request_error", "invalid_origin");
  }
}

function applySecurityHeaders(req, res) {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  );
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
  if (req.socket?.encrypted || config.cookieSecure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader("X-Request-Id", `req_${randomBytes(12).toString("hex")}`);
  res.setHeader("X-NGZR-API-Version", VERSION);
}

function sendJson(res, status, payload, extraHeaders = {}) {
  if (!isResOpen(res)) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function sendRaw(res, status, contentType, body, extraHeaders = {}) {
  if (!isResOpen(res)) return;
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function sendSse(res, payload) {
  if (!isResOpen(res)) return false;
  try {
    return res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    return false;
  }
}

async function readBody(req, limit) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared && declared > limit) {
    throw new ApiError(413, "Request body too large.", "invalid_request_error", "payload_too_large");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new ApiError(413, "Request body too large.", "invalid_request_error", "payload_too_large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonWithRaw(req) {
  const raw = await readBody(req, live.limits.bodyLimitBytes);
  if (!raw) return { body: {}, raw: "" };
  try {
    return { body: JSON.parse(raw), raw };
  } catch {
    throw new ApiError(400, "We could not parse the JSON body of your request.", "invalid_request_error", "invalid_json");
  }
}

async function readJson(req) {
  return (await readJsonWithRaw(req)).body;
}

function setRateLimitHeaders(res, caller) {
  const used = slots.get(caller.key) || 0;
  const limit = Number(caller.limits?.maxConcurrent) || live.limits.maxConcurrentPerKey;
  res.setHeader("x-ratelimit-limit-requests", String(limit));
  res.setHeader("x-ratelimit-remaining-requests", String(Math.max(0, limit - used)));
  res.setHeader("x-ratelimit-reset-requests", "1s");
  if (caller.limits?.requestsPerMinute) {
    res.setHeader("x-ratelimit-limit-rpm", String(caller.limits.requestsPerMinute));
  }
}

const idempotencyRecords = new Map();
const IDEMPOTENCY_TTL_MS = 30 * 60_000;
const IDEMPOTENCY_MAX = 2000;

function persistRuntime() {
  try {
    stateStore.snapshot(tickets.values(), idempotencyRecords.entries());
  } catch (error) {
    log(`[state] snapshot failed: ${error.message}`);
  }
}

const restoredTickets = stateStore.restoreTickets();
for (const restored of restoredTickets) tickets.set(restored.id, restored);
for (const record of stateStore.idempotency) {
  if (record?.key && record?.ticketId) idempotencyRecords.set(record.key, record);
}
if (restoredTickets.length) {
  log(`[state] restored ${restoredTickets.length} tickets (${restoredTickets.filter((t) => t.state === "failed").length} interrupted)`);
}

function requestIdempotencyKey(req, caller) {
  const raw = String(req.headers["idempotency-key"] || "").trim();
  if (!raw) return null;
  if (raw.length > 128 || !/^[A-Za-z0-9._~-]+$/.test(raw)) {
    throw new ApiError(400, "Idempotency-Key must be 1-128 URL-safe characters.", "invalid_request_error", "invalid_idempotency_key");
  }
  const callerHash = createHash("sha256").update(caller.key).digest("hex").slice(0, 16);
  return `${callerHash}:${raw}`;
}

function pruneIdempotency() {
  const now = Date.now();
  for (const [key, record] of idempotencyRecords) {
    if (now - record.createdAt > IDEMPOTENCY_TTL_MS) idempotencyRecords.delete(key);
  }
  while (idempotencyRecords.size > IDEMPOTENCY_MAX) {
    idempotencyRecords.delete(idempotencyRecords.keys().next().value);
  }
}

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function anthropicErrorType(type) {
  if (type === "authentication_error") return "authentication_error";
  if (type === "rate_limit_error") return "rate_limit_error";
  if (type === "not_found_error") return "not_found_error";
  if (type === "server_error") return "api_error";
  if (type === "overloaded_error") return "overloaded_error";
  return "invalid_request_error";
}

function anthropicErrorBody({ message, type, code }) {
  return {
    type: "error",
    error: {
      type: anthropicErrorType(type),
      message: String(message || "The server had an error while processing your request."),
      ...(code ? { code } : {}),
    },
  };
}

function sendAnthropicError(res, status, error, headers = {}) {
  return sendJson(res, status, anthropicErrorBody(error), headers);
}

function sendAnthropicSseError(res, error) {
  if (!isResOpen(res)) return false;
  try {
    return res.write(`event: error\ndata: ${JSON.stringify(anthropicErrorBody(error))}\n\n`);
  } catch {
    return false;
  }
}

function sendProtocolError(res, status, error, protocol = OPENAI_PROTOCOL, headers = {}) {
  if (protocol === ANTHROPIC_PROTOCOL) return sendAnthropicError(res, status, error, headers);
  return sendJson(
    res,
    status,
    {
      error: {
        message: error.message,
        type: error.type || "server_error",
        param: error.param ?? null,
        code: error.code ?? null,
      },
    },
    headers,
  );
}

function replayTicket(ticket, res) {
  if (ticket.state === "failed" || ticket.state === "cancelled") {
    return sendProtocolError(res, 409, {
      message: "The original request did not complete successfully.",
      type: "server_error",
      code: "idempotent_request_failed",
    }, ticket.protocol);
  }
  if (ticket.stream) {
    res.writeHead(200, sseHeaders());
    res.flushHeaders?.();
    if (ticket.protocol === ANTHROPIC_PROTOCOL) {
      for (const frame of ticket.anthLog || []) res.write(frame);
    } else {
      for (const payload of ticket.sseLog || []) sendSse(res, payload);
      res.write("data: [DONE]\n\n");
    }
    res.end();
    return;
  }
  if (ticket.protocol === ANTHROPIC_PROTOCOL) {
    return sendJson(res, 200, anthropicMessageJson(ticket, ticket.usage || usageFor(ticket)));
  }
  return sendJson(res, 200, completionJson(ticket, ticket.usage || usageFor(ticket)));
}

function requireSession(req, { csrf = false } = {}) {
  const session = auth.getSession(req);
  if (!session) {
    throw new ApiError(401, "Authentication required.", "authentication_error", "login_required");
  }
  if (csrf && !auth.csrfMatches(session, req.headers["x-csrf-token"])) {
    throw new ApiError(403, "CSRF token missing or invalid.", "authentication_error", "invalid_csrf");
  }
  return session;
}

function authenticateCaller(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer[ \t]+(.+)$/i.exec(String(header).trim());
  const bearer = match ? match[1].trim() : "";
  const xApiKey = String(req.headers["x-api-key"] || "").trim();
  const token = bearer || xApiKey;
  if (!token) {
    throw new ApiError(
      401,
      "You didn't provide an API key. Use Authorization: Bearer <key> or x-api-key: <key>.",
      "authentication_error",
      "missing_api_key",
    );
  }
  const entry = apiKeys.authenticate(token);
  if (!entry) {
    throw new ApiError(
      401,
      "Incorrect API key provided. Please check your API key and try again.",
      "authentication_error",
      "invalid_api_key",
    );
  }
  return entry;
}

/* ------------------------------------------------------------------ */
/* Auth                                                               */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Request parsing                                                    */
/* ------------------------------------------------------------------ */

function normalizeFinishReason(value) {
  return ["stop", "length", "content_filter", "tool_calls"].includes(value) ? value : "stop";
}

function normalizeTools(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(400, "tools must be an array.", "invalid_request_error", "invalid_tools", "tools");
  }
  const tools = [];
  for (const item of raw.slice(0, 128)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (item.type !== "function" || !item.function || typeof item.function !== "object") continue;
    const fn = item.function;
    const name = typeof fn.name === "string" ? fn.name.trim() : "";
    if (!name) continue;
    tools.push({
      type: "function",
      function: {
        name: name.slice(0, 64),
        description: typeof fn.description === "string" ? fn.description.slice(0, 16_000) : "",
        parameters:
          fn.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters)
            ? fn.parameters
            : { type: "object", properties: {} },
        ...(fn.strict === true ? { strict: true } : {}),
      },
    });
  }
  return tools;
}

function normalizeResponseFormat(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(400, "response_format must be an object.", "invalid_request_error", "invalid_response_format", "response_format");
  }
  if (raw.type === "text") return { type: "text" };
  if (raw.type === "json_object") return { type: "json_object" };
  if (raw.type === "json_schema") {
    const spec = raw.json_schema;
    if (!spec || typeof spec !== "object" || !spec.schema || typeof spec.schema !== "object" || Array.isArray(spec.schema)) {
      throw new ApiError(
        400,
        "response_format.json_schema.schema must be a JSON Schema object.",
        "invalid_request_error",
        "invalid_response_format",
        "response_format",
      );
    }
    return {
      type: "json_schema",
      json_schema: {
        name: typeof spec.name === "string" ? spec.name.slice(0, 64) : "response",
        schema: spec.schema,
        strict: spec.strict === true,
      },
    };
  }
  throw new ApiError(
    400,
    "response_format.type must be 'text', 'json_object', or 'json_schema'.",
    "invalid_request_error",
    "invalid_response_format",
    "response_format",
  );
}

function isJsonMode(ticket) {
  return ticket.responseFormat?.type === "json_object" || ticket.responseFormat?.type === "json_schema";
}

function validateStructuredText(ticket, text) {
  if (!isJsonMode(ticket)) return;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(
      400,
      "response_format is enabled, but the reply is not valid JSON. Fix the draft and try again.",
      "invalid_request_error",
      "invalid_response_json",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(
      400,
      "response_format is enabled, but the reply must be a JSON object.",
      "invalid_request_error",
      "invalid_response_json",
    );
  }
  if (ticket.responseFormat.type === "json_schema") {
    const result = validateJsonSchema(parsed, ticket.responseFormat.json_schema.schema);
    if (!result.ok) {
      throw new ApiError(
        400,
        `response_format validation failed: ${formatSchemaErrors(result.errors)}`,
        "invalid_request_error",
        "invalid_response_json",
      );
    }
  }
}

function normalizeToolChoice(raw, tools) {
  if (raw === undefined || raw === null) return tools.length ? "auto" : "none";
  if (typeof raw === "string") {
    if (!["auto", "none", "required"].includes(raw)) {
      throw new ApiError(
        400,
        "tool_choice must be 'auto', 'none', 'required', or a function selector.",
        "invalid_request_error",
        "invalid_tool_choice",
        "tool_choice",
      );
    }
    if (raw === "required" && !tools.length) {
      throw new ApiError(
        400,
        "tool_choice 'required' needs at least one tool.",
        "invalid_request_error",
        "invalid_tool_choice",
        "tool_choice",
      );
    }
    return raw;
  }
  if (!tools.length) {
    throw new ApiError(
      400,
      "A tool_choice function selector needs at least one tool.",
      "invalid_request_error",
      "invalid_tool_choice",
      "tool_choice",
    );
  }
  if (
    raw &&
    typeof raw === "object" &&
    raw.type === "function" &&
    raw.function &&
    typeof raw.function.name === "string"
  ) {
    const name = raw.function.name.trim();
    if (!name) {
      throw new ApiError(400, "tool_choice function name cannot be empty.", "invalid_request_error", "invalid_tool_choice", "tool_choice");
    }
    if (tools.length && !tools.some((tool) => tool.function.name === name)) {
      throw new ApiError(
        400,
        `tool_choice names '${name}', which is not in tools.`,
        "invalid_request_error",
        "invalid_tool_choice",
        "tool_choice",
      );
    }
    return { type: "function", name };
  }
  throw new ApiError(
    400,
    "tool_choice must be 'auto', 'none', 'required', or a function selector.",
    "invalid_request_error",
    "invalid_tool_choice",
    "tool_choice",
  );
}

function normalizeMessageToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  const calls = [];
  for (const call of raw.slice(0, 32)) {
    if (!call || typeof call !== "object" || !call.function || typeof call.function !== "object") continue;
    const name = typeof call.function.name === "string" ? call.function.name.slice(0, 64) : "";
    if (!name) continue;
    const args =
      typeof call.function.arguments === "string"
        ? call.function.arguments
        : JSON.stringify(call.function.arguments ?? {});
    calls.push({
      id:
        typeof call.id === "string" && call.id
          ? call.id.slice(0, 128)
          : `call_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      type: "function",
      function: { name, arguments: args.slice(0, 64_000) },
    });
  }
  return calls;
}

function normalizeOperatorToolCalls(ticket, raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError(400, "toolCalls must be an array.", "invalid_request_error", "invalid_tool_calls");
  }
  if (raw.length === 0) return [];
  if (!ticket.tools.length) {
    throw new ApiError(400, "This request declared no tools.", "invalid_request_error", "no_tools");
  }
  if (ticket.toolChoice === "none") {
    throw new ApiError(400, "tool_choice is 'none' for this request.", "invalid_request_error", "tool_choice_none");
  }
  if (ticket.parallelToolCalls === false && raw.length > 1) {
    throw new ApiError(400, "This request disallows parallel tool calls.", "invalid_request_error", "parallel_tool_calls_disabled");
  }
  if (raw.length > 16) {
    throw new ApiError(400, "At most 16 tool calls are allowed.", "invalid_request_error", "too_many_tool_calls");
  }

  const byName = new Map(ticket.tools.map((tool) => [tool.function.name, tool]));
  const calls = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new ApiError(400, "Each tool call must be an object.", "invalid_request_error", "invalid_tool_calls");
    }
    const name =
      typeof item.name === "string"
        ? item.name
        : item.function && typeof item.function.name === "string"
          ? item.function.name
          : "";
    if (!name) {
      throw new ApiError(400, "Each tool call needs a name.", "invalid_request_error", "invalid_tool_call_name");
    }
    if (!byName.has(name)) {
      throw new ApiError(400, `Unknown tool '${name}'.`, "invalid_request_error", "unknown_tool");
    }
    if (ticket.toolChoice && typeof ticket.toolChoice === "object" && ticket.toolChoice.name !== name) {
      throw new ApiError(
        400,
        `tool_choice requires '${ticket.toolChoice.name}', not '${name}'.`,
        "invalid_request_error",
        "tool_choice_mismatch",
      );
    }

    let parsed;
    const rawArgs = item.arguments ?? item.function?.arguments ?? {};
    if (typeof rawArgs === "string") {
      if (rawArgs.length > 64_000) {
        throw new ApiError(413, "Tool arguments are too large.", "invalid_request_error", "tool_arguments_too_large");
      }
      try {
        parsed = JSON.parse(rawArgs);
      } catch {
        throw new ApiError(
          400,
          `Arguments for '${name}' are not valid JSON.`,
          "invalid_request_error",
          "invalid_tool_arguments",
        );
      }
    } else {
      parsed = rawArgs;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ApiError(
        400,
        `Arguments for '${name}' must be a JSON object.`,
        "invalid_request_error",
        "invalid_tool_arguments",
      );
    }
    const schemaCheck = validateJsonSchema(parsed, byName.get(name).function.parameters);
    if (!schemaCheck.ok) {
      throw new ApiError(
        400,
        `Arguments for '${name}' do not match the tool schema: ${formatSchemaErrors(schemaCheck.errors)}`,
        "invalid_request_error",
        "invalid_tool_arguments",
      );
    }
    calls.push({
      id: `call_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
      type: "function",
      function: { name, arguments: JSON.stringify(parsed) },
    });
  }
  return calls;
}


function normalizeMaxTokens(body) {
  const raw = body.max_tokens ?? body.max_completion_tokens;
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ApiError(400, "max_tokens must be a positive integer.", "invalid_request_error", "invalid_max_tokens", "max_tokens");
  }
  return Math.min(32000, Math.trunc(n));
}

function normalizeStops(raw) {
  if (raw === undefined || raw === null) return [];
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : null;
  if (!list) {
    throw new ApiError(400, "stop must be a string or an array of strings.", "invalid_request_error", "invalid_stop", "stop");
  }
  const out = [];
  for (const item of list) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (out.length >= 4) {
      throw new ApiError(400, "You can provide at most 4 stop sequences.", "invalid_request_error", "invalid_stop", "stop");
    }
    out.push(item);
  }
  return out;
}

function extractMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiError(400, "messages must be a non-empty array.", "invalid_request_error", "invalid_messages", "messages");
  }
  const allowedRoles = new Set(["system", "developer", "user", "assistant", "tool", "function"]);
  const messages = [];
  const attachments = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ApiError(400, "Each message must be an object.", "invalid_request_error", "invalid_messages", "messages");
    }
    const role = typeof entry.role === "string" ? entry.role : "";
    if (!allowedRoles.has(role)) {
      throw new ApiError(400, `Invalid role '${role}'.`, "invalid_request_error", "invalid_role", "messages");
    }
    const messageIndex = messages.length;
    let text = "";

    if (typeof entry.content === "string") {
      text = entry.content;
    } else if (Array.isArray(entry.content)) {
      for (const part of entry.content) {
        if (typeof part === "string") {
          text += part;
          continue;
        }
        if (!part || typeof part !== "object") continue;
        const type = part.type;
        if (type === "text" || type === "input_text") {
          if (typeof part.text === "string") text += part.text;
        } else if (type === "image_url" || type === "input_image") {
          const rawUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
          const url = typeof rawUrl === "string" ? rawUrl : "";
          const safe =
            /^https?:\/\//i.test(url) || /^data:image\/(?:png|jpe?g|webp|gif)[;,]/i.test(url);
          if (safe && url.length <= 2_000_000) {
            attachments.push({
              messageIndex,
              url,
              detail: part.image_url?.detail || part.detail || "auto",
            });
            text += "\n[image attached]";
          } else {
            text += "\n[unsupported image]";
          }
        } else if (type) {
          text += `\n[${String(type).slice(0, 40)} omitted]`;
        }
      }
    } else if (entry.content !== undefined && entry.content !== null) {
      throw new ApiError(400, "Message content must be a string or an array.", "invalid_request_error", "invalid_messages", "messages");
    }

    const toolCalls = role === "assistant" ? normalizeMessageToolCalls(entry.tool_calls) : [];
    messages.push({
      role,
      content: text,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      ...(typeof entry.name === "string" ? { name: entry.name.slice(0, 64) } : {}),
      ...(typeof entry.tool_call_id === "string" ? { tool_call_id: entry.tool_call_id.slice(0, 128) } : {}),
    });
  }

  return { messages, attachments };
}

function promptTokensFor(messages) {
  return (
    messages.reduce((sum, message) => {
      const toolText = message.tool_calls ? JSON.stringify(message.tool_calls) : "";
      return sum + countTokens(message.role) + countTokens(message.content) + countTokens(toolText) + 4;
    }, 0) + 2
  );
}

/* ------------------------------------------------------------------ */
/* Tickets                                                           */
/* ------------------------------------------------------------------ */

function consumeQuota(caller) {
  try {
    usageStore.consume(caller.id, caller.limits || {});
  } catch (error) {
    if (error instanceof QuotaError) {
      throw new ApiError(429, error.message, "rate_limit_error", error.code, null, {
        "Retry-After": String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))),
      });
    }
    throw error;
  }
}

function takeSlot(caller) {
  const key = caller.key;
  const used = slots.get(key) || 0;
  const limit = Number(caller.limits?.maxConcurrent) || live.limits.maxConcurrentPerKey;
  if (used >= limit) return null;
  slots.set(key, used + 1);
  return () => {
    const current = slots.get(key) || 0;
    if (current <= 1) slots.delete(key);
    else slots.set(key, current - 1);
  };
}

function createTicket({ request, caller, releaseSlot }) {
  const created = Date.now();
  let resolveDone;
  const donePromise = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const protocol = request.protocol || OPENAI_PROTOCOL;
  const idPrefix = protocol === ANTHROPIC_PROTOCOL ? "msg_" : "chatcmpl-";
  return {
    id: `${idPrefix}${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    protocol,
    created,
    createdSec: Math.floor(created / 1000),
    model: request.model,
    stream: request.stream === true,
    includeUsage: request.includeUsage === true,
    messages: request.messages,
    attachments: request.attachments,
    callerKey: caller.key,
    callerLabel: caller.label,
    promptTokens: promptTokensFor(request.messages),
    maxTokens: request.maxTokens,
    stops: request.stops,
    tools: request.tools,
    toolChoice: request.toolChoice,
    parallelToolCalls: request.parallelToolCalls !== false,
    toolCalls: [],
    responseFormat: request.responseFormat,
    reasoning: "",
    effort: request.effort || "",
    refusal: null,
    clientUser: request.clientUser,
    donePromise,
    resolveDone,
    sseLog: [],
    anthLog: [],
    anthStarted: false,
    anthTextOpen: false,
    anthBlockIndex: 0,
    state: "queued",
    claimedBy: null,
    claimedAt: null,
    finishedAt: null,
    finished: false,
    clientGone: false,
    text: "",
    delivered: 0,
    finishReason: null,
    forcedFinishReason: null,
    usage: null,
    res: null,
    headersSent: false,
    heartbeat: null,
    sendChain: Promise.resolve(),
    timers: {},
    speedMs: MODELS.get(request.model)?.speedMs ?? live.queue.streamDelayMs,
    releaseSlot,
  };
}

function requireTicket(id) {
  const ticket = tickets.get(id);
  if (!ticket) {
    throw new ApiError(404, "Ticket not found.", "invalid_request_error", "ticket_not_found");
  }
  return ticket;
}

function clearTicketTimers(ticket) {
  clearTimeout(ticket.timers.queue);
  clearTimeout(ticket.timers.response);
  if (ticket.heartbeat) {
    clearInterval(ticket.heartbeat);
    ticket.heartbeat = null;
  }
  ticket.timers.queue = null;
  ticket.timers.response = null;
}

function releaseTicketSlot(ticket) {
  if (ticket.releaseSlot) {
    ticket.releaseSlot();
    ticket.releaseSlot = null;
  }
}

function scheduleRetention(ticket) {
  ticket.timers.retention = setTimeout(() => {
    tickets.delete(ticket.id);
    persistRuntime();
  }, live.queue.retentionMs);
  ticket.timers.retention.unref?.();
}

function armQueueTimeout(ticket) {
  clearTimeout(ticket.timers.queue);
  ticket.timers.queue = setTimeout(() => {
    if (ticket.state !== "queued") return;
    stats.timedOut += 1;
    log(`[queue-timeout] ${ticket.id} after ${live.queue.waitTimeoutMs}ms`);
    finalizeError(
      ticket,
      503,
      "The server is currently overloaded. Please try again later.",
      "server_error",
      "overloaded",
      { "Retry-After": "5" },
    );
  }, live.queue.waitTimeoutMs);
  ticket.timers.queue.unref?.();
}

function armResponseTimeout(ticket) {
  clearTimeout(ticket.timers.response);
  ticket.timers.response = setTimeout(() => {
    if (ticket.finished) return;
    if (!["claimed", "streaming"].includes(ticket.state)) return;
    stats.timedOut += 1;
    log(`[response-timeout] ${ticket.id} after ${live.queue.responseTimeoutMs}ms`);
    finalizeError(
      ticket,
      504,
      "The upstream provider timed out while generating a response.",
      "server_error",
      "upstream_timeout",
    );
  }, live.queue.responseTimeoutMs);
  ticket.timers.response.unref?.();
}

function appendText(ticket, raw) {
  if (typeof raw !== "string" || raw.length === 0) return { added: 0, forced: null, total: ticket.text.length };
  const before = ticket.text.length;
  let candidate = ticket.text + raw;

  const stop = applyStop(candidate, ticket.stops);
  if (stop.hit) {
    candidate = stop.text;
    ticket.forcedFinishReason = "stop";
  }
  if (ticket.maxTokens) {
    const capped = capToTokens(candidate, ticket.maxTokens);
    if (capped.truncated) {
      candidate = capped.text;
      ticket.forcedFinishReason = "length";
    }
  }

  ticket.text = candidate;
  return {
    added: ticket.text.length - before,
    forced: ticket.forcedFinishReason,
    total: ticket.text.length,
  };
}

/* ------------------------------------------------------------------ */
/* SSE / completions                                                  */
/* ------------------------------------------------------------------ */

function chunkPayload(ticket, delta, finishReason = null) {
  return {
    id: ticket.id,
    object: "chat.completion.chunk",
    created: ticket.createdSec,
    model: ticket.model,
    system_fingerprint: fingerprint(ticket.model),
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
  };
}

function emitSse(ticket, payload) {
  ticket.sseLog.push(payload);
  return sendSse(ticket.res, payload);
}

function beginStream(ticket) {
  if (ticket.headersSent) return;
  ticket.headersSent = true;
  ticket.state = "streaming";
  const res = ticket.res;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  if (ticket.protocol === ANTHROPIC_PROTOCOL) startAnthropicStream(ticket);
  else emitSse(ticket, chunkPayload(ticket, { role: "assistant", content: "" }));
  ticket.heartbeat = setInterval(() => {
    if (!isResOpen(res)) return;
    try {
      res.write(": keep-alive\n\n");
    } catch {
      /* socket closed; the close handler will clean up */
    }
  }, 15_000);
  ticket.heartbeat.unref?.();
}

function usageFor(ticket) {
  const toolText = (ticket.toolCalls || [])
    .map((call) => `${call.function.name}${call.function.arguments}`)
    .join("");
  const reasoningTokens = countTokens(ticket.reasoning || "");
  const completion =
    countTokens(ticket.text) +
    countTokens(toolText) +
    countTokens(ticket.refusal || "") +
    reasoningTokens;
  return {
    prompt_tokens: ticket.promptTokens,
    completion_tokens: completion,
    total_tokens: ticket.promptTokens + completion,
    prompt_tokens_details: { cached_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: reasoningTokens },
  };
}

function completionJson(ticket, usage) {
  const message = {
    role: "assistant",
    content: ticket.refusal
      ? null
      : ticket.toolCalls.length
        ? ticket.text || null
        : ticket.text,
  };
  if (ticket.refusal) message.refusal = ticket.refusal;
  if (ticket.reasoning) message.reasoning_content = ticket.reasoning;
  if (ticket.toolCalls.length) message.tool_calls = ticket.toolCalls;
  return {
    id: ticket.id,
    object: "chat.completion",
    created: ticket.createdSec,
    model: ticket.model,
    choices: [
      {
        index: 0,
        message,
        logprobs: null,
        finish_reason: ticket.finishReason,
      },
    ],
    usage,
    system_fingerprint: fingerprint(ticket.model),
  };
}

function writeToolCallDeltas(ticket) {
  if (ticket.protocol === ANTHROPIC_PROTOCOL) {
    appendAnthropicToolCalls(ticket);
    return;
  }
  for (const [index, call] of ticket.toolCalls.entries()) {
    emitSse(
      ticket,
      chunkPayload(ticket, {
        tool_calls: [
          {
            index,
            id: call.id,
            type: "function",
            function: { name: call.function.name, arguments: "" },
          },
        ],
      }),
    );
    const args = call.function.arguments || "{}";
    const size = Math.max(16, Math.ceil(args.length / 2));
    for (let offset = 0; offset < args.length; offset += size) {
      emitSse(
        ticket,
        chunkPayload(ticket, {
          tool_calls: [{ index, function: { arguments: args.slice(offset, offset + size) } }],
        }),
      );
    }
  }
}

function writeReasoning(ticket) {
  if (!ticket.reasoning || ticket.protocol === ANTHROPIC_PROTOCOL) return;
  ticket.reasoningSent = true;
  const parts = splitForStream(ticket.reasoning);
  for (const part of parts) {
    emitSse(ticket, chunkPayload(ticket, { reasoning_content: part }));
  }
}

function writeRefusal(ticket) {
  if (!ticket.refusal) return;
  if (ticket.protocol === ANTHROPIC_PROTOCOL) {
    appendAnthropicText(ticket, ticket.refusal);
    return;
  }
  const parts = splitForStream(ticket.refusal);
  for (const part of parts) {
    emitSse(ticket, chunkPayload(ticket, { refusal: part }));
  }
}

function writeStreamFinal(ticket, usage) {
  const res = ticket.res;
  if (ticket.heartbeat) {
    clearInterval(ticket.heartbeat);
    ticket.heartbeat = null;
  }
  if (ticket.protocol === ANTHROPIC_PROTOCOL) {
    if (ticket.refusal) appendAnthropicText(ticket, ticket.refusal);
    else if (ticket.text.length > ticket.delivered) {
      appendAnthropicText(ticket, ticket.text.slice(ticket.delivered));
      ticket.delivered = ticket.text.length;
    }
    if (ticket.toolCalls.length) appendAnthropicToolCalls(ticket);
    finishAnthropicStream(ticket, usage);
    res.end();
    return;
  }
  if (ticket.refusal) writeRefusal(ticket);
  else if (ticket.reasoning && !ticket.reasoningSent) writeReasoning(ticket);
  if (ticket.toolCalls.length) writeToolCallDeltas(ticket);
  emitSse(ticket, chunkPayload(ticket, {}, ticket.finishReason));
  if (ticket.includeUsage) {
    emitSse(ticket, {
      id: ticket.id,
      object: "chat.completion.chunk",
      created: ticket.createdSec,
      model: ticket.model,
      system_fingerprint: fingerprint(ticket.model),
      choices: [],
      usage,
    });
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

async function flushPending(ticket, paced) {
  if (!ticket.stream || ticket.finished || ticket.clientGone) return;
  if (ticket.delivered >= ticket.text.length) return;
  if (!ticket.headersSent) beginStream(ticket);

  const from = ticket.delivered;
  const to = ticket.text.length;
  const pending = ticket.text.slice(from, to);
  const parts = paced ? splitForStream(pending) : [pending];

  for (const part of parts) {
    if (ticket.clientGone || ticket.finished) return;
    if (ticket.protocol === ANTHROPIC_PROTOCOL) {
      appendAnthropicText(ticket, part);
    } else if (!emitSse(ticket, chunkPayload(ticket, { content: part }))) {
      return;
    }
    if (paced && live.queue.streamDelayMs > 0) {
      const delay = Math.max(0, Math.round(ticket.speedMs * (0.6 + Math.random() * 0.8)));
      if (delay > 0) await sleep(delay);
    }
  }
  ticket.delivered = Math.max(ticket.delivered, to);
}

function queueFlush(ticket, paced) {
  ticket.sendChain = ticket.sendChain
    .then(() => flushPending(ticket, paced))
    .catch((error) => {
      log(`[stream-error] ${ticket.id} ${error.message}`);
    });
  return ticket.sendChain;
}

function finalize(ticket, finishReason) {
  if (ticket.finished) return;
  ticket.finished = true;
  ticket.finishedAt = Date.now();
  ticket.finishReason =
    ticket.forcedFinishReason ||
    (ticket.refusal
      ? "content_filter"
      : ticket.toolCalls.length
        ? "tool_calls"
        : normalizeFinishReason(finishReason));
  ticket.state = "done";
  clearTicketTimers(ticket);
  releaseTicketSlot(ticket);

  const usage = usageFor(ticket);
  ticket.usage = usage;
  usageStore.addTokens(ticket.callerKey, usage.completion_tokens);
  stats.completed += 1;
  stats.completionTokens += usage.completion_tokens;
  if (ticket.claimedAt) {
    stats.handledMs += ticket.finishedAt - ticket.claimedAt;
    stats.handledCount += 1;
  }

  if (ticket.stream) {
    if (ticket.headersSent && !ticket.clientGone && isResOpen(ticket.res)) {
      writeStreamFinal(ticket, usage);
    } else if (!ticket.headersSent && !ticket.clientGone && isResOpen(ticket.res)) {
      // Defensive: a stream that was finalized before headers were flushed.
      if (ticket.protocol === ANTHROPIC_PROTOCOL) {
        sendJson(ticket.res, 200, anthropicMessageJson(ticket, usage));
      } else {
        sendJson(ticket.res, 200, completionJson(ticket, usage));
      }
    }
  } else if (!ticket.clientGone && isResOpen(ticket.res)) {
    if (ticket.protocol === ANTHROPIC_PROTOCOL) {
      sendJson(ticket.res, 200, anthropicMessageJson(ticket, usage));
    } else {
      sendJson(ticket.res, 200, completionJson(ticket, usage));
    }
  }

  audit.append({
    actor: ticket.claimedBy || "system",
    action: "ticket.finish",
    target: ticket.id,
    detail: `${ticket.finishReason} ${usage.completion_tokens}t`,
  });
  log(
    `[done] ${ticket.id} reason=${ticket.finishReason} chars=${ticket.text.length} tokens=${usage.completion_tokens} operator=${ticket.claimedBy || "-"}`,
  );
  ticket.resolveDone?.(ticket);
  persistRuntime();
  scheduleRetention(ticket);
}

function finalizeError(ticket, status, message, type, code, headers = {}) {
  if (ticket.finished) return;
  ticket.finished = true;
  ticket.finishedAt = Date.now();
  ticket.finishReason = "error";
  ticket.state = "failed";
  clearTicketTimers(ticket);
  releaseTicketSlot(ticket);
  stats.failed += 1;

  if (ticket.stream && ticket.headersSent && !ticket.clientGone && isResOpen(ticket.res)) {
    if (ticket.protocol === ANTHROPIC_PROTOCOL) {
      sendAnthropicSseError(ticket.res, { message, type, code });
    } else {
      sendSse(ticket.res, { error: { message, type, param: null, code } });
      ticket.res.write("data: [DONE]\n\n");
    }
    ticket.res.end();
  } else if (!ticket.clientGone && isResOpen(ticket.res)) {
    sendProtocolError(ticket.res, status, { message, type, code }, ticket.protocol, headers);
  }

  log(`[error] ${ticket.id} status=${status} code=${code} ${message}`);
  ticket.resolveDone?.(ticket);
  persistRuntime();
  scheduleRetention(ticket);
}

function abandonTicket(ticket) {
  if (ticket.finished) return;
  ticket.finished = true;
  ticket.finishedAt = Date.now();
  ticket.state = "cancelled";
  ticket.clientGone = true;
  clearTicketTimers(ticket);
  releaseTicketSlot(ticket);
  stats.cancelled += 1;
  log(`[client-gone] ${ticket.id}`);
  ticket.resolveDone?.(ticket);
  persistRuntime();
  scheduleRetention(ticket);
}

/* ------------------------------------------------------------------ */
/* Operator-facing ticket view                                        */
/* ------------------------------------------------------------------ */

function publicTicket(ticket) {
  const end = ticket.finishedAt || Date.now();
  return {
    id: ticket.id,
    protocol: ticket.protocol || OPENAI_PROTOCOL,
    model: ticket.model,
    stream: ticket.stream,
    state: ticket.state,
    createdAt: ticket.created,
    claimedAt: ticket.claimedAt,
    finishedAt: ticket.finishedAt,
    claimedBy: ticket.claimedBy,
    caller: ticket.callerLabel,
    clientGone: ticket.clientGone,
    text: ticket.text,
    messages: ticket.messages,
    attachments: ticket.attachments,
    tools: ticket.tools,
    toolChoice: ticket.toolChoice,
    parallelToolCalls: ticket.parallelToolCalls,
    toolCalls: ticket.toolCalls,
    responseFormat: ticket.responseFormat,
    reasoning: ticket.reasoning,
    effort: ticket.effort || "",
    refusal: ticket.refusal,
    finishReason: ticket.finishReason,
    maxTokens: ticket.maxTokens,
    stops: ticket.stops,
    promptTokens: ticket.promptTokens,
    completionTokens: ticket.usage?.completion_tokens ?? countTokens(ticket.text),
    elapsedMs: end - ticket.created,
    queueWaitMs: ticket.claimedAt ? ticket.claimedAt - ticket.created : null,
    handleMs: ticket.claimedAt ? end - ticket.claimedAt : null,
    includeUsage: ticket.includeUsage,
  };
}

function liveCounts() {
  let queued = 0;
  let claimed = 0;
  let streaming = 0;
  let finishing = 0;
  for (const ticket of tickets.values()) {
    if (ticket.state === "queued") queued += 1;
    else if (ticket.state === "claimed") claimed += 1;
    else if (ticket.state === "streaming") streaming += 1;
    else if (ticket.state === "finishing") finishing += 1;
  }
  return { queued, claimed, streaming, finishing };
}

function publicStats() {
  return {
    ...stats,
    ...liveCounts(),
    avgClaimMs: stats.claimCount ? Math.round(stats.claimWaitMs / stats.claimCount) : 0,
    avgHandleMs: stats.handledCount ? Math.round(stats.handledMs / stats.handledCount) : 0,
    uptimeSec: Math.round(process.uptime()),
  };
}

/* ------------------------------------------------------------------ */
/* HTTP handlers                                                      */
/* ------------------------------------------------------------------ */

function modelJson(def) {
  return {
    id: def.id,
    object: "model",
    created: def.created,
    owned_by: def.owned_by,
    name: def.name || def.id,
    description: def.description || "",
    context_window: def.contextWindow,
    max_output_tokens: def.maxOutputTokens,
    capabilities: def.capabilities || ["text"],
    deprecated: def.deprecated === true,
    human_in_the_loop: true,
  };
}

function providerJson() {
  return {
    object: "provider",
    name: "nenggong-zhiren",
    display_name: "能工智人",
    version: VERSION,
    mode: "human-in-the-loop",
    disclosure: "Responses are produced by human responders, not by a trained model.",
    protocols: ["openai-chat-completions", "anthropic-messages"],
    default_model: config.defaultModel,
    models: [...MODELS.values()].map(modelJson),
    limits: {
      max_concurrent_per_key: live.limits.maxConcurrentPerKey,
      body_limit_bytes: live.limits.bodyLimitBytes,
      queue_timeout_ms: live.queue.waitTimeoutMs,
      response_timeout_ms: live.queue.responseTimeoutMs,
    },
  };
}

function handleModels(req, res, url) {
  const caller = authenticateCaller(req);
  setRateLimitHeaders(res, caller);
  consumeQuota(caller);
  const allowed = caller.allowedModels?.length ? new Set(caller.allowedModels) : null;
  const prefix = "/v1/models/";
  if (url.pathname.startsWith(prefix)) {
    const id = decodeURIComponent(url.pathname.slice(prefix.length));
    const model = MODELS.get(id);
    if (!model || (allowed && !allowed.has(id))) {
      throw new ApiError(404, `The model '${id}' does not exist.`, "invalid_request_error", "model_not_found", "model");
    }
    return sendJson(res, 200, modelJson(model));
  }
  return sendJson(res, 200, {
    object: "list",
    data: [...MODELS.values()].filter((model) => !allowed || allowed.has(model.id)).map(modelJson),
  });
}

function protocolToApiError(error) {
  if (error instanceof ProtocolError) {
    const type = error.status === 404 ? "not_found_error" : "invalid_request_error";
    return new ApiError(error.status, error.message, type, error.code, error.param);
  }
  return error;
}

async function handleChatRequest(req, res, protocol) {
  res.ngzrProtocol = protocol;
  const caller = authenticateCaller(req);
  setRateLimitHeaders(res, caller);
  const { body, raw } = await readJsonWithRaw(req);
  let request;
  try {
    request = normalizeRequest(protocol, body, { models: MODELS });
  } catch (error) {
    throw protocolToApiError(error);
  }

  if (caller.allowedModels?.length && !caller.allowedModels.includes(request.model)) {
    throw new ApiError(
      403,
      `This API key is not allowed to use model '${request.model}'.`,
      "invalid_request_error",
      "model_not_allowed",
      "model",
    );
  }
  consumeQuota(caller);

  const idempotencyKey = requestIdempotencyKey(req, caller);
  const bodyHash = createHash("sha256").update(raw).digest("hex");
  if (idempotencyKey) {
    pruneIdempotency();
    const existing = idempotencyRecords.get(idempotencyKey);
    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        throw new ApiError(
          409,
          "This Idempotency-Key was already used with a different request body.",
          "invalid_request_error",
          "idempotency_key_conflict",
        );
      }
      const existingTicket = tickets.get(existing.ticketId);
      if (!existingTicket) {
        throw new ApiError(410, "The idempotent request has expired.", "invalid_request_error", "idempotency_expired");
      }
      if (!existingTicket.finished) {
        log(`[idempotency-wait] ${existingTicket.id} caller=${caller.label}`);
        await existingTicket.donePromise;
      }
      log(`[idempotency-replay] ${existingTicket.id} caller=${caller.label}`);
      return replayTicket(existingTicket, res);
    }
  }

  const releaseSlot = takeSlot(caller);
  if (!releaseSlot) {
    throw new ApiError(
      429,
      "Rate limit reached for requests. Please try again later.",
      "rate_limit_error",
      "rate_limit_exceeded",
      null,
      { "Retry-After": "2" },
    );
  }

  let ticket;
  try {
    ticket = createTicket({ request, caller, releaseSlot });
  } catch (error) {
    releaseSlot();
    throw error;
  }

  ticket.res = res;
  tickets.set(ticket.id, ticket);
  stats.created += 1;
  persistRuntime();
  if (idempotencyKey) {
    idempotencyRecords.set(idempotencyKey, {
      bodyHash,
      ticketId: ticket.id,
      createdAt: Date.now(),
    });
    persistRuntime();
  }

  res.on("close", () => {
    if (!ticket.finished && !res.writableEnded) abandonTicket(ticket);
  });

  armQueueTimeout(ticket);

  log(
    `[request] ${ticket.id} protocol=${protocol} model=${request.model} stream=${ticket.stream} caller=${caller.label} messages=${request.messages.length} tokens≈${ticket.promptTokens}`,
  );
  if (config.logContent) {
    log(`[content] ${ticket.id} ${JSON.stringify(request.messages).slice(0, 2000)}`);
  }
  // The response stays open until an operator finishes, or a timeout fires.
}

async function handleChat(req, res) {
  return handleChatRequest(req, res, OPENAI_PROTOCOL);
}

async function handleMessages(req, res) {
  return handleChatRequest(req, res, ANTHROPIC_PROTOCOL);
}

function requireAdmin(session) {
  if (session.role !== "admin") {
    throw new ApiError(403, "Administrator role required.", "authentication_error", "admin_required");
  }
}

function publicUser(user) {
  return { username: user.username, role: user.role, createdAt: user.createdAt, mfaEnabled: user.mfaEnabled === true };
}

function csvCell(value) {
  let text = String(value ?? "");
  // Prevent spreadsheet formula execution from user-controlled names/details.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sendCsv(res, filename, rows) {
  const body = "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function dateIso(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : "";
}

async function handleOperator(req, res, url, session) {
  const pathname = url.pathname;
  const body = ["POST", "PATCH"].includes(req.method) ? await readJson(req) : {};
  const operator = session.username;

  if (pathname === "/op/api/mfa/setup") {
    requireAdmin(session);
    if (req.method !== "POST") throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
    const secret = generateSecret();
    auth.setMfaSecret(session.username, secret);
    audit.append({ actor: session.username, action: "mfa.setup", ip: clientIp(req) });
    return sendJson(res, 200, {
      ok: true,
      secret,
      otpauth: otpauthUrl({ secret, username: session.username }),
      enabled: false,
    });
  }

  if (pathname === "/op/api/mfa/enable") {
    requireAdmin(session);
    if (req.method !== "POST") throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
    if (!auth.verifyMfaSetup(session.username, body.code)) {
      throw new ApiError(400, "动态验证码不正确。", "invalid_request_error", "invalid_totp");
    }
    auth.enableMfa(session.username);
    audit.append({ actor: session.username, action: "mfa.enable", ip: clientIp(req) });
    return sendJson(res, 200, { ok: true, enabled: true });
  }

  if (pathname === "/op/api/mfa/disable") {
    requireAdmin(session);
    if (req.method !== "POST") throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
    const user = auth.verifyCredentials(session.username, body.password);
    if (!user) throw new ApiError(403, "密码不正确。", "invalid_request_error", "invalid_password");
    auth.disableMfa(session.username);
    audit.append({ actor: session.username, action: "mfa.disable", ip: clientIp(req) });
    return sendJson(res, 200, { ok: true, enabled: false });
  }

  if (pathname === "/op/api/operators" && req.method === "GET") {
    const online = auth.onlineUsers();
    return sendJson(res, 200, {
      ok: true,
      operators: auth.listUsers().map((user) => ({
        username: user.username,
        role: user.role,
        online: online.has(user.username),
      })),
    });
  }

  if (pathname === "/op/api/usage.csv" && req.method === "GET") {
    requireAdmin(session);
    const rows = [["key_id", "name", "hint", "status", "requests_per_minute", "requests_per_day", "requests_per_month", "minute_used", "day_used", "month_used", "total_requests", "total_tokens", "created_at", "last_used_at"]];
    for (const key of apiKeys.list()) {
      const usage = usageStore.get(key.id);
      rows.push([
        key.id,
        key.name,
        key.hint,
        key.disabled ? "disabled" : "active",
        key.limits?.requestsPerMinute || 0,
        key.limits?.requestsPerDay || 0,
        key.limits?.requestsPerMonth || 0,
        usage.minute || 0,
        usage.day || 0,
        usage.month || 0,
        usage.totalRequests || 0,
        usage.totalTokens || 0,
        dateIso(key.createdAt),
        dateIso(key.lastUsedAt),
      ]);
    }
    return sendCsv(res, "usage.csv", rows);
  }

  if (pathname === "/op/api/audit.csv" && req.method === "GET") {
    requireAdmin(session);
    const rows = [["at", "actor", "action", "target", "ip", "detail"]];
    for (const event of audit.list({
      limit: 5000,
      action: url.searchParams.get("action") || "",
      actor: url.searchParams.get("actor") || "",
    })) {
      rows.push([event.at, event.actor, event.action, event.target, event.ip, event.detail]);
    }
    return sendCsv(res, "audit.csv", rows);
  }

  if (pathname === "/op/api/settings") {
    requireAdmin(session);
    if (req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        settings: settingsStore.get(),
        mfaEnabled: auth.mfaEnabled(session.username),
        readonly: {
          host: config.host,
          port: config.port,
          cookie_secure: config.cookieSecureMode,
          tls_enabled: config.tlsEnabled,
          trusted_hosts: config.trustedHosts,
          models: [...MODELS.keys()],
          users_file: path.basename(config.usersFile),
          api_keys_file: path.basename(config.apiKeysFile),
          state_file: path.basename(config.stateFile),
          usage_file: path.basename(config.usageFile),
          audit_file: path.basename(config.auditFile),
          session_ttl_ms: config.sessionTtlMs,
          session_idle_ms: config.sessionIdleMs,
          login_ip_max_failures: config.loginIpMaxFailures,
          login_user_max_failures: config.loginUserMaxFailures,
          log_content: config.logContent,
        },
      });
    }
    if (req.method === "PATCH") {
      const next = settingsStore.update(body);
      refreshModelSpeeds();
      audit.append({
        actor: session.username,
        action: "settings.update",
        target: "runtime",
        ip: clientIp(req),
        detail: JSON.stringify({ queue: next.queue, limits: next.limits, features: next.features }).slice(0, 480),
      });
      return sendJson(res, 200, { ok: true, settings: next });
    }
    throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
  }

  if (pathname === "/op/api/audit") {
    requireAdmin(session);
    if (req.method !== "GET") {
      throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
    }
    return sendJson(res, 200, {
      ok: true,
      events: audit.list({
        limit: Math.min(500, Number(url.searchParams.get("limit")) || 200),
        action: url.searchParams.get("action") || "",
        actor: url.searchParams.get("actor") || "",
      }),
    });
  }

  if (pathname === "/op/api/usage") {
    requireAdmin(session);
    if (req.method !== "GET") {
      throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
    }
    const keys = apiKeys.list().map((key) => ({ ...key, usage: usageStore.get(key.id) }));
    const historyMap = new Map();
    let totalRequests = 0;
    let totalTokens = 0;
    for (const record of usageStore.entries.values()) {
      totalRequests += record.totalRequests || 0;
      totalTokens += record.totalTokens || 0;
      for (const [date, value] of Object.entries(record.history || {})) {
        const row = historyMap.get(date) || { date, requests: 0, tokens: 0 };
        row.requests += value.requests || 0;
        row.tokens += value.tokens || 0;
        historyMap.set(date, row);
      }
    }
    return sendJson(res, 200, {
      ok: true,
      keys,
      totals: { requests: totalRequests, tokens: totalTokens },
      history: [...historyMap.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-30),
    });
  }

  if (pathname === "/op/api/status") {
    requireAdmin(session);
    if (req.method !== "GET") {
      throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
    }
    const fileInfo = (file) => {
      try {
        const info = statSync(file);
        return { exists: true, bytes: info.size, mode: (info.mode & 0o777).toString(8).padStart(3, "0") };
      } catch {
        return { exists: false, bytes: 0, mode: null };
      }
    };
    return sendJson(res, 200, {
      ok: true,
      version: VERSION,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      queue: liveCounts(),
      ticketsTotal: tickets.size,
      settings: settingsStore.get(),
      protocol: providerJson(),
      storage: {
        users: fileInfo(config.usersFile),
        api_keys: fileInfo(config.apiKeysFile),
        state: fileInfo(config.stateFile),
        usage: fileInfo(config.usageFile),
        audit: fileInfo(config.auditFile),
      },
      audit: audit.list({ limit: 20 }),
    });
  }

  if (pathname === "/op/api/keys") {
    requireAdmin(session);
    if (req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        keys: apiKeys.list().map((key) => ({ ...key, usage: usageStore.get(key.id) })),
      });
    }
    if (req.method === "POST") {
      const created = apiKeys.create({
        name: body.name,
        value: body.value,
        limits: body.limits,
        allowedModels: body.allowedModels,
        expiresAt: body.expiresAt,
      });
      audit.append({ actor: session.username, action: "key.create", target: created.record.id, ip: clientIp(req), detail: created.record.name });
      log(`[admin] api key created id=${created.record.id} name=${created.record.name} by=${session.username}`);
      return sendJson(res, 201, {
        ok: true,
        key: created.token,
        record: created.record,
        warning: "这个密钥只显示一次，请现在保存。",
      });
    }
    throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
  }

  const rotateMatch = /^\/op\/api\/keys\/([^/]+)\/rotate$/.exec(pathname);
  if (rotateMatch) {
    requireAdmin(session);
    if (req.method !== "POST") {
      throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
    }
    const keyId = decodeURIComponent(rotateMatch[1]);
    const rotated = apiKeys.rotate(keyId);
    audit.append({ actor: session.username, action: "key.rotate", target: keyId, ip: clientIp(req) });
    log(`[admin] api key rotated id=${keyId} by=${session.username}`);
    return sendJson(res, 200, {
      ok: true,
      key: rotated.token,
      record: rotated.record,
      warning: "旧密钥立即失效；新密钥只显示一次。",
    });
  }

  const keyMatch = /^\/op\/api\/keys\/([^/]+)$/.exec(pathname);
  if (keyMatch) {
    requireAdmin(session);
    const keyId = decodeURIComponent(keyMatch[1]);
    if (req.method === "PATCH") {
      const record = apiKeys.update(keyId, {
        name: body.name,
        value: body.value,
        limits: body.limits,
        allowedModels: body.allowedModels,
        expiresAt: body.expiresAt,
        disabled: body.disabled,
      });
      audit.append({ actor: session.username, action: "key.update", target: keyId, ip: clientIp(req) });
      log(`[admin] api key updated id=${keyId} by=${session.username}`);
      return sendJson(res, 200, { ok: true, record: { ...record, usage: usageStore.get(keyId) } });
    }
    if (req.method === "DELETE") {
      apiKeys.remove(keyId);
      audit.append({ actor: session.username, action: "key.delete", target: keyId, ip: clientIp(req) });
      log(`[admin] api key removed id=${keyId} by=${session.username}`);
      return sendJson(res, 200, { ok: true });
    }
    throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
  }

  if (pathname === "/op/api/users") {
    requireAdmin(session);
    if (req.method === "GET") {
      return sendJson(res, 200, { ok: true, users: auth.listUsers().map(publicUser) });
    }
    if (req.method === "POST") {
      const user = auth.addUser(body.username, body.password, body.role || "operator");
      audit.append({ actor: session.username, action: "user.create", target: user.username, ip: clientIp(req), detail: user.role });
      log(`[admin] user added username=${user.username} role=${user.role} by=${session.username}`);
      return sendJson(res, 201, { ok: true, user: publicUser(user) });
    }
    throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
  }

  const userMatch = /^\/op\/api\/users\/([^/]+)$/.exec(pathname);
  if (userMatch) {
    requireAdmin(session);
    const target = decodeURIComponent(userMatch[1]);
    if (req.method === "PATCH") {
      let user;
      if (body.password !== undefined) {
        auth.setPassword(target, body.password);
        user = auth.listUsers().find((item) => item.username === target);
      }
      if (body.role !== undefined) {
        if (target === session.username) {
          throw new ApiError(409, "You cannot change your own role.", "invalid_request_error", "cannot_change_own_role");
        }
        user = auth.setRole(target, body.role);
      }
      if (!user && body.password === undefined && body.role === undefined) {
        throw new ApiError(400, "Provide password and/or role.", "invalid_request_error", "empty_update");
      }
      audit.append({ actor: session.username, action: "user.update", target, ip: clientIp(req) });
      log(`[admin] user updated username=${target} by=${session.username}`);
      return sendJson(res, 200, { ok: true, user: user ? publicUser(user) : null });
    }
    if (req.method === "DELETE") {
      if (target === session.username) {
        throw new ApiError(409, "You cannot delete your own account.", "invalid_request_error", "cannot_delete_self");
      }
      auth.removeUser(target);
      audit.append({ actor: session.username, action: "user.delete", target, ip: clientIp(req) });
      log(`[admin] user removed username=${target} by=${session.username}`);
      return sendJson(res, 200, { ok: true });
    }
    throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
  }

  if (pathname === "/op/api/me" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      operator,
      user: { username: session.username, role: session.role },
      csrfToken: session.csrf,
      version: VERSION,
      models: [...MODELS.keys()],
      config: {
        queueTimeoutMs: live.queue.waitTimeoutMs,
        responseTimeoutMs: live.queue.responseTimeoutMs,
        streamDelayMs: live.queue.streamDelayMs,
        maxConcurrentPerKey: live.limits.maxConcurrentPerKey,
      },
      features: { ...live.features },
    });
  }

  if (pathname === "/op/api/stats" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, stats: publicStats() });
  }

  if (pathname === "/op/api/tickets" && req.method === "GET") {
    const all = [...tickets.values()];
    const activeStates = new Set(["queued", "claimed", "streaming", "finishing"]);
    const active = all
      .filter((ticket) => activeStates.has(ticket.state))
      .sort((a, b) => a.created - b.created)
      .map(publicTicket);
    const recent = all
      .filter((ticket) => !activeStates.has(ticket.state))
      .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
      .slice(0, 30)
      .map(publicTicket);
    return sendJson(res, 200, {
      ok: true,
      tickets: [...active, ...recent],
      stats: publicStats(),
    });
  }

  const match = /^\/op\/api\/tickets\/([^/]+)(?:\/(claim|chunk|finish|release|cancel|transfer))?$/.exec(pathname);
  if (!match) {
    throw new ApiError(404, "Operator route not found.", "invalid_request_error", "not_found");
  }

  const ticket = requireTicket(decodeURIComponent(match[1]));
  const action = match[2];

  if (!action && req.method === "GET") {
    return sendJson(res, 200, { ok: true, ticket: publicTicket(ticket) });
  }

  if (!action || req.method !== "POST") {
    throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
  }

  const requireClaimant = (verb) => {
    if (ticket.claimedBy !== operator) {
      throw new ApiError(
        403,
        `Only the operator who claimed this ticket can ${verb} it.`,
        "invalid_request_error",
        "not_ticket_owner",
      );
    }
  };

  if (action === "claim") {
    if (ticket.finished) throw new ApiError(409, `Ticket is already ${ticket.state}.`, "invalid_request_error", "ticket_closed");
    if (ticket.state !== "queued") {
      throw new ApiError(409, `Ticket is already ${ticket.state}.`, "invalid_request_error", "ticket_not_queued");
    }
    if (ticket.clientGone || !isResOpen(ticket.res)) {
      abandonTicket(ticket);
      throw new ApiError(410, "The caller disconnected before the ticket was claimed.", "invalid_request_error", "client_gone");
    }

    ticket.state = "claimed";
    ticket.claimedBy = operator;
    ticket.claimedAt = Date.now();
    stats.claimCount += 1;
    stats.claimWaitMs += ticket.claimedAt - ticket.created;
    clearTimeout(ticket.timers.queue);
    ticket.timers.queue = null;
    armResponseTimeout(ticket);
    if (ticket.stream) beginStream(ticket);
    audit.append({ actor: operator, action: "ticket.claim", target: ticket.id, ip: clientIp(req), detail: ticket.model });
    persistRuntime();
    log(`[claim] ${ticket.id} operator=${operator} wait=${ticket.claimedAt - ticket.created}ms`);
    return sendJson(res, 200, { ok: true, ticket: publicTicket(ticket) });
  }

  if (action === "transfer") {
    if (ticket.finished) {
      throw new ApiError(409, `Ticket is already ${ticket.state}.`, "invalid_request_error", "ticket_closed");
    }
    if (ticket.claimedBy !== operator && session.role !== "admin") {
      throw new ApiError(403, "Only the current operator or an administrator can transfer this ticket.", "invalid_request_error", "not_claimant");
    }
    if (ticket.state !== "claimed") {
      throw new ApiError(409, "Transfer is only available before streaming starts.", "invalid_request_error", "ticket_not_transferable");
    }
    const targetName = String(body.to || body.username || "").trim().toLowerCase();
    if (!targetName) {
      throw new ApiError(400, "Provide the target username.", "invalid_request_error", "missing_transfer_target");
    }
    if (targetName === operator) {
      throw new ApiError(409, "A ticket cannot be transferred to its current operator.", "invalid_request_error", "same_operator");
    }
    if (!auth.hasUser(targetName)) {
      throw new ApiError(404, "Target operator not found.", "invalid_request_error", "operator_not_found");
    }
    const previous = ticket.claimedBy;
    ticket.claimedBy = targetName;
    ticket.claimedAt = Date.now();
    armResponseTimeout(ticket);
    audit.append({
      actor: operator,
      action: "ticket.transfer",
      target: ticket.id,
      ip: clientIp(req),
      detail: `${previous || "-"} -> ${targetName}`,
    });
    persistRuntime();
    log(`[transfer] ${ticket.id} ${previous || "-"} -> ${targetName} by=${operator}`);
    return sendJson(res, 200, { ok: true, ticket: publicTicket(ticket) });
  }

  if (action === "chunk") {
    requireClaimant("edit");
    if (ticket.finished || ticket.clientGone) {
      throw new ApiError(410, "The caller is no longer connected.", "invalid_request_error", "client_gone");
    }
    if (!["claimed", "streaming"].includes(ticket.state)) {
      throw new ApiError(409, `Ticket is ${ticket.state}.`, "invalid_request_error", "ticket_not_active");
    }
    const text = typeof body.text === "string" ? body.text : "";
    if (!text) {
      throw new ApiError(400, "text must be a non-empty string.", "invalid_request_error", "invalid_chunk");
    }
    if (text.length > 50_000) {
      throw new ApiError(400, "Chunk is too large (max 50000 characters).", "invalid_request_error", "chunk_too_large");
    }

    armResponseTimeout(ticket);
    const result = appendText(ticket, text);
    if (isJsonMode(ticket)) {
      // Structured output is buffered until finish validates it. This keeps
      // an invalid human draft from ever reaching the caller as valid JSON.
    } else if (result.forced) {
      ticket.state = "finishing";
      if (ticket.stream) await queueFlush(ticket, true);
      finalize(ticket, result.forced);
    } else if (ticket.stream) {
      queueFlush(ticket, false);
    }
    persistRuntime();
    log(`[chunk] ${ticket.id} +${result.added} chars total=${result.total}${result.forced ? ` forced=${result.forced}` : ""}`);
    return sendJson(res, 200, {
      ok: true,
      state: ticket.state,
      textLength: ticket.text.length,
      forcedFinishReason: result.forced,
    });
  }

  if (action === "finish") {
    requireClaimant("finish");
    if (ticket.finished) {
      return sendJson(res, 200, { ok: true, state: ticket.state, alreadyFinished: true });
    }
    if (ticket.clientGone) {
      abandonTicket(ticket);
      throw new ApiError(410, "The caller is no longer connected.", "invalid_request_error", "client_gone");
    }
    if (!["claimed", "streaming"].includes(ticket.state)) {
      throw new ApiError(409, `Ticket is ${ticket.state}.`, "invalid_request_error", "ticket_not_active");
    }

    const refusal = typeof body.refusal === "string" ? body.refusal.trim() : "";
    if (refusal.length > 10_000) {
      throw new ApiError(413, "Refusal text is too long.", "invalid_request_error", "refusal_too_long");
    }
    const toolCalls = normalizeOperatorToolCalls(ticket, body.toolCalls);
    const reasoning = typeof body.reasoning === "string" ? body.reasoning.trim() : "";
    if (reasoning.length > 100_000) {
      throw new ApiError(413, "Reasoning text is too long.", "invalid_request_error", "reasoning_too_long");
    }
    if (refusal && (body.text || toolCalls.length || reasoning)) {
      throw new ApiError(
        400,
        "A refusal cannot be combined with text, reasoning, or tool calls.",
        "invalid_request_error",
        "invalid_refusal",
      );
    }
    if (ticket.responseFormat && toolCalls.length) {
      throw new ApiError(
        400,
        "response_format cannot be combined with tool calls.",
        "invalid_request_error",
        "response_format_tool_conflict",
      );
    }

    const requiresToolCall =
      ticket.toolChoice === "required" ||
      (ticket.toolChoice && typeof ticket.toolChoice === "object");
    if (!refusal && requiresToolCall && toolCalls.length === 0) {
      throw new ApiError(
        400,
        "This request requires at least one tool call.",
        "invalid_request_error",
        "tool_call_required",
      );
    }
    if (toolCalls.length && ticket.forcedFinishReason) {
      throw new ApiError(
        409,
        "Text was already truncated by max_tokens or stop; start a new request to return tool calls.",
        "invalid_request_error",
        "tool_calls_after_truncation",
      );
    }

    if (isJsonMode(ticket) && body.replaceText === true && ticket.delivered === 0) {
      ticket.text = "";
      ticket.forcedFinishReason = null;
    }
    if (typeof body.text === "string" && body.text.length > 0) {
      appendText(ticket, body.text);
    }
    if (refusal) ticket.refusal = refusal;
    if (reasoning) ticket.reasoning = reasoning;
    if (toolCalls.length) ticket.toolCalls = toolCalls;

    if (isJsonMode(ticket) && !refusal) {
      validateStructuredText(ticket, ticket.text);
    }

    ticket.state = "finishing";
    const reason =
      ticket.forcedFinishReason ||
      (ticket.refusal
        ? "content_filter"
        : toolCalls.length
          ? "tool_calls"
          : normalizeFinishReason(body.finishReason));
    if (ticket.stream) {
      if (ticket.reasoning && !ticket.refusal) writeReasoning(ticket);
      await queueFlush(ticket, true);
    }
    finalize(ticket, reason);
    return sendJson(res, 200, {
      ok: true,
      state: ticket.state,
      finishReason: ticket.finishReason,
      textLength: ticket.text.length,
      toolCallCount: ticket.toolCalls.length,
      refusal: Boolean(ticket.refusal),
      reasoningLength: ticket.reasoning.length,
    });
  }

  if (action === "release") {
    requireClaimant("release");
    if (ticket.finished) {
      throw new ApiError(409, `Ticket is already ${ticket.state}.`, "invalid_request_error", "ticket_closed");
    }
    if (ticket.state !== "claimed" || ticket.stream || ticket.text.length > 0) {
      throw new ApiError(
        409,
        "Only an unclaimed, non-streaming ticket with no delivered text can be released.",
        "invalid_request_error",
        "ticket_not_releasable",
      );
    }
    clearTimeout(ticket.timers.response);
    ticket.timers.response = null;
    ticket.state = "queued";
    ticket.claimedBy = null;
    ticket.claimedAt = null;
    armQueueTimeout(ticket);
    persistRuntime();
    log(`[release] ${ticket.id} operator=${operator}`);
    return sendJson(res, 200, { ok: true, ticket: publicTicket(ticket) });
  }

  if (action === "cancel") {
    if (ticket.state !== "queued" && ticket.claimedBy !== operator && session.role !== "admin") {
      throw new ApiError(403, "Only the claimant or an administrator can cancel this ticket.", "invalid_request_error", "not_ticket_owner");
    }
    if (ticket.finished) {
      return sendJson(res, 200, { ok: true, state: ticket.state, alreadyFinished: true });
    }
    log(`[cancel] ${ticket.id} operator=${operator}`);
    finalizeError(
      ticket,
      500,
      "The request was aborted by the upstream provider.",
      "server_error",
      "upstream_aborted",
    );
    return sendJson(res, 200, { ok: true, state: ticket.state });
  }

  throw new ApiError(404, "Operator action not found.", "invalid_request_error", "not_found");
}

/* ------------------------------------------------------------------ */
/* Login and static assets                                            */
/* ------------------------------------------------------------------ */

const PUBLIC_FILES = new Map([
  ["/login.css", { file: "login.css", type: "text/css; charset=utf-8" }],
  ["/login.js", { file: "login.js", type: "text/javascript; charset=utf-8" }],
  ["/console.css", { file: "console.css", type: "text/css; charset=utf-8" }],
  ["/console.js", { file: "console.js", type: "text/javascript; charset=utf-8" }],
  ["/admin.css", { file: "admin.css", type: "text/css; charset=utf-8" }],
  ["/theme.css", { file: "theme.css", type: "text/css; charset=utf-8" }],
  ["/navigation.js", { file: "navigation.js", type: "text/javascript; charset=utf-8" }],
  ["/admin-settings.js", { file: "admin-settings.js", type: "text/javascript; charset=utf-8" }],
  ["/admin-usage.js", { file: "admin-usage.js", type: "text/javascript; charset=utf-8" }],
  ["/admin-audit.js", { file: "admin-audit.js", type: "text/javascript; charset=utf-8" }],
  ["/admin-status.js", { file: "admin-status.js", type: "text/javascript; charset=utf-8" }],
  ["/admin-users.js", { file: "admin-users.js", type: "text/javascript; charset=utf-8" }],
  ["/admin-keys.js", { file: "admin-keys.js", type: "text/javascript; charset=utf-8" }],
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeNextPath(value, fallback = "/console") {
  const next = String(value || "").trim();
  if (!next || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}

async function serveStatic(req, res, entry, extraHeaders = {}) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
  }
  try {
    const body = await readFile(path.join(PUBLIC_DIR, entry.file));
    sendRaw(res, 200, entry.type, req.method === "HEAD" ? "" : body, {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    });
  } catch {
    throw new ApiError(404, "Asset not found.", "invalid_request_error", "not_found");
  }
}

async function serveLoginPage(res, { status = 200, error = "", next = "/console", retryAfter = null } = {}) {
  let html;
  try {
    html = await readFile(path.join(PUBLIC_DIR, "login.html"), "utf8");
  } catch {
    throw new ApiError(500, "Login page unavailable.", "server_error", "login_page_unavailable");
  }
  html = html
    .replaceAll("{{NEXT}}", escapeHtml(safeNextPath(next)))
    .replaceAll("{{ERROR}}", escapeHtml(error));
  const headers = {};
  if (retryAfter !== null) headers["Retry-After"] = String(retryAfter);
  sendRaw(res, status, "text/html; charset=utf-8", html, headers);
}

async function servePage(req, res, filename, fallback) {
  try {
    const body = await readFile(path.join(PUBLIC_DIR, filename));
    sendRaw(res, 200, "text/html; charset=utf-8", req.method === "HEAD" ? "" : body, {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
  } catch {
    throw new ApiError(404, fallback || "Page not found.", "invalid_request_error", "not_found");
  }
}

async function serveConsole(req, res) {
  return servePage(req, res, "console.html", "Console not found.");
}

async function serveAdminPage(req, res, filename) {
  const session = auth.getSession(req);
  if (!session) {
    res.writeHead(302, { Location: `/login?next=${encodeURIComponent(req.url || "/console")}` });
    res.end();
    return;
  }
  if (session.role !== "admin") {
    res.writeHead(302, { Location: "/console" });
    res.end();
    return;
  }
  return servePage(req, res, filename);
}

function parseLoginBody(raw, contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("application/json")) {
    const parsed = JSON.parse(raw || "{}");
    return { username: parsed.username, password: parsed.password, totp: parsed.totp || parsed.otp || "", next: parsed.next };
  }
  const params = new URLSearchParams(raw);
  return {
    username: params.get("username"),
    password: params.get("password"),
    totp: params.get("totp") || "",
    next: params.get("next"),
  };
}

async function handleLogin(req, res, url) {
  assertSameOrigin(req);
  const raw = await readBody(req, 16 * 1024);
  let form;
  try {
    form = parseLoginBody(raw, req.headers["content-type"]);
  } catch {
    return serveLoginPage(res, { status: 400, error: "登录请求格式不正确。", next: "/console" });
  }

  const ip = clientIp(req);
  const usernameForLimit = String(form.username || "").trim().toLowerCase();
  const allowed = auth.loginAllowed(ip, usernameForLimit);
  if (!allowed.allowed) {
    audit.append({ actor: usernameForLimit || "unknown", action: "login.throttled", ip, detail: "retry-after" });
    log(`[login-throttled] ip=${ip} username=${usernameForLimit || "-"}`);
    return serveLoginPage(res, {
      status: 429,
      error: "登录尝试过多，请稍后再试。",
      next: "/console",
      retryAfter: Math.max(1, Math.ceil(allowed.retryAfterMs / 1000)),
    });
  }

  const user = auth.verifyCredentials(form.username, form.password);
  if (!user) {
    auth.recordLoginFailure(ip, usernameForLimit);
    audit.append({ actor: usernameForLimit || "unknown", action: "login.failure", ip });
    log(`[login-failed] ip=${ip} username=${usernameForLimit || "-"}`);
    return serveLoginPage(res, {
      status: 401,
      error: "用户名或密码错误。",
      next: safeNextPath(form.next, "/console"),
    });
  }

  if (!auth.verifyMfa(user.username, form.totp)) {
    auth.recordLoginFailure(ip, usernameForLimit);
    audit.append({ actor: user.username, action: "login.mfa_failure", ip });
    return serveLoginPage(res, {
      status: 401,
      error: "动态验证码不正确。",
      next: safeNextPath(form.next, "/console"),
    });
  }

  auth.clearLoginFailures(ip, usernameForLimit);
  const session = auth.createSession(user, {
    ip,
    userAgent: req.headers["user-agent"],
  });
  audit.append({ actor: user.username, action: "login.success", target: user.role, ip });
  log(`[login-ok] user=${user.username} role=${user.role} ip=${ip}`);
  res.setHeader("Set-Cookie", auth.sessionCookie(session, req));
  res.writeHead(303, { Location: safeNextPath(form.next, "/console") });
  res.end();
}

async function handleLogout(req, res) {
  const session = requireSession(req, { csrf: true });
  auth.destroySession(req);
  audit.append({ actor: session.username, action: "logout", ip: clientIp(req) });
  log(`[logout] user=${session.username} ip=${clientIp(req)}`);
  res.setHeader("Set-Cookie", auth.clearCookie(req));
  return sendJson(res, 200, { ok: true });
}

async function handleMe(req, res) {
  const session = requireSession(req);
  return sendJson(res, 200, {
    ok: true,
    user: { username: session.username, role: session.role },
    csrfToken: session.csrf,
    expiresAt: session.expiresAt,
    version: VERSION,
    models: [...MODELS.keys()],
    config: {
      queueTimeoutMs: live.queue.waitTimeoutMs,
      responseTimeoutMs: live.queue.responseTimeoutMs,
      streamDelayMs: live.queue.streamDelayMs,
      maxConcurrentPerKey: live.limits.maxConcurrentPerKey,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Router                                                             */
/* ------------------------------------------------------------------ */

async function route(req, res) {
  applySecurityHeaders(req, res);
  try {
    assertTrustedHost(req);
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    } catch {
      throw new ApiError(400, "Invalid request URL.", "invalid_request_error", "invalid_url");
    }
    const pathname = url.pathname;

    if (req.method === "OPTIONS") {
      if (pathname.startsWith("/v1/")) {
        applyCorsTo(req, res);
        res.writeHead(204);
        res.end();
        return;
      }
      throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
    }

    if ((pathname === "/provider" || pathname === "/v1/provider") && req.method === "GET") {
      return sendJson(res, 200, providerJson());
    }

    if (pathname === "/openapi.json" && req.method === "GET") {
      try {
        const spec = readFileSync(path.join(ROOT, "docs", "openapi.json"), "utf8");
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(spec);
        return;
      } catch {
        throw new ApiError(404, "OpenAPI document not found.", "invalid_request_error", "not_found");
      }
    }

    if (pathname === "/healthz" && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        service: "nenggong-zhiren",
        version: VERSION,
        uptimeSec: Math.round(process.uptime()),
      });
    }

    if (pathname === "/login" && req.method === "GET") {
      if (auth.getSession(req)) {
        res.writeHead(302, { Location: "/console" });
        res.end();
        return;
      }
      return serveLoginPage(res, { next: safeNextPath(url.searchParams.get("next"), "/console") });
    }

    if (pathname === "/auth/login" && req.method === "POST") {
      return handleLogin(req, res, url);
    }

    if (pathname === "/auth/logout" && req.method === "POST") {
      assertSameOrigin(req);
      return handleLogout(req, res);
    }

    if (pathname === "/auth/me" && req.method === "GET") {
      return handleMe(req, res);
    }

    if (pathname === "/" && req.method === "GET") {
      res.writeHead(302, { Location: auth.getSession(req) ? "/console" : "/login" });
      res.end();
      return;
    }

    if (pathname === "/console" || pathname === "/console/") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      }
      if (!auth.getSession(req)) {
        res.writeHead(302, { Location: `/login?next=${encodeURIComponent("/console")}` });
        res.end();
        return;
      }
      return serveConsole(req, res);
    }

    if (pathname === "/console/users" || pathname === "/console/users/") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      }
      return serveAdminPage(req, res, "users.html");
    }

    if (pathname === "/console/keys" || pathname === "/console/keys/") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      }
      return serveAdminPage(req, res, "keys.html");
    }

    if (pathname === "/console/settings" || pathname === "/console/settings/") {
      if (req.method !== "GET" && req.method !== "HEAD") throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      return serveAdminPage(req, res, "settings.html");
    }
    if (pathname === "/console/usage" || pathname === "/console/usage/") {
      if (req.method !== "GET" && req.method !== "HEAD") throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      return serveAdminPage(req, res, "usage.html");
    }
    if (pathname === "/console/audit" || pathname === "/console/audit/") {
      if (req.method !== "GET" && req.method !== "HEAD") throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      return serveAdminPage(req, res, "audit.html");
    }
    if (pathname === "/console/status" || pathname === "/console/status/") {
      if (req.method !== "GET" && req.method !== "HEAD") throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      return serveAdminPage(req, res, "status.html");
    }

    const publicFile = PUBLIC_FILES.get(pathname);
    if (publicFile) return serveStatic(req, res, publicFile);

    if (pathname === "/v1/models" || pathname.startsWith("/v1/models/")) {
      applyCorsTo(req, res);
      if (req.method !== "GET") {
        throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      }
      return handleModels(req, res, url);
    }

    if (pathname === "/v1/chat/completions") {
      applyCorsTo(req, res);
      if (req.method !== "POST") {
        throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      }
      // /v1 authenticates with an API key, not a cookie, so it is not a
      // CSRF surface. CORS only controls browser readability.
      return handleChat(req, res);
    }

    if (pathname === "/v1/messages") {
      res.ngzrProtocol = ANTHROPIC_PROTOCOL;
      applyCorsTo(req, res);
      if (req.method !== "POST") {
        throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      }
      return handleMessages(req, res);
    }

    if (pathname.startsWith("/op/api/")) {
      assertSameOrigin(req);
      const mutating = req.method !== "GET" && req.method !== "HEAD";
      const session = requireSession(req, { csrf: mutating });
      return handleOperator(req, res, url, session);
    }

    throw new ApiError(404, "Not found.", "invalid_request_error", "not_found");
  } catch (error) {
    throw error;
  }
}

function handleError(res, error) {
  const apiError =
    error instanceof ApiError
      ? error
      : error instanceof AuthError || error instanceof ApiKeyError || error instanceof SettingsError
        ? new ApiError(error.status, error.message, "invalid_request_error", error.code)
        : new ApiError(500, "The server had an error while processing your request.", "server_error", "internal_error");

  if (!(error instanceof ApiError) && !(error instanceof AuthError) && !(error instanceof ApiKeyError) && !(error instanceof SettingsError)) {
    console.error(nowIso(), "[unhandled]", error);
  }

  if (isResOpen(res)) {
    if (!res.headersSent) {
      if (res.ngzrProtocol === ANTHROPIC_PROTOCOL) {
        sendAnthropicError(
          res,
          apiError.status,
          { message: apiError.message, type: apiError.type, code: apiError.code },
          apiError.headers,
        );
      } else {
        sendJson(
          res,
          apiError.status,
          {
            error: {
              message: apiError.message,
              type: apiError.type,
              param: apiError.param,
              code: apiError.code,
              ...(apiError.details ? { details: apiError.details } : {}),
            },
          },
          apiError.headers,
        );
      }
    } else {
      res.end();
    }
  }
}

const requestHandler = (req, res) => {
  route(req, res).catch((error) => handleError(res, error));
};

const server =
  config.tlsEnabled && config.tlsCert && config.tlsKey
    ? https.createServer(
        {
          cert: readFileSync(config.tlsCert),
          key: readFileSync(config.tlsKey),
        },
        requestHandler,
      )
    : http.createServer(requestHandler);
const scheme = config.tlsEnabled && config.tlsCert && config.tlsKey ? "https" : "http";

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 65_000;
server.on("clientError", (error, socket) => {
  if (!socket.writable) return;
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

server.listen(config.port, config.host, () => {
  const address = server.address();
  const localHost = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  const base = `${scheme}://${localHost}:${address.port}`;
  const lanUrls = [];
  if (config.host === "0.0.0.0" || config.host === "::") {
    for (const entries of Object.values(os.networkInterfaces())) {
      for (const entry of entries || []) {
        if (entry.family === "IPv4" && !entry.internal) {
          lanUrls.push(`${scheme}://${entry.address}:${address.port}`);
        }
      }
    }
  }
  const configuredKeys = apiKeys.list();
  log(`能工智人 (nenggong-zhiren) v${VERSION} listening on ${config.host}:${address.port}`);
  log(`  login       ${base}/login`);
  log(`  console     ${base}/console`);
  for (const url of lanUrls) log(`  LAN         ${url}/login`);
  log(`  caller keys ${configuredKeys.length} configured (${configuredKeys.map((key) => key.name).join(", ") || "none"})`);
  log(`  config      ${path.basename(config.configFile)}`);
  log(`  keys file   ${path.basename(config.apiKeysFile)}`);
  log(`  models      ${[...MODELS.keys()].join(", ")}`);
  log(`  users       ${auth.listUsers().length} (${auth.listUsers().map((user) => user.username).join(", ")})`);
  const relativeUsers = path.relative(ROOT, config.usersFile);
  log(`  users file  ${relativeUsers && !relativeUsers.startsWith("..") ? relativeUsers : "<external users file>"}`);
  if (configuredKeys.length === 0) log("  WARNING     no API keys configured; add one in the admin console");
  log(`  timeouts    queue=${live.queue.waitTimeoutMs}ms response=${live.queue.responseTimeoutMs}ms`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log(`received ${signal}, shutting down`);
    stateStore.close();
    usageStore.close();
    apiKeys.close();
    auth.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  });
}
