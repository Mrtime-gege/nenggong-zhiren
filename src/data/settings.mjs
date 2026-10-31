/** Runtime-editable settings, persisted separately from commented config.jsonc. */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const VERSION = 1;

export class SettingsError extends Error {
  constructor(message, code = "invalid_settings") {
    super(message);
    this.name = "SettingsError";
    this.status = 400;
    this.code = code;
  }
}

function int(value, label, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) {
    throw new SettingsError(`${label} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function bool(value, label) {
  if (typeof value !== "boolean") throw new SettingsError(`${label} must be true or false.`);
  return value;
}

function enumText(value, label, allowed, fallback) {
  const result = String(value ?? fallback).trim();
  if (!allowed.includes(result)) throw new SettingsError(`${label} must be one of ${allowed.join(", ")}.`);
  return result;
}

function text(value, label, { max = 500, allowEmpty = true } = {}) {
  const result = String(value ?? "").trim();
  if (!allowEmpty && !result) throw new SettingsError(`${label} cannot be empty.`);
  if (result.length > max) throw new SettingsError(`${label} must be at most ${max} characters.`);
  return result;
}

export class SettingsStore {
  constructor({ file, defaults, logger = console }) {
    this.file = path.resolve(file);
    this.logger = logger;
    this.defaults = JSON.parse(JSON.stringify(defaults));
    this.values = JSON.parse(JSON.stringify(defaults));
    this.closed = false;
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
        fs.chmodSync(this.file, 0o600);
      } catch (error) {
        throw new Error(`无法读取设置文件 ${this.file}: ${error.message}`);
      }
      if (parsed?.version !== VERSION || !parsed.values || typeof parsed.values !== "object") {
        throw new Error(`设置文件格式不正确: ${this.file}`);
      }
      this.values = this.merge(parsed.values);
    } else {
      this.persist();
    }
    return this;
  }

  merge(raw) {
    const defaults = this.defaults;
    return {
      queue: {
        waitTimeoutMs: int(raw.queue?.waitTimeoutMs ?? defaults.queue.waitTimeoutMs, "queue.waitTimeoutMs", 100, 86_400_000),
        responseTimeoutMs: int(raw.queue?.responseTimeoutMs ?? defaults.queue.responseTimeoutMs, "queue.responseTimeoutMs", 100, 86_400_000),
        retentionMs: int(raw.queue?.retentionMs ?? defaults.queue.retentionMs, "queue.retentionMs", 10_000, 86_400_000),
        streamDelayMs: int(raw.queue?.streamDelayMs ?? defaults.queue.streamDelayMs, "queue.streamDelayMs", 0, 60_000),
      },
      limits: {
        maxConcurrentPerKey: int(raw.limits?.maxConcurrentPerKey ?? defaults.limits.maxConcurrentPerKey, "limits.maxConcurrentPerKey", 1, 1_000),
        bodyLimitBytes: int(raw.limits?.bodyLimitBytes ?? defaults.limits.bodyLimitBytes, "limits.bodyLimitBytes", 1_024, 64 * 1024 * 1024),
      },
      features: {
        auditLog: bool(raw.features?.auditLog ?? defaults.features.auditLog, "features.auditLog"),
        usageDashboard: bool(raw.features?.usageDashboard ?? defaults.features.usageDashboard, "features.usageDashboard"),
        publicGuide: bool(raw.features?.publicGuide ?? defaults.features.publicGuide, "features.publicGuide"),
      },
      aiAssist: {
        enabled: bool(raw.aiAssist?.enabled ?? defaults.aiAssist.enabled, "aiAssist.enabled"),
        endpoint: text(raw.aiAssist?.endpoint ?? defaults.aiAssist.endpoint, "aiAssist.endpoint", { max: 500 }),
        model: text(raw.aiAssist?.model ?? defaults.aiAssist.model, "aiAssist.model", { max: 200 }),
        timeoutMs: int(raw.aiAssist?.timeoutMs ?? defaults.aiAssist.timeoutMs, "aiAssist.timeoutMs", 3_000, 120_000),
        maxInputChars: int(raw.aiAssist?.maxInputChars ?? defaults.aiAssist.maxInputChars, "aiAssist.maxInputChars", 1_000, 50_000),
        maxOutputChars: int(raw.aiAssist?.maxOutputChars ?? defaults.aiAssist.maxOutputChars, "aiAssist.maxOutputChars", 128, 16_000),
        dailyRequestsPerOperator: int(raw.aiAssist?.dailyRequestsPerOperator ?? defaults.aiAssist.dailyRequestsPerOperator, "aiAssist.dailyRequestsPerOperator", 0, 10_000),
        dailyTokensPerOperator: int(raw.aiAssist?.dailyTokensPerOperator ?? defaults.aiAssist.dailyTokensPerOperator, "aiAssist.dailyTokensPerOperator", 0, 20_000_000),
        dailyRequestsTotal: int(raw.aiAssist?.dailyRequestsTotal ?? defaults.aiAssist.dailyRequestsTotal, "aiAssist.dailyRequestsTotal", 0, 100_000),
        maxConcurrent: int(raw.aiAssist?.maxConcurrent ?? defaults.aiAssist.maxConcurrent, "aiAssist.maxConcurrent", 1, 16),
        autoReplyOnReceive: bool(raw.aiAssist?.autoReplyOnReceive ?? defaults.aiAssist.autoReplyOnReceive, "aiAssist.autoReplyOnReceive"),
        autoClaimEnabled: bool(raw.aiAssist?.autoClaimEnabled ?? defaults.aiAssist.autoClaimEnabled, "aiAssist.autoClaimEnabled"),
        autoReplyAfterSeconds: int(raw.aiAssist?.autoReplyAfterSeconds ?? defaults.aiAssist.autoReplyAfterSeconds, "aiAssist.autoReplyAfterSeconds", 0, 86_400),
      },
    };
  }

  get() {
    return JSON.parse(JSON.stringify(this.values));
  }

  update(patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new SettingsError("settings payload must be an object.");
    }
    for (const section of ["queue", "limits", "features", "aiAssist"]) {
      if (patch[section] !== undefined && (!patch[section] || typeof patch[section] !== "object" || Array.isArray(patch[section]))) {
        throw new SettingsError(`settings.${section} must be an object.`);
      }
    }
    const merged = {
      queue: { ...this.values.queue, ...(patch.queue || {}) },
      limits: { ...this.values.limits, ...(patch.limits || {}) },
      features: { ...this.values.features, ...(patch.features || {}) },
      aiAssist: { ...this.values.aiAssist, ...(patch.aiAssist || {}) },
    };
    const next = this.merge(merged);
    this.values.queue = next.queue;
    this.values.limits = next.limits;
    this.values.features = next.features;
    this.values.aiAssist = next.aiAssist;
    this.persist();
    return this.get();
  }

  persist() {
    const temp = path.join(
      path.dirname(this.file),
      `.settings.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`,
    );
    fs.writeFileSync(temp, `${JSON.stringify({ version: VERSION, values: this.values }, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  close() {
    this.closed = true;
  }
}
