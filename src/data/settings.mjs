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
        streamDelayMs: int(raw.queue?.streamDelayMs ?? defaults.queue.streamDelayMs, "queue.streamDelayMs", 0, 5_000),
      },
      limits: {
        maxConcurrentPerKey: int(raw.limits?.maxConcurrentPerKey ?? defaults.limits.maxConcurrentPerKey, "limits.maxConcurrentPerKey", 1, 1_000),
        bodyLimitBytes: int(raw.limits?.bodyLimitBytes ?? defaults.limits.bodyLimitBytes, "limits.bodyLimitBytes", 1_024, 64 * 1024 * 1024),
      },
      features: {
        browserNotifications: bool(raw.features?.browserNotifications ?? defaults.features.browserNotifications, "features.browserNotifications"),
        notificationSound: bool(raw.features?.notificationSound ?? defaults.features.notificationSound, "features.notificationSound"),
        autoClaimDefault: bool(raw.features?.autoClaimDefault ?? defaults.features.autoClaimDefault, "features.autoClaimDefault"),
        auditLog: bool(raw.features?.auditLog ?? defaults.features.auditLog, "features.auditLog"),
        usageDashboard: bool(raw.features?.usageDashboard ?? defaults.features.usageDashboard, "features.usageDashboard"),
        queueAlertSeconds: int(raw.features?.queueAlertSeconds ?? defaults.features.queueAlertSeconds, "features.queueAlertSeconds", 10, 86_400),
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
    for (const section of ["queue", "limits", "features"]) {
      if (patch[section] !== undefined && (!patch[section] || typeof patch[section] !== "object" || Array.isArray(patch[section]))) {
        throw new SettingsError(`settings.${section} must be an object.`);
      }
    }
    const merged = {
      queue: { ...this.values.queue, ...(patch.queue || {}) },
      limits: { ...this.values.limits, ...(patch.limits || {}) },
      features: { ...this.values.features, ...(patch.features || {}) },
    };
    const next = this.merge(merged);
    this.values.queue = next.queue;
    this.values.limits = next.limits;
    this.values.features = next.features;
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
