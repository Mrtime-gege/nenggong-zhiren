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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthError, AuthService } from "./src/auth.mjs";
import { validateJsonSchema, formatSchemaErrors } from "./src/schema.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const VERSION = "0.3.0";

// Minimal .env loader: zero dependencies, never overrides real environment
// variables. Keep .env private.
function loadDotEnv() {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadDotEnv();

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

function envInt(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseCallerKeys(raw) {
  const keys = new Map();
  for (const item of String(raw).split(",")) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf(":");
    const key = (at === -1 ? trimmed : trimmed.slice(0, at)).trim();
    const fallbackLabel = `key-${createHash("sha256").update(key).digest("hex").slice(0, 4)}`;
    const label = (at === -1 ? "" : trimmed.slice(at + 1)).trim() || fallbackLabel;
    if (key) keys.set(key, { key, label });
  }
  return keys;
}

const config = Object.freeze({
  host: process.env.HOST || "0.0.0.0",
  port: envInt("PORT", 7355, { min: 0, max: 65535 }),
  callerKeys: parseCallerKeys(process.env.HUMAN_KEYS || ""),
  usersFile: process.env.USERS_FILE || path.join(ROOT, "users.json"),
  sessionTtlMs: envInt("SESSION_TTL_MS", 12 * 60 * 60_000, { min: 60_000, max: 30 * 24 * 60 * 60_000 }),
  sessionIdleMs: envInt("SESSION_IDLE_MS", 2 * 60 * 60_000, { min: 60_000, max: 7 * 24 * 60 * 60_000 }),
  cookieSecure: process.env.COOKIE_SECURE === "1",
  tlsCert: process.env.TLS_CERT || "",
  tlsKey: process.env.TLS_KEY || "",
  trustedHosts: String(process.env.TRUSTED_HOSTS || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean),
  loginRateWindowMs: envInt("LOGIN_RATE_WINDOW_MS", 5 * 60_000, { min: 10_000, max: 60 * 60_000 }),
  queueTimeoutMs: envInt("QUEUE_TIMEOUT_MS", 300_000, { min: 100, max: 86_400_000 }),
  responseTimeoutMs: envInt("RESPONSE_TIMEOUT_MS", 900_000, { min: 100, max: 86_400_000 }),
  streamDelayMs: envInt("STREAM_DELAY_MS", 26, { min: 0, max: 5_000 }),
  maxConcurrentPerKey: envInt("MAX_CONCURRENT_PER_KEY", 4, { min: 1, max: 1_000 }),
  retentionMs: envInt("RETENTION_MS", 30 * 60_000, { min: 10_000, max: 86_400_000 }),
  bodyLimitBytes: envInt("BODY_LIMIT_BYTES", 2 * 1024 * 1024, { min: 1024, max: 64 * 1024 * 1024 }),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  logContent: process.env.LOG_CONTENT === "1",
});

/* ------------------------------------------------------------------ */
/* Models                                                             */
/* ------------------------------------------------------------------ */

const MODELS = new Map();
for (const raw of (process.env.HUMAN_MODELS || "human-1,human-1-fast").split(",")) {
  const id = raw.trim();
  if (!id) continue;
  MODELS.set(id, {
    id,
    created: 1767225600, // 2026-01-01, stable fake creation date
    owned_by: "human-backend",
    speedMs: id.includes("fast")
      ? Math.max(2, Math.round(config.streamDelayMs / 4))
      : config.streamDelayMs,
  });
}
if (MODELS.size === 0) {
  MODELS.set("human-1", {
    id: "human-1",
    created: 1767225600,
    owned_by: "human-backend",
    speedMs: config.streamDelayMs,
  });
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
  secureCookies: config.cookieSecure,
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

function corsHeaders() {
  const headers = {
    "Access-Control-Allow-Origin": config.corsOrigin,
    "Access-Control-Allow-Headers": "Authorization,Content-Type,Idempotency-Key",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
  if (config.corsOrigin !== "*") headers.Vary = "Origin";
  return headers;
}

function applyCorsTo(res) {
  for (const [key, value] of Object.entries(corsHeaders())) res.setHeader(key, value);
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
  const raw = await readBody(req, config.bodyLimitBytes);
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

function setRateLimitHeaders(res, callerKey) {
  const used = slots.get(callerKey) || 0;
  const limit = config.maxConcurrentPerKey;
  res.setHeader("x-ratelimit-limit-requests", String(limit));
  res.setHeader("x-ratelimit-remaining-requests", String(Math.max(0, limit - used)));
  res.setHeader("x-ratelimit-reset-requests", "1s");
}

const idempotencyRecords = new Map();
const IDEMPOTENCY_TTL_MS = 30 * 60_000;
const IDEMPOTENCY_MAX = 2000;

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

function replayTicket(ticket, res) {
  if (ticket.state === "failed" || ticket.state === "cancelled") {
    return sendJson(res, 409, {
      error: {
        message: "The original request did not complete successfully.",
        type: "server_error",
        param: null,
        code: "idempotent_request_failed",
      },
    });
  }
  if (ticket.stream) {
    res.writeHead(200, sseHeaders());
    res.flushHeaders?.();
    for (const payload of ticket.sseLog || []) sendSse(res, payload);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
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
  if (!match) {
    throw new ApiError(
      401,
      "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth.",
      "invalid_request_error",
      "missing_api_key",
    );
  }
  const entry = config.callerKeys.get(match[1].trim());
  if (!entry) {
    throw new ApiError(
      401,
      "Incorrect API key provided. Please check your API key and try again.",
      "invalid_request_error",
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

function takeSlot(callerKey) {
  const used = slots.get(callerKey) || 0;
  if (used >= config.maxConcurrentPerKey) return null;
  slots.set(callerKey, used + 1);
  return () => {
    const current = slots.get(callerKey) || 0;
    if (current <= 1) slots.delete(callerKey);
    else slots.set(callerKey, current - 1);
  };
}

function createTicket({ body, messages, attachments, caller, releaseSlot }) {
  const created = Date.now();
  const tools = normalizeTools(body.tools);
  let resolveDone;
  const donePromise = new Promise((resolve) => {
    resolveDone = resolve;
  });
  return {
    id: `chatcmpl-${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    created,
    createdSec: Math.floor(created / 1000),
    model: body.model,
    stream: body.stream === true,
    includeUsage: body.stream_options?.include_usage === true,
    messages,
    attachments,
    callerKey: caller.key,
    callerLabel: caller.label,
    promptTokens: promptTokensFor(messages),
    maxTokens: normalizeMaxTokens(body),
    stops: normalizeStops(body.stop),
    tools,
    toolChoice: normalizeToolChoice(body.tool_choice, tools),
    parallelToolCalls: body.parallel_tool_calls !== false,
    toolCalls: [],
    responseFormat: normalizeResponseFormat(body.response_format),
    reasoning: "",
    refusal: null,
    clientUser: typeof body.user === "string" ? body.user.slice(0, 256) : undefined,
    donePromise,
    resolveDone,
    sseLog: [],
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
    speedMs: MODELS.get(body.model)?.speedMs ?? config.streamDelayMs,
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
  ticket.timers.retention = setTimeout(() => tickets.delete(ticket.id), config.retentionMs);
  ticket.timers.retention.unref?.();
}

function armQueueTimeout(ticket) {
  clearTimeout(ticket.timers.queue);
  ticket.timers.queue = setTimeout(() => {
    if (ticket.state !== "queued") return;
    stats.timedOut += 1;
    log(`[queue-timeout] ${ticket.id} after ${config.queueTimeoutMs}ms`);
    finalizeError(
      ticket,
      503,
      "The server is currently overloaded. Please try again later.",
      "server_error",
      "overloaded",
      { "Retry-After": "5" },
    );
  }, config.queueTimeoutMs);
  ticket.timers.queue.unref?.();
}

function armResponseTimeout(ticket) {
  clearTimeout(ticket.timers.response);
  ticket.timers.response = setTimeout(() => {
    if (ticket.finished) return;
    if (!["claimed", "streaming"].includes(ticket.state)) return;
    stats.timedOut += 1;
    log(`[response-timeout] ${ticket.id} after ${config.responseTimeoutMs}ms`);
    finalizeError(
      ticket,
      504,
      "The upstream provider timed out while generating a response.",
      "server_error",
      "upstream_timeout",
    );
  }, config.responseTimeoutMs);
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
  emitSse(ticket, chunkPayload(ticket, { role: "assistant", content: "" }));
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
  if (!ticket.reasoning) return;
  ticket.reasoningSent = true;
  const parts = splitForStream(ticket.reasoning);
  for (const part of parts) {
    emitSse(ticket, chunkPayload(ticket, { reasoning_content: part }));
  }
}

function writeRefusal(ticket) {
  if (!ticket.refusal) return;
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
    if (!emitSse(ticket, chunkPayload(ticket, { content: part }))) return;
    if (paced && config.streamDelayMs > 0) {
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
      sendJson(ticket.res, 200, completionJson(ticket, usage));
    }
  } else if (!ticket.clientGone && isResOpen(ticket.res)) {
    sendJson(ticket.res, 200, completionJson(ticket, usage));
  }

  log(
    `[done] ${ticket.id} reason=${ticket.finishReason} chars=${ticket.text.length} tokens=${usage.completion_tokens} operator=${ticket.claimedBy || "-"}`,
  );
  ticket.resolveDone?.(ticket);
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
    sendSse(ticket.res, { error: { message, type, param: null, code } });
    ticket.res.write("data: [DONE]\n\n");
    ticket.res.end();
  } else if (!ticket.clientGone && isResOpen(ticket.res)) {
    sendJson(ticket.res, status, { error: { message, type, param: null, code } }, headers);
  }

  log(`[error] ${ticket.id} status=${status} code=${code} ${message}`);
  ticket.resolveDone?.(ticket);
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
  scheduleRetention(ticket);
}

/* ------------------------------------------------------------------ */
/* Operator-facing ticket view                                        */
/* ------------------------------------------------------------------ */

function publicTicket(ticket) {
  const end = ticket.finishedAt || Date.now();
  return {
    id: ticket.id,
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
  return { id: def.id, object: "model", created: def.created, owned_by: def.owned_by };
}

function handleModels(req, res, url) {
  const caller = authenticateCaller(req);
  setRateLimitHeaders(res, caller.key);
  const prefix = "/v1/models/";
  if (url.pathname.startsWith(prefix)) {
    const id = decodeURIComponent(url.pathname.slice(prefix.length));
    const model = MODELS.get(id);
    if (!model) {
      throw new ApiError(404, `The model '${id}' does not exist.`, "invalid_request_error", "model_not_found", "model");
    }
    return sendJson(res, 200, modelJson(model));
  }
  return sendJson(res, 200, {
    object: "list",
    data: [...MODELS.values()].map(modelJson),
  });
}

async function handleChat(req, res) {
  const caller = authenticateCaller(req);
  setRateLimitHeaders(res, caller.key);
  const { body, raw } = await readJsonWithRaw(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Request body must be a JSON object.", "invalid_request_error", "invalid_body");
  }
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    throw new ApiError(400, "You must provide a model parameter.", "invalid_request_error", "missing_model", "model");
  }
  if (!MODELS.has(model)) {
    throw new ApiError(
      404,
      `The model '${model}' does not exist or you do not have access to it.`,
      "invalid_request_error",
      "model_not_found",
      "model",
    );
  }
  if (body.n !== undefined && body.n !== 1) {
    throw new ApiError(400, "n>1 is not supported by this provider.", "invalid_request_error", "unsupported_n", "n");
  }
  if (body.logprobs === true || body.top_logprobs !== undefined) {
    throw new ApiError(
      400,
      "logprobs are not supported by this provider.",
      "invalid_request_error",
      "unsupported_logprobs",
      "logprobs",
    );
  }

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
      const ticket = tickets.get(existing.ticketId);
      if (!ticket) {
        throw new ApiError(410, "The idempotent request has expired.", "invalid_request_error", "idempotency_expired");
      }
      if (!ticket.finished) {
        log(`[idempotency-wait] ${ticket.id} caller=${caller.label}`);
        await ticket.donePromise;
      }
      log(`[idempotency-replay] ${ticket.id} caller=${caller.label}`);
      return replayTicket(ticket, res);
    }
  }
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    throw new ApiError(400, "stream must be a boolean.", "invalid_request_error", "invalid_stream", "stream");
  }
  if (body.n !== undefined && Number(body.n) !== 1) {
    throw new ApiError(400, "Only n=1 is supported by this endpoint.", "invalid_request_error", "unsupported_value", "n");
  }
  if (body.stream_options !== undefined && (typeof body.stream_options !== "object" || body.stream_options === null)) {
    throw new ApiError(400, "stream_options must be an object.", "invalid_request_error", "invalid_stream_options", "stream_options");
  }

  const { messages, attachments } = extractMessages(body.messages);
  const releaseSlot = takeSlot(caller.key);
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
    ticket = createTicket({ body, messages, attachments, caller, releaseSlot });
  } catch (error) {
    releaseSlot();
    throw error;
  }

  ticket.res = res;
  tickets.set(ticket.id, ticket);
  stats.created += 1;
  if (idempotencyKey) {
    idempotencyRecords.set(idempotencyKey, {
      bodyHash,
      ticketId: ticket.id,
      createdAt: Date.now(),
    });
  }

  res.on("close", () => {
    if (!ticket.finished && !res.writableEnded) abandonTicket(ticket);
  });

  armQueueTimeout(ticket);

  log(
    `[request] ${ticket.id} model=${model} stream=${ticket.stream} caller=${caller.label} messages=${messages.length} tokens≈${ticket.promptTokens}`,
  );
  if (config.logContent) {
    log(`[content] ${ticket.id} ${JSON.stringify(messages).slice(0, 2000)}`);
  }
  // The response stays open until an operator claims/finishes, or a timeout fires.
}

function requireAdmin(session) {
  if (session.role !== "admin") {
    throw new ApiError(403, "Administrator role required.", "authentication_error", "admin_required");
  }
}

function publicUser(user) {
  return { username: user.username, role: user.role, createdAt: user.createdAt };
}

async function handleOperator(req, res, url, session) {
  const pathname = url.pathname;
  const body = ["POST", "PATCH"].includes(req.method) ? await readJson(req) : {};
  const operator = session.username;

  if (pathname === "/op/api/users") {
    requireAdmin(session);
    if (req.method === "GET") {
      return sendJson(res, 200, { ok: true, users: auth.listUsers().map(publicUser) });
    }
    if (req.method === "POST") {
      const user = auth.addUser(body.username, body.password, body.role || "operator");
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
      log(`[admin] user updated username=${target} by=${session.username}`);
      return sendJson(res, 200, { ok: true, user: user ? publicUser(user) : null });
    }
    if (req.method === "DELETE") {
      if (target === session.username) {
        throw new ApiError(409, "You cannot delete your own account.", "invalid_request_error", "cannot_delete_self");
      }
      auth.removeUser(target);
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
        queueTimeoutMs: config.queueTimeoutMs,
        responseTimeoutMs: config.responseTimeoutMs,
        streamDelayMs: config.streamDelayMs,
        maxConcurrentPerKey: config.maxConcurrentPerKey,
      },
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

  const match = /^\/op\/api\/tickets\/([^/]+)(?:\/(claim|chunk|finish|release|cancel))?$/.exec(pathname);
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
    log(`[claim] ${ticket.id} operator=${operator} wait=${ticket.claimedAt - ticket.created}ms`);
    return sendJson(res, 200, { ok: true, ticket: publicTicket(ticket) });
  }

  if (action === "chunk") {
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
    log(`[chunk] ${ticket.id} +${result.added} chars total=${result.total}${result.forced ? ` forced=${result.forced}` : ""}`);
    return sendJson(res, 200, {
      ok: true,
      state: ticket.state,
      textLength: ticket.text.length,
      forcedFinishReason: result.forced,
    });
  }

  if (action === "finish") {
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
    log(`[release] ${ticket.id} operator=${operator}`);
    return sendJson(res, 200, { ok: true, ticket: publicTicket(ticket) });
  }

  if (action === "cancel") {
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

async function serveConsole(req, res) {
  try {
    const body = await readFile(path.join(PUBLIC_DIR, "console.html"));
    sendRaw(res, 200, "text/html; charset=utf-8", req.method === "HEAD" ? "" : body, {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
  } catch {
    throw new ApiError(404, "Console not found.", "invalid_request_error", "not_found");
  }
}

function parseLoginBody(raw, contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("application/json")) {
    const parsed = JSON.parse(raw || "{}");
    return { username: parsed.username, password: parsed.password, next: parsed.next };
  }
  const params = new URLSearchParams(raw);
  return {
    username: params.get("username"),
    password: params.get("password"),
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
    log(`[login-failed] ip=${ip} username=${usernameForLimit || "-"}`);
    return serveLoginPage(res, {
      status: 401,
      error: "用户名或密码错误。",
      next: safeNextPath(form.next, "/console"),
    });
  }

  auth.clearLoginFailures(ip, usernameForLimit);
  const session = auth.createSession(user, {
    ip,
    userAgent: req.headers["user-agent"],
  });
  log(`[login-ok] user=${user.username} role=${user.role} ip=${ip}`);
  res.setHeader("Set-Cookie", auth.sessionCookie(session, req));
  res.writeHead(303, { Location: safeNextPath(form.next, "/console") });
  res.end();
}

async function handleLogout(req, res) {
  const session = requireSession(req, { csrf: true });
  auth.destroySession(req);
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
      queueTimeoutMs: config.queueTimeoutMs,
      responseTimeoutMs: config.responseTimeoutMs,
      streamDelayMs: config.streamDelayMs,
      maxConcurrentPerKey: config.maxConcurrentPerKey,
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
        applyCorsTo(res);
        res.writeHead(204);
        res.end();
        return;
      }
      throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
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

    const publicFile = PUBLIC_FILES.get(pathname);
    if (publicFile) return serveStatic(req, res, publicFile);

    if (pathname === "/v1/models" || pathname.startsWith("/v1/models/")) {
      applyCorsTo(res);
      if (req.method !== "GET") {
        throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      }
      return handleModels(req, res, url);
    }

    if (pathname === "/v1/chat/completions") {
      applyCorsTo(res);
      if (req.method !== "POST") {
        throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
      }
      // /v1 authenticates with a Bearer key, not a cookie, so it is not a
      // CSRF surface. CORSOrigin only controls browser readability.
      return handleChat(req, res);
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
      : error instanceof AuthError
        ? new ApiError(error.status, error.message, "invalid_request_error", error.code)
        : new ApiError(500, "The server had an error while processing your request.", "server_error", "internal_error");

  if (!(error instanceof ApiError) && !(error instanceof AuthError)) {
    console.error(nowIso(), "[unhandled]", error);
  }

  if (isResOpen(res)) {
    if (!res.headersSent) {
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
    } else {
      res.end();
    }
  }
}

const requestHandler = (req, res) => {
  route(req, res).catch((error) => handleError(res, error));
};

const server =
  config.tlsCert && config.tlsKey
    ? https.createServer(
        {
          cert: readFileSync(config.tlsCert),
          key: readFileSync(config.tlsKey),
        },
        requestHandler,
      )
    : http.createServer(requestHandler);
const scheme = config.tlsCert && config.tlsKey ? "https" : "http";

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
  const maskedKeys = [...config.callerKeys.keys()].map((key) => `${key.slice(0, 6)}…${key.slice(-4)}`);
  log(`能工智人 (nenggong-zhiren) v${VERSION} listening on ${config.host}:${address.port}`);
  log(`  login       ${base}/login`);
  log(`  console     ${base}/console`);
  for (const url of lanUrls) log(`  LAN         ${url}/login`);
  log(`  caller keys ${maskedKeys.join(", ")} (${config.callerKeys.size})`);
  log(`  models      ${[...MODELS.keys()].join(", ")}`);
  log(`  users       ${auth.listUsers().length} (${auth.listUsers().map((user) => user.username).join(", ")})`);
  const relativeUsers = path.relative(ROOT, config.usersFile);
  log(`  users file  ${relativeUsers && !relativeUsers.startsWith("..") ? relativeUsers : "<external USERS_FILE>"}`);
  if (config.callerKeys.size === 0) log("  WARNING     no HUMAN_KEYS configured; /v1 will reject all callers");
  log(`  timeouts    queue=${config.queueTimeoutMs}ms response=${config.responseTimeoutMs}ms`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log(`received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  });
}
