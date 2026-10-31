/** SQLite/FTS5 index for completed ticket history.
 *
 * SQLite is optional so Node builds without node:sqlite can still use the
 * in-memory history path; the server checks `available`.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

function escapeLike(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export class HistoryIndex {
  constructor({ file, logger = console, now = Date.now } = {}) {
    this.file = path.resolve(file);
    this.logger = logger;
    this.now = now;
    this.available = Boolean(DatabaseSync);
    this.db = null;
  }

  init() {
    if (!this.available) return this;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    try { fs.chmodSync(this.file, 0o600); } catch { /* best effort */ }
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        finished_at INTEGER NOT NULL,
        model TEXT NOT NULL,
        state TEXT NOT NULL,
        caller TEXT NOT NULL,
        operator TEXT NOT NULL,
        session_id TEXT NOT NULL,
        search_text TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tickets_finished_idx ON tickets(finished_at DESC);
      CREATE INDEX IF NOT EXISTS tickets_model_idx ON tickets(model);
      CREATE INDEX IF NOT EXISTS tickets_state_idx ON tickets(state);
      CREATE INDEX IF NOT EXISTS tickets_operator_idx ON tickets(operator);
      CREATE INDEX IF NOT EXISTS tickets_session_idx ON tickets(session_id);
    `);
    try {
      this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(id UNINDEXED, search_text, tokenize='trigram')");
    } catch {
      try {
        this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(id UNINDEXED, search_text)");
      } catch (error) {
        this.logger.error?.(`[history] FTS unavailable: ${error.message}`);
        this.available = false;
      }
    }
    return this;
  }

  close() {
    try { this.db?.close(); } catch { /* best effort */ }
    this.db = null;
  }

  sync(records) {
    if (!this.available || !this.db) return;
    const incoming = new Map(records.map((record) => [record.id, record]));
    const existing = new Map(this.db.prepare("SELECT id, fingerprint FROM tickets").all().map((row) => [row.id, row.fingerprint]));
    const insert = this.db.prepare(`
      INSERT INTO tickets (id, finished_at, model, state, caller, operator, session_id, search_text, summary_json, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        finished_at=excluded.finished_at, model=excluded.model, state=excluded.state,
        caller=excluded.caller, operator=excluded.operator, session_id=excluded.session_id,
        search_text=excluded.search_text, summary_json=excluded.summary_json, fingerprint=excluded.fingerprint
    `);
    const deleteFts = this.db.prepare("DELETE FROM tickets_fts WHERE id = ?");
    const insertFts = this.db.prepare("INSERT INTO tickets_fts (id, search_text) VALUES (?, ?)");
    this.db.exec("BEGIN");
    try {
      for (const record of incoming.values()) {
        const fingerprint = createHash("sha256")
          .update(`${record.finishedAt}\0${record.searchText}\0${record.summaryJson}`)
          .digest("hex");
        if (existing.get(record.id) === fingerprint) continue;
        insert.run(
          record.id,
          record.finishedAt,
          record.model,
          record.state,
          record.caller,
          record.operator,
          record.sessionId,
          record.searchText,
          record.summaryJson,
          fingerprint,
        );
        deleteFts.run(record.id);
        insertFts.run(record.id, record.searchText);
      }
      for (const id of existing.keys()) {
        if (incoming.has(id)) continue;
        this.db.prepare("DELETE FROM tickets WHERE id = ?").run(id);
        deleteFts.run(id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* ignore */ }
      this.logger.error?.(`[history] sync failed: ${error.message}`);
    }
  }

  query(filters, { all = false } = {}) {
    if (!this.available || !this.db) return null;
    const where = [];
    const params = [];
    if (filters.model) { where.push("model = ?"); params.push(filters.model); }
    if (filters.state) { where.push("state = ?"); params.push(filters.state); }
    if (filters.operator) { where.push("operator = ?"); params.push(filters.operator); }
    if (filters.caller) { where.push("caller LIKE ? ESCAPE '\\'"); params.push(`%${escapeLike(filters.caller)}%`); }
    if (filters.session) { where.push("session_id = ?"); params.push(filters.session); }
    if (filters.from) { where.push("finished_at >= ?"); params.push(filters.from); }
    if (filters.to) { where.push("finished_at <= ?"); params.push(filters.to); }
    if (filters.q) {
      const like = `%${escapeLike(filters.q)}%`;
      const fts = `"${filters.q.replaceAll('"', '""')}"`;
      where.push("(search_text LIKE ? ESCAPE '\\' OR id IN (SELECT id FROM tickets_fts WHERE tickets_fts MATCH ?))");
      params.push(like, fts);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    try {
      const total = this.db.prepare(`SELECT COUNT(*) AS n FROM tickets ${clause}`).get(...params).n;
      const limit = all ? 5000 : filters.limit;
      const offset = all ? 0 : filters.offset;
      const rows = this.db
        .prepare(`SELECT summary_json FROM tickets ${clause} ORDER BY finished_at DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);
      return {
        total,
        items: rows.map((row) => JSON.parse(row.summary_json)),
        models: this.db.prepare("SELECT DISTINCT model FROM tickets ORDER BY model").all().map((row) => row.model),
        operators: this.db.prepare("SELECT DISTINCT operator FROM tickets WHERE operator <> '' ORDER BY operator").all().map((row) => row.operator),
      };
    } catch (error) {
      this.logger.error?.(`[history] query failed: ${error.message}`);
      return null;
    }
  }
}
