/** Persistent request/token usage counters used by per-key quotas. */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const FILE_VERSION = 1;

export class QuotaError extends Error {
  constructor(message, { code = "quota_exceeded", retryAfterMs = 0 } = {}) {
    super(message);
    this.name = "QuotaError";
    this.status = 429;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function utcMonth(now) {
  return new Date(now).toISOString().slice(0, 7);
}

function blank(keyId) {
  return {
    keyId,
    minute: "",
    minuteCount: 0,
    day: "",
    dayCount: 0,
    month: "",
    monthCount: 0,
    totalRequests: 0,
    totalTokens: 0,
  };
}

function publicUsage(entry) {
  if (!entry) return null;
  return {
    minute: entry.minuteCount,
    day: entry.dayCount,
    month: entry.monthCount,
    totalRequests: entry.totalRequests,
    totalTokens: entry.totalTokens,
  };
}

export class UsageStore {
  constructor({ file, logger = console, now = Date.now, flushMs = 2_000 } = {}) {
    if (!file) throw new Error("UsageStore needs a file path");
    this.file = path.resolve(file);
    this.logger = logger;
    this.now = now;
    this.flushMs = flushMs;
    this.entries = new Map();
    this.dirty = false;
    this.timer = null;
    this.closed = false;
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.load();
    return this;
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.entries = new Map();
      this.persist();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      fs.chmodSync(this.file, 0o600);
    } catch (error) {
      throw new Error(`无法读取用量文件 ${this.file}: ${error.message}`);
    }
    if (!parsed || parsed.version !== FILE_VERSION || !Array.isArray(parsed.keys)) {
      throw new Error(`用量文件格式不正确: ${this.file}`);
    }
    this.entries = new Map();
    for (const raw of parsed.keys) {
      if (!raw || typeof raw.id !== "string") continue;
      this.entries.set(raw.id, {
        keyId: raw.id,
        minute: typeof raw.minute === "string" ? raw.minute : "",
        minuteCount: Number(raw.minuteCount) || 0,
        day: typeof raw.day === "string" ? raw.day : "",
        dayCount: Number(raw.dayCount) || 0,
        month: typeof raw.month === "string" ? raw.month : "",
        monthCount: Number(raw.monthCount) || 0,
        totalRequests: Number(raw.totalRequests) || 0,
        totalTokens: Number(raw.totalTokens) || 0,
      });
    }
  }

  persist() {
    this.dirty = false;
    const payload = {
      version: FILE_VERSION,
      keys: [...this.entries.values()].map((entry) => ({
        id: entry.keyId,
        minute: entry.minute,
        minuteCount: entry.minuteCount,
        day: entry.day,
        dayCount: entry.dayCount,
        month: entry.month,
        monthCount: entry.monthCount,
        totalRequests: entry.totalRequests,
        totalTokens: entry.totalTokens,
      })),
    };
    const temp = path.join(
      path.dirname(this.file),
      `.usage.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`,
    );
    fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  schedule() {
    if (this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.dirty) {
        try {
          this.persist();
        } catch (error) {
          this.logger.error?.(`[usage] persist failed: ${error.message}`);
        }
      }
    }, this.flushMs);
    this.timer.unref?.();
  }

  /**
   * Consume one request. `limits` uses 0/undefined for unlimited.
   */
  consume(keyId, limits = {}) {
    const now = this.now();
    const minute = new Date(now).toISOString().slice(0, 16);
    const day = utcDay(now);
    const month = utcMonth(now);
    const entry = this.entries.get(keyId) || blank(keyId);
    if (entry.minute !== minute) {
      entry.minute = minute;
      entry.minuteCount = 0;
    }
    if (entry.day !== day) {
      entry.day = day;
      entry.dayCount = 0;
    }
    if (entry.month !== month) {
      entry.month = month;
      entry.monthCount = 0;
    }

    const rpm = Number(limits.requestsPerMinute) || 0;
    const perDay = Number(limits.requestsPerDay) || 0;
    const perMonth = Number(limits.requestsPerMonth) || 0;
    if (rpm > 0 && entry.minuteCount >= rpm) {
      const nextMinute = (Math.floor(now / 60_000) + 1) * 60_000;
      throw new QuotaError("每分钟请求配额已用完，请稍后重试。", {
        code: "rate_limit_per_minute",
        retryAfterMs: nextMinute - now,
      });
    }
    if (perDay > 0 && entry.dayCount >= perDay) {
      throw new QuotaError("今天的请求配额已用完。", {
        code: "quota_per_day",
        retryAfterMs: 60_000,
      });
    }
    if (perMonth > 0 && entry.monthCount >= perMonth) {
      throw new QuotaError("本月的请求配额已用完。", {
        code: "quota_per_month",
        retryAfterMs: 60_000,
      });
    }

    entry.minuteCount += 1;
    entry.dayCount += 1;
    entry.monthCount += 1;
    entry.totalRequests += 1;
    this.entries.set(keyId, entry);
    this.dirty = true;
    this.schedule();
    return publicUsage(entry);
  }

  addTokens(keyId, tokens) {
    const count = Math.max(0, Number(tokens) || 0);
    if (!count) return;
    const entry = this.entries.get(keyId) || blank(keyId);
    entry.totalTokens += count;
    this.entries.set(keyId, entry);
    this.dirty = true;
    this.schedule();
  }

  get(keyId) {
    return publicUsage(this.entries.get(keyId));
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.dirty) {
      try {
        this.persist();
      } catch (error) {
        this.logger.error?.(`[usage] final persist failed: ${error.message}`);
      }
    }
    this.closed = true;
  }
}
