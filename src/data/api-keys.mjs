/**
 * API key storage.
 *
 * The browser is the only place where a newly-created key is shown in full.
 * The server persists a SHA-256 hash, a short display hint, the owner-facing
 * name and lifecycle metadata. The plaintext key is never logged or written.
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";

const FILE_VERSION = 1;
const KEY_PREFIX = "sk-ngzr-";
const MAX_NAME = 64;
const MAX_KEYS = 500;

export class ApiKeyError extends Error {
  constructor(message, code = "invalid_api_key", status = 400) {
    super(message);
    this.name = "ApiKeyError";
    this.code = code;
    this.status = status;
  }
}

function normalizeName(value, fallback = "未命名密钥") {
  const name = String(value ?? "").trim();
  if (!name) return fallback;
  if (name.length > MAX_NAME) {
    throw new ApiKeyError(`密钥名称最多 ${MAX_NAME} 个字符。`, "invalid_key_name");
  }
  return name;
}

function hashToken(token) {
  return createHash("sha256").update(String(token), "utf8").digest("hex");
}

function normalizeLimit(value, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0 || number > 1_000_000) {
    throw new ApiKeyError("配额必须是 0 或正整数（0 表示不限）。", "invalid_key_limit");
  }
  return number;
}

function normalizeLimits(raw = {}) {
  return {
    requestsPerMinute: normalizeLimit(raw.requestsPerMinute),
    requestsPerDay: normalizeLimit(raw.requestsPerDay ?? raw.perDay),
    requestsPerMonth: normalizeLimit(raw.requestsPerMonth ?? raw.perMonth),
    maxConcurrent: normalizeLimit(raw.maxConcurrent),
  };
}

function normalizeAllowedModels(raw) {
  if (raw === undefined || raw === null || raw === "") return [];
  if (typeof raw === "string") {
    return raw.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 64);
  }
  if (!Array.isArray(raw)) throw new ApiKeyError("允许的模型必须是字符串数组。", "invalid_allowed_models");
  return raw.map((item) => String(item).trim()).filter(Boolean).slice(0, 64);
}

function normalizeExpiresAt(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || number <= 0) {
    throw new ApiKeyError("过期时间必须是毫秒时间戳或留空。", "invalid_expiry");
  }
  return Math.trunc(number);
}

function publicRecord(record) {
  return {
    id: record.id,
    name: record.name,
    hint: record.hint,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt || null,
    disabled: record.disabled === true,
    limits: record.limits,
    allowedModels: record.allowedModels,
    expiresAt: record.expiresAt || null,
  };
}

function safeEqualHex(left, right) {
  const a = Buffer.from(String(left), "hex");
  const b = Buffer.from(String(right), "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function nowIso(now) {
  return new Date(now).toISOString();
}

export class ApiKeyStore {
  constructor({ file, logger = console, now = Date.now, usageFlushMs = 5_000 } = {}) {
    if (!file) throw new Error("ApiKeyStore needs a file path");
    this.file = path.resolve(file);
    this.logger = logger;
    this.now = now;
    this.usageFlushMs = usageFlushMs;
    this.records = new Map();
    this.usageDirty = false;
    this.flushTimer = null;
    this.watchHandler = null;
    this.closed = false;
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.load();
    this.watch();
    return this;
  }

  watch() {
    if (this.watchHandler) return;
    this.watchHandler = (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
      try {
        this.load();
        this.logger.log?.("[keys] API key file changed; reloaded");
      } catch (error) {
        this.logger.error?.(`[keys] reload failed: ${error.message}`);
      }
    };
    fs.watchFile(this.file, { interval: 1_000 }, this.watchHandler);
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.records = new Map();
      this.persist();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      fs.chmodSync(this.file, 0o600);
    } catch (error) {
      throw new Error(`无法读取调用密钥文件 ${this.file}: ${error.message}`);
    }
    if (!parsed || parsed.version !== FILE_VERSION || !Array.isArray(parsed.keys)) {
      throw new Error(`调用密钥文件格式不正确: ${this.file}`);
    }
    this.records = new Map();
    for (const raw of parsed.keys) {
      if (!raw || typeof raw !== "object") continue;
      const id = typeof raw.id === "string" ? raw.id : "";
      const hash = typeof raw.hash === "string" ? raw.hash : "";
      if (!id || !/^[a-f0-9]{64}$/.test(hash)) continue;
      this.records.set(id, {
        id,
        name: normalizeName(raw.name),
        hint: typeof raw.hint === "string" ? raw.hint : KEY_PREFIX.slice(0, 8) + "…",
        hash,
        createdAt: Number(raw.createdAt) || this.now(),
        lastUsedAt: raw.lastUsedAt ? Number(raw.lastUsedAt) : null,
        disabled: raw.disabled === true,
        limits: normalizeLimits(raw.limits || raw.rateLimit || {}),
        allowedModels: normalizeAllowedModels(raw.allowedModels || []),
        expiresAt: raw.expiresAt ? Number(raw.expiresAt) : null,
      });
    }
  }

  persist() {
    this.usageDirty = false;
    if (this.closed) return;
    const payload = {
      version: FILE_VERSION,
      keys: [...this.records.values()].map((record) => ({
        id: record.id,
        name: record.name,
        hint: record.hint,
        hash: record.hash,
        createdAt: record.createdAt,
        lastUsedAt: record.lastUsedAt || undefined,
        disabled: record.disabled === true,
        limits: record.limits,
        allowedModels: record.allowedModels,
        expiresAt: record.expiresAt || undefined,
      })),
    };
    const temp = path.join(
      path.dirname(this.file),
      `.api-keys.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`,
    );
    fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  scheduleUsageFlush() {
    if (this.flushTimer || this.closed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.usageDirty) {
        try {
          this.persist();
        } catch (error) {
          this.logger.error?.(`[keys] usage persist failed: ${error.message}`);
        }
      }
    }, this.usageFlushMs);
    this.flushTimer.unref?.();
  }

  list() {
    return [...this.records.values()]
      .map(publicRecord)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  create({ name, value, limits, allowedModels, expiresAt } = {}) {
    if (this.records.size >= MAX_KEYS) {
      throw new ApiKeyError(`最多保留 ${MAX_KEYS} 个调用密钥。`, "too_many_keys", 409);
    }
    const custom = String(value || "").trim();
    if (custom && !/^[A-Za-z0-9._~-]{12,256}$/.test(custom)) {
      throw new ApiKeyError(
        "自定义密钥需为 12–256 位字母、数字、下划线、点、波浪线或连字符。",
        "invalid_key_value",
      );
    }
    const token = custom || `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    return this.createFromToken(token, normalizeName(name), { limits, allowedModels, expiresAt });
  }

  /**
   * Used during local migration. The caller must supply the already-existing
   * plaintext key; it is hashed and never persisted in clear text.
   */
  importKey(token, name = "迁移密钥") {
    const key = String(token || "").trim();
    if (!key) throw new ApiKeyError("密钥不能为空。", "empty_key");
    return this.createFromToken(key, normalizeName(name));
  }

  createFromToken(token, name, { limits, allowedModels, expiresAt } = {}) {
    const hash = hashToken(token);
    for (const record of this.records.values()) {
      if (safeEqualHex(record.hash, hash)) {
        throw new ApiKeyError("这个密钥已经存在。", "key_exists", 409);
      }
    }
    const createdAt = this.now();
    const id = `key_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    const record = {
      id,
      name,
      hint: `${token.slice(0, 8)}…${token.slice(-4)}`,
      hash,
      createdAt,
      lastUsedAt: null,
      disabled: false,
      limits: normalizeLimits(limits || {}),
      allowedModels: normalizeAllowedModels(allowedModels || []),
      expiresAt: normalizeExpiresAt(expiresAt),
    };
    this.records.set(id, record);
    this.persist();
    return { token, record: publicRecord(record) };
  }

  authenticate(token) {
    const raw = String(token || "").trim();
    if (!raw) return null;
    const hash = hashToken(raw);
    for (const record of this.records.values()) {
      if (record.disabled) continue;
      if (!safeEqualHex(record.hash, hash)) continue;
      if (record.expiresAt && record.expiresAt <= this.now()) return null;
      record.lastUsedAt = this.now();
      this.usageDirty = true;
      this.scheduleUsageFlush();
      return {
        id: record.id,
        key: record.id,
        label: record.name,
        hint: record.hint,
        limits: record.limits,
        allowedModels: record.allowedModels,
        expiresAt: record.expiresAt,
      };
    }
    return null;
  }

  rename(id, name) {
    const record = this.records.get(String(id));
    if (!record) throw new ApiKeyError("调用密钥不存在。", "key_not_found", 404);
    record.name = normalizeName(name, record.name);
    this.persist();
    return publicRecord(record);
  }

  setDisabled(id, disabled) {
    const record = this.records.get(String(id));
    if (!record) throw new ApiKeyError("调用密钥不存在。", "key_not_found", 404);
    record.disabled = Boolean(disabled);
    this.persist();
    return publicRecord(record);
  }

  update(id, { name, limits, allowedModels, expiresAt, disabled } = {}) {
    const record = this.records.get(String(id));
    if (!record) throw new ApiKeyError("调用密钥不存在。", "key_not_found", 404);
    if (name !== undefined) record.name = normalizeName(name, record.name);
    if (limits !== undefined) record.limits = normalizeLimits(limits || {});
    if (allowedModels !== undefined) record.allowedModels = normalizeAllowedModels(allowedModels);
    if (expiresAt !== undefined) record.expiresAt = normalizeExpiresAt(expiresAt);
    if (disabled !== undefined) record.disabled = Boolean(disabled);
    this.persist();
    return publicRecord(record);
  }

  remove(id) {
    const key = String(id);
    if (!this.records.has(key)) {
      throw new ApiKeyError("调用密钥不存在。", "key_not_found", 404);
    }
    this.records.delete(key);
    this.persist();
  }

  close() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.watchHandler) {
      fs.unwatchFile(this.file, this.watchHandler);
      this.watchHandler = null;
    }
    try {
      if (this.usageDirty) this.persist();
    } catch {
      /* process shutdown: best effort */
    }
    this.closed = true;
  }
}

export { KEY_PREFIX, hashToken, publicRecord, nowIso };
