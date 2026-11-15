import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ApiKeyError, ApiKeyStore, KEY_PREFIX } from "../src/data/api-keys.mjs";
import { QuotaError, UsageStore } from "../src/data/usage.mjs";
import { parseCsv, cleanFilename, detectImage, extractPdfText, AttachmentError, AttachmentStore } from "../src/data/attachments.mjs";
import { validateJsonSchema, formatSchemaErrors } from "../src/schema.mjs";
import { SettingsError, SettingsStore } from "../src/data/settings.mjs";
import { ModelError, ModelStore } from "../src/data/models.mjs";
import { AuthService } from "../src/auth.mjs";
import { StateStore } from "../src/data/state.mjs";
import { AuditStore } from "../src/data/audit.mjs";
import { stripJsonc, parseJsonc, loadConfig, ConfigError } from "../src/config.mjs";
import { readRestartStatus, writeRestartStatus } from "../src/runtime-state.mjs";

const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ngzr-unit-"));
  return { dir, file: (name) => path.join(dir, name), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

test("ApiKeyStore creates, authenticates, rotates and persists without plaintext", () => {
  const { dir, file, cleanup } = tmp();
  let now = 1_700_000_000_000;
  const store = new ApiKeyStore({ file: file("keys.json"), now: () => now, usageFlushMs: 60_000, logger: { log() {}, error() {} } }).init();
  try {
    const created = store.create({ name: "演示", limits: { requestsPerMinute: 2, maxConcurrent: 3, maxUploadConcurrency: 3, maxDownloadConcurrency: 1 }, allowedModels: ["human-1"], expiresAt: now + 60_000 });
    assert.match(created.token, new RegExp(`^${KEY_PREFIX}`));
    assert.equal(created.record.hint.includes(created.token), false);
    assert.equal(created.record.limits.maxUploadConcurrency, 3);
    assert.equal(created.record.limits.maxDownloadConcurrency, 1);
    assert.equal(store.list().length, 1);
    assert.equal(JSON.stringify(store.list()).includes(created.token), false);
    assert.equal(fs.readFileSync(file("keys.json"), "utf8").includes(created.token), false);
    const auth = store.authenticate(created.token);
    assert.equal(auth.id, created.record.id);
    assert.deepEqual(auth.allowedModels, ["human-1"]);
    assert.equal(store.authenticate("wrong"), null);
    now += 61_000;
    assert.equal(store.authenticate(created.token), null);
    now -= 61_000;
    const rotated = store.rotate(created.record.id);
    assert.notEqual(rotated.token, created.token);
    assert.equal(store.authenticate(created.token), null);
    assert.equal(store.authenticate(rotated.token).id, created.record.id);
    assert.throws(() => store.create({ value: "short" }), (error) => error instanceof ApiKeyError && error.code === "invalid_key_value");
    assert.throws(() => store.create({ limits: { requestsPerDay: -1 } }), (error) => error.code === "invalid_key_limit");
    store.close();
    const reloaded = new ApiKeyStore({ file: file("keys.json"), now: () => now, logger: { log() {}, error() {} } }).init();
    try {
      assert.equal(reloaded.list().length, 1);
      assert.equal(reloaded.authenticate(rotated.token).id, created.record.id);
      assert.equal(reloaded.list()[0].limits.maxUploadConcurrency, 3);
      assert.equal(reloaded.list()[0].limits.maxDownloadConcurrency, 1);
    } finally {
      reloaded.close();
    }
  } finally {
    store.close();
    cleanup();
  }
});

test("ApiKeyStore rejects duplicates and validates updates", () => {
  const { file, cleanup } = tmp();
  const store = new ApiKeyStore({ file: file("keys.json"), logger: { log() {}, error() {} } }).init();
  try {
    const first = store.create({ name: "one", value: "custom-key-123456" });
    assert.throws(() => store.importKey("custom-key-123456"), (error) => error.code === "key_exists");
    const updated = store.update(first.record.id, { name: "renamed", disabled: true, allowedModels: "human-1,human-2" });
    assert.equal(updated.name, "renamed");
    assert.equal(updated.disabled, true);
    assert.deepEqual(updated.allowedModels, ["human-1", "human-2"]);
    assert.equal(store.authenticate("custom-key-123456"), null);
    store.update(first.record.id, { disabled: false });
    assert.equal(store.authenticate("custom-key-123456").id, first.record.id);
    assert.throws(() => store.rename("missing", "x"), (error) => error.code === "key_not_found");
    store.remove(first.record.id);
    assert.equal(store.list().length, 0);
  } finally {
    store.close();
    cleanup();
  }
});

test("UsageStore enforces minute, day, month and upload quotas", () => {
  const { file, cleanup } = tmp();
  let now = 1_700_000_000_000;
  const store = new UsageStore({ file: file("usage.json"), now: () => now, flushMs: 60_000, logger: { error() {} } }).init();
  try {
    for (let i = 0; i < 2; i += 1) store.consume("key", { requestsPerMinute: 2, requestsPerDay: 3, requestsPerMonth: 4 });
    assert.throws(() => store.consume("key", { requestsPerMinute: 2 }), (error) => error instanceof QuotaError && error.code === "rate_limit_per_minute");
    now += 60_000;
    assert.equal(store.consume("key", { requestsPerDay: 3 }).day, 3);
    assert.throws(() => store.consume("key", { requestsPerDay: 1 }), (error) => error.code === "quota_per_day");
    store.addTokens("key", 42);
    assert.equal(store.get("key").totalTokens, 42);
    store.addUploadBytes("key", 10);
    assert.throws(() => store.checkUploadQuota("key", 1, 10), (error) => error.code === "upload_quota_exceeded");
    assert.doesNotThrow(() => store.checkUploadQuota("other", 10, 10));
  } finally {
    store.close();
    cleanup();
  }
});

test("UsageStore persists counters across reload", () => {
  const { file, cleanup } = tmp();
  const store = new UsageStore({ file: file("usage.json"), flushMs: 60_000, logger: { error() {} } }).init();
  store.consume("persisted", {});
  store.addTokens("persisted", 12);
  store.close();
  const reloaded = new UsageStore({ file: file("usage.json"), logger: { error() {} } }).init();
  try {
    const value = reloaded.get("persisted");
    assert.equal(value.totalRequests, 1);
    assert.equal(value.totalTokens, 12);
  } finally {
    reloaded.close();
    cleanup();
  }
});

test("JSON Schema does not accept prototype-named required keys", () => {
  const requiredToString = validateJsonSchema({}, { type: "object", properties: {}, additionalProperties: false, required: ["toString"] });
  assert.equal(requiredToString.ok, false);
  const prototypeKey = validateJsonSchema({ constructor: 1 }, { type: "object", properties: {}, additionalProperties: false });
  assert.equal(prototypeKey.ok, false);
});

test("JSON Schema validates nested objects, arrays and combinators", () => {
  const schema = {
    type: "object",
    required: ["name", "tags"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 2, maxLength: 8 },
      age: { type: ["integer", "null"], minimum: 0, maximum: 120 },
      tags: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
      mode: { oneOf: [{ const: "a" }, { const: "b" }] },
      nested: { anyOf: [{ type: "string" }, { type: "integer" }] },
    },
  };
  assert.equal(validateJsonSchema({ name: "ok", tags: ["a"], age: 3, mode: "a", nested: 1 }, schema).ok, true);
  const bad = validateJsonSchema({ name: "x", tags: [], extra: true, mode: "c", nested: true }, schema);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 3);
  assert.match(formatSchemaErrors(bad.errors), /missing|characters|items|exactly one/);
  assert.equal(validateJsonSchema({ name: "a", tags: ["x"], age: "x" }, schema).ok, false);
  assert.equal(validateJsonSchema({ name: "ab", tags: ["x"], age: null }, schema).ok, true);
  assert.equal(validateJsonSchema({ a: 1 }, { type: "object", required: ["a"], additionalProperties: false, properties: { a: { type: "integer" } } }).ok, true);
});

test("attachment helpers sanitize names, detect images and parse CSV/PDF safely", () => {
  assert.equal(cleanFilename("../../evil\\name.txt"), "name.txt");
  assert.equal(cleanFilename(""), "attachment");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  assert.deepEqual(detectImage(png), { kind: "image", mime: "image/png", width: 1, height: 1 });
  assert.equal(detectImage(Buffer.from("<html>")), null);
  const csv = parseCsv('id,name\n1,"a,b"\n2,plain');
  assert.deepEqual(csv.columns, ["id", "name"]);
  assert.equal(csv.rows[0][1], "a,b");
  assert.equal(csv.rows[1][1], "plain");
  assert.equal(parseCsv("a,b\n1,2", { maxRows: 1 }).truncated, true);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page /Count 1 >>\nstream\nBT (Hello PDF) Tj ET\nendstream\nendobj");
  assert.match(extractPdfText(pdf, 1000).text, /Hello PDF/);
  assert.throws(() => extractPdfText(Buffer.from("%PDF /Encrypt <<>>"), 100), (error) => error instanceof AttachmentError && error.code === "pdf_encrypted");
  assert.throws(() => extractPdfText(Buffer.from("%PDF /JavaScript <<>>"), 100), (error) => error.code === "pdf_active_content");
});

test("SettingsStore validates, serializes and drops legacy AI limit fields", () => {
  const { file, cleanup } = tmp();
  const defaults = {
    queue: { waitTimeoutMs: 1000, responseTimeoutMs: 2000, retentionMs: 10_000, streamDelayMs: 1 },
    limits: { maxConcurrentPerKey: 4, bodyLimitBytes: 1024 },
    features: { auditLog: true, usageDashboard: true, publicGuide: true },
    aiAssist: { enabled: false, endpoint: "", model: "", maxConcurrent: 2, autoReplyOnReceive: false, autoClaimEnabled: false },
  };
  const store = new SettingsStore({ file: file("settings.json"), defaults, logger: { error() {} } }).init();
  try {
    assert.equal(store.get().aiAssist.enabled, false);
    assert.equal(store.get().workers.externalPython, "");
    store.update({ workers: { externalPython: "/opt/example/python" } });
    assert.equal(store.get().workers.externalPython, "/opt/example/python");
    const updated = store.update({ aiAssist: { enabled: true, maxConcurrent: 3 }, features: { publicGuide: false } });
    assert.equal(updated.aiAssist.enabled, true);
    assert.equal(updated.aiAssist.maxConcurrent, 3);
    assert.equal(updated.features.publicGuide, false);
    assert.throws(() => store.update({ aiAssist: { maxConcurrent: 0 } }), (error) => error instanceof SettingsError);
    store.update({ aiAssist: { maxInputChars: 1 } });
    assert.equal(Object.hasOwn(store.get().aiAssist, "maxInputChars"), false);
    store.close();
    const reloaded = new SettingsStore({ file: file("settings.json"), defaults, logger: { error() {} } }).init();
    try { assert.equal(reloaded.get().aiAssist.enabled, true); } finally { reloaded.close(); }
  } finally { cleanup(); }
});

test("ModelStore persists custom models and protects the last model", () => {
  const { file, cleanup } = tmp();
  const store = new ModelStore({ file: file("models.json"), seed: [{ id: "human-1", name: "Human 1" }], logger: { error() {} } }).init();
  try {
    const added = store.add({ id: "human-fast", name: "Fast", speedMs: 25, contextWindow: 1000 });
    assert.equal(added.id, "human-fast");
    assert.throws(() => store.add({ id: "human-fast" }), (error) => error instanceof ModelError && error.code === "model_exists");
    store.update("human-fast", { description: "updated", speedMs: 30 });
    assert.equal(store.get("human-fast").speedMs, 30);
    store.remove("human-fast");
    assert.equal(store.has("human-fast"), false);
    assert.throws(() => store.remove("human-1"), (error) => error.code === "last_model");
  } finally { cleanup(); }
});

test("AuditStore appends, filters and honors disabled state", () => {
  const { file, cleanup } = tmp();
  let enabled = true;
  const audit = new AuditStore({ file: file("audit.log"), enabled: () => enabled, now: () => 1_700_000_000_000, logger: { error() {} } }).init();
  try {
    audit.append({ actor: "alice", action: "login", target: "web", ip: "127.0.0.1" });
    audit.append({ actor: "bob", action: "ticket.claim", target: "t1" });
    assert.equal(audit.list({ limit: 1 }).length, 1);
    assert.equal(audit.list({ action: "login" })[0].actor, "alice");
    assert.equal(audit.list({ actor: "bob" })[0].action, "ticket.claim");
    enabled = false;
    audit.append({ actor: "alice", action: "ignored" });
    assert.equal(audit.list({ action: "ignored" }).length, 0);
  } finally { cleanup(); }
});

test("AttachmentStore creates, owns, previews and rejects attachments", () => {
  const { dir, cleanup } = tmp();
  const store = new AttachmentStore({ dir, maxBytes: 1000, logger: { error() {} } }).init();
  try {
    const text = store.create({ buffer: Buffer.from("hello,world\n"), filename: "../notes.txt", declaredType: "text/plain", ownerHash: "owner-a" });
    assert.equal(text.filename, "notes.txt");
    assert.equal(store.summary(text).previewAvailable, true);
    assert.equal(store.getOwned(text.id, "owner-a").id, text.id);
    assert.throws(() => store.getOwned(text.id, "owner-b"), (error) => error.code === "attachment_not_found");
    assert.match(store.preview(text.id).preview.text, /hello,world/);
    assert.equal(store.readBlob(text.id).buffer.toString(), "hello,world\n");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const image = store.create({ buffer: png, filename: "pixel.png", declaredType: "image/png", ownerHash: "owner-a" });
    assert.equal(store.summary(image).kind, "image");
    assert.equal(store.preview(image.id).image.width, 1);
    assert.throws(() => store.create({ buffer: Buffer.alloc(0), filename: "x.txt" }), (error) => error.code === "empty_file");
    assert.throws(() => store.create({ buffer: Buffer.alloc(1001), filename: "x.txt" }), (error) => error.code === "file_too_large");
    assert.throws(() => store.create({ buffer: Buffer.from("bin\u0000ary"), filename: "x.txt", declaredType: "text/plain" }), (error) => error.code === "binary_text");
    assert.throws(() => store.create({ buffer: Buffer.from("hello"), filename: "x.bin", declaredType: "application/octet-stream" }), (error) => error.code === "unsupported_file_type");
    assert.throws(() => store.get("file_bad"), (error) => error.code === "invalid_attachment_id");
  } finally { cleanup(); }
});

test("config loader accepts the example config and rejects malformed JSONC", () => {
  const { dir, cleanup } = tmp();
  try {
    const file = path.join(dir, "config.jsonc");
    fs.writeFileSync(file, fs.readFileSync(path.join(process.cwd(), "config.example.jsonc"), "utf8"));
    const loaded = loadConfig(file);
    assert.equal(typeof loaded.server.port, "number");
    assert.equal(Object.hasOwn(loaded.storage, "aiUsageFile"), false);
    fs.writeFileSync(file, '{ "server": { "port": } }');
    assert.throws(() => loadConfig(file), (error) => error instanceof ConfigError);
  } finally { cleanup(); }
});

test("JSONC parser handles comments, trailing commas and string literals", () => {
  const source = '{ // comment\n "url": "http://example/x", /* block */ "n": 1, }';
  const parsed = parseJsonc(source, "test.jsonc");
  assert.equal(parsed.url, "http://example/x");
  assert.equal(parsed.n, 1);
  assert.equal(stripJsonc('{"x":"// not comment"}').includes("not comment"), true);
  assert.throws(() => parseJsonc('{ "x": }'), /JSON/);
});

test("restart status file merges patches atomically", () => {
  const dir = tmp();
  const file = dir.file("restart-status.json");
  try {
    assert.equal(readRestartStatus(file), null);
    writeRestartStatus(file, { requestedAt: "2026-01-01T00:00:00.000Z", oldPid: 1, childPid: 2 });
    writeRestartStatus(file, { readyAt: "2026-01-01T00:00:02.000Z", readyPid: 3 });
    const status = readRestartStatus(file);
    assert.equal(status.oldPid, 1);
    assert.equal(status.childPid, 2);
    assert.equal(status.readyPid, 3);
    writeRestartStatus(file, { failedAt: "2026-01-01T00:00:05.000Z", error: "timeout" });
    assert.equal(readRestartStatus(file).readyAt, "2026-01-01T00:00:02.000Z");
    assert.equal(readRestartStatus(file).error, "timeout");
  } finally {
    dir.cleanup();
  }
});

test("login throttling isolates by address and username and exempts admins", () => {
  const dir = tmp();
  try {
    const auth = new AuthService({
      dataDir: dir.dir,
      loginRateWindowMs: 60_000,
      loginIpMaxFailures: 10,
      loginUserMaxFailures: 3,
      loginComboMaxFailures: 2,
      logger: { log() {}, error() {} },
    }).init();
    auth.addUser("admin", "admin-password-1", "admin");
    auth.addUser("operator", "operator-password-1", "operator");
    // Combo failures only lock the same address + username pair.
    auth.recordLoginFailure("10.0.0.1", "operator");
    auth.recordLoginFailure("10.0.0.1", "operator");
    assert.equal(auth.loginAllowed("10.0.0.1", "operator").allowed, false);
    assert.equal(auth.loginAllowed("10.0.0.2", "operator").allowed, true);
    auth.clearLoginFailures("10.0.0.1", "operator");
    assert.equal(auth.loginAllowed("10.0.0.1", "operator").allowed, true);
    // Username-wide lock still applies to operators from other addresses.
    auth.recordLoginFailure("10.0.0.3", "operator");
    auth.recordLoginFailure("10.0.0.4", "operator");
    auth.recordLoginFailure("10.0.0.5", "operator");
    assert.equal(auth.loginAllowed("10.0.0.6", "operator").allowed, false);
    // Admins are exempt from the username-wide lock but not the combo lock.
    auth.recordLoginFailure("10.0.0.7", "admin");
    auth.recordLoginFailure("10.0.0.8", "admin");
    auth.recordLoginFailure("10.0.0.9", "admin");
    assert.equal(auth.loginAllowed("10.0.0.10", "admin").allowed, true);
    auth.recordLoginFailure("10.0.0.10", "admin");
    auth.recordLoginFailure("10.0.0.10", "admin");
    assert.equal(auth.loginAllowed("10.0.0.10", "admin").allowed, false);
    // Shared loopback addresses skip the IP-wide lock (portproxy/NAT), but the
    // per-combination lock still applies.
    for (let index = 0; index < 20; index += 1) auth.recordLoginFailure("127.0.0.1", `spray-${index}`);
    auth.recordLoginFailure("127.0.0.1", "spray-0");
    assert.equal(auth.loginAllowed("127.0.0.1", "loop-user").allowed, true);
    assert.equal(auth.loginAllowed("127.0.0.1", "spray-0").allowed, false);
    auth.destroyAllSessions();
    auth.close();
  } finally {
    dir.cleanup();
  }
});

test("state snapshots cap raw request bodies and message text", async () => {
  const dir = tmp();
  try {
    const store = new StateStore({ file: dir.file("state.json"), backend: "json", logger: { log() {}, error() {} } }).init();
    const ticket = {
      id: "chatcmpl-cap",
      protocol: "openai",
      model: "human-1",
      createdAt: Date.now(),
      messages: [{ role: "user", content: "m".repeat(900 * 1024) }],
      requestInspection: { raw: "r".repeat(900 * 1024), truncated: false, protocol: "openai" },
      text: "",
      state: "done",
    };
    store.snapshot([ticket], []);
    const saved = store.tickets.find((item) => item.id === ticket.id);
    assert.ok(saved);
    assert.equal(saved.requestInspection.rawDropped, true);
    assert.equal(saved.requestInspection.raw.length, 256 * 1024);
    assert.ok(saved.messages[0].content.length <= 512 * 1024 + 32);
    store.close?.();
  } finally {
    dir.cleanup();
  }
});
