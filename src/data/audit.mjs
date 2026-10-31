/** Append-only JSONL audit trail for administrative and authentication events. */

import fs from "node:fs";
import path from "node:path";

const MAX_RETURN = 5000;

export class AuditStore {
  constructor({ file, logger = console, enabled = () => true, now = Date.now, maxBytes = 10 * 1024 * 1024, keepFiles = 5 } = {}) {
    this.file = path.resolve(file);
    this.logger = logger;
    this.enabled = enabled;
    this.now = now;
    this.maxBytes = Math.max(1024 * 1024, Number(maxBytes) || 0);
    this.keepFiles = Math.max(1, Math.min(20, Number(keepFiles) || 1));
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
    this.rotateIfNeeded();
    return this;
  }

  rotateIfNeeded(force = false) {
    if (!this.ready) return;
    let size = 0;
    try { size = fs.statSync(this.file).size; } catch { return; }
    if (!force && size <= this.maxBytes) return;
    try {
      for (let index = this.keepFiles - 1; index >= 1; index -= 1) {
        const source = `${this.file}.${index}`;
        const destination = `${this.file}.${index + 1}`;
        if (fs.existsSync(source)) {
          if (index === this.keepFiles - 1) fs.rmSync(destination, { force: true });
          fs.renameSync(source, destination);
        }
      }
      fs.renameSync(this.file, `${this.file}.1`);
      fs.writeFileSync(this.file, "", { mode: 0o600 });
      fs.chmodSync(this.file, 0o600);
    } catch (error) {
      this.logger.error?.(`[audit] rotation failed: ${error.message}`);
    }
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
      this.rotateIfNeeded();
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
