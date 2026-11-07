/** Per-operator and global daily AI suggestion accounting. Counts only; no prompts or replies. */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const VERSION = 1;
const DAY_MS = 86_400_000;

function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function emptyDay() {
  return { requests: 0, tokens: 0 };
}

export class AiUsageStore {
  constructor({ file, now = Date.now, logger = console } = {}) {
    if (!file) throw new Error("AiUsageStore needs a file path");
    this.file = path.resolve(file);
    this.now = now;
    this.logger = logger;
    this.day = "";
    this.total = emptyDay();
    this.operators = {};
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.load();
    return this;
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.resetDay();
      this.persist();
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      fs.chmodSync(this.file, 0o600);
      if (parsed?.version !== VERSION) throw new Error("invalid format");
      this.day = typeof parsed.day === "string" ? parsed.day : "";
      this.total = { requests: Math.max(0, Number(parsed.total?.requests) || 0), tokens: Math.max(0, Number(parsed.total?.tokens) || 0) };
      this.operators = {};
      for (const [username, value] of Object.entries(parsed.operators || {})) {
        if (!value || typeof value !== "object") continue;
        this.operators[username] = {
          requests: Math.max(0, Number(value.requests) || 0),
          tokens: Math.max(0, Number(value.tokens) || 0),
        };
      }
      this.resetIfNeeded();
    } catch (error) {
      throw new Error(`无法读取 AI 用量文件 ${this.file}: ${error.message}`);
    }
  }

  resetIfNeeded() {
    const today = utcDay(this.now());
    if (this.day !== today) this.resetDay();
  }

  resetDay() {
    this.day = utcDay(this.now());
    this.total = emptyDay();
    this.operators = {};
  }

  entry(username) {
    this.resetIfNeeded();
    if (!this.operators[username]) this.operators[username] = emptyDay();
    return this.operators[username];
  }

  addRequest(username) {
    const entry = this.entry(username);
    entry.requests += 1;
    this.total.requests += 1;
    this.persist();
  }

  addTokens(username, tokens) {
    const count = Math.max(0, Number(tokens) || 0);
    if (!count) return;
    const entry = this.entry(username);
    entry.tokens += count;
    this.total.tokens += count;
    this.persist();
  }

  persist() {
    const temp = path.join(
      path.dirname(this.file),
      `.ai-usage.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`,
    );
    fs.writeFileSync(temp, `${JSON.stringify({ version: VERSION, day: this.day, total: this.total, operators: this.operators }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
  }
}
