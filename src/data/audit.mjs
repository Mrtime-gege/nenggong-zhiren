/** Append-only JSONL audit trail for administrative and authentication events. */

import fs from "node:fs";
import path from "node:path";

const MAX_RETURN = 5000;

export class AuditStore {
  constructor({ file, logger = console, enabled = () => true, now = Date.now } = {}) {
    this.file = path.resolve(file);
    this.logger = logger;
    this.enabled = enabled;
    this.now = now;
    this.ready = false;
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, "", { mode: 0o600 });
    }
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* non-POSIX */
    }
    this.ready = true;
    return this;
  }

  append({ actor = "system", action, target = "", ip = "", detail = "" }) {
    if (!this.enabled()) return;
    if (!this.ready || !action) return;
    const record = {
      at: new Date(this.now()).toISOString(),
      actor: String(actor).slice(0, 64),
      action: String(action).slice(0, 80),
      target: String(target).slice(0, 160),
      ip: String(ip).slice(0, 80),
      detail: String(detail).slice(0, 500),
    };
    try {
      fs.appendFileSync(this.file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    } catch (error) {
      this.logger.error?.(`[audit] append failed: ${error.message}`);
    }
  }

  list({ limit = 200, action = "", actor = "" } = {}) {
    if (!fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, "utf8").split(/\r?\n/).filter(Boolean).slice(-2000);
    const out = [];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const record = JSON.parse(lines[index]);
        if (action && record.action !== action) continue;
        if (actor && record.actor !== actor) continue;
        out.push(record);
        if (out.length >= Math.min(Number(limit) || 200, MAX_RETURN)) break;
      } catch {
        /* skip a corrupt line */
      }
    }
    return out;
  }
}
