/** Local write-only secrets used for outbound integrations (currently the AI API key). */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const VERSION = 1;
const MAX_VALUE = 8192;

export class SecretStore {
  constructor({ file, logger = console } = {}) {
    if (!file) throw new Error("SecretStore needs a file path");
    this.file = path.resolve(file);
    this.logger = logger;
    this.values = {};
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.load();
    return this;
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.values = {};
      this.persist();
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      fs.chmodSync(this.file, 0o600);
      if (parsed?.version !== VERSION || !parsed.secrets || typeof parsed.secrets !== "object") {
        throw new Error("invalid format");
      }
      this.values = {};
      for (const [key, value] of Object.entries(parsed.secrets)) {
        if (typeof value === "string" && value && value.length <= MAX_VALUE) this.values[key] = value;
      }
    } catch (error) {
      throw new Error(`无法读取密钥文件 ${this.file}: ${error.message}`);
    }
  }

  persist() {
    const temp = path.join(
      path.dirname(this.file),
      `.secrets.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`,
    );
    fs.writeFileSync(temp, `${JSON.stringify({ version: VERSION, secrets: this.values }, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  get(name) {
    return this.values[name] || "";
  }

  has(name) {
    return Boolean(this.values[name]);
  }

  hint(name) {
    const value = this.get(name);
    if (!value) return "";
    return value.length <= 8 ? "••••" : `${value.slice(0, 2)}…${value.slice(-4)}`;
  }

  set(name, value) {
    const text = String(value ?? "").trim();
    if (!text) throw new Error("secret cannot be empty");
    if (text.length > MAX_VALUE) throw new Error("secret is too long");
    this.values[name] = text;
    this.persist();
  }

  clear(name) {
    if (this.values[name] === undefined) return;
    delete this.values[name];
    this.persist();
  }
}
