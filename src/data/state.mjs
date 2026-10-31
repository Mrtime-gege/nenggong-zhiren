/**
 * Durable snapshot of completed tickets and idempotency records.
 *
 * A live HTTP connection cannot survive a process restart. In-flight tickets
 * are therefore retained as "failed/interrupted" for the operator history and
 * completed idempotency records can still be replayed on the new process.
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  DatabaseSync = null;
}

const FILE_VERSION = 1;
const MAX_TICKETS = 1000;
const MAX_IDEMPOTENCY = 1000;
const ACTIVE_STATES = new Set(["queued", "claimed", "streaming", "finishing"]);

function ticketSnapshot(ticket) {
  return {
    id: ticket.id,
    protocol: ticket.protocol,
    model: ticket.model,
    stream: Boolean(ticket.stream),
    includeUsage: Boolean(ticket.includeUsage),
    createdAt: Number(ticket.created) || 0,
    createdSec: Number(ticket.createdSec) || 0,
    messages: ticket.messages || [],
    attachments: ticket.attachments || [],
    callerKey: ticket.callerKey,
    callerLabel: ticket.callerLabel,
    sessionId: ticket.sessionId || null,
    sessionTurn: ticket.sessionTurn || 1,
    sessionPreferredOperator: ticket.sessionPreferredOperator || null,
    sessionStartedAt: ticket.sessionStartedAt || null,
    sessionLastAt: ticket.sessionLastAt || null,
    sessionAnchor: ticket.sessionAnchor || null,
    promptTokens: ticket.promptTokens,
    maxTokens: ticket.maxTokens,
    stops: ticket.stops || [],
    tools: ticket.tools || [],
    toolChoice: ticket.toolChoice,
    parallelToolCalls: ticket.parallelToolCalls !== false,
    toolCalls: ticket.toolCalls || [],
    responseFormat: ticket.responseFormat,
    tags: ticket.tags || [],
    priority: Number.isInteger(ticket.priority) ? ticket.priority : 1,
    notes: ticket.notes || [],
    reasoning: ticket.reasoning || "",
    refusal: ticket.refusal || null,
    clientUser: ticket.clientUser,
    state: ticket.state,
    headersSent: Boolean(ticket.headersSent),
    delivered: ticket.delivered || 0,
    reasoningDelivered: ticket.reasoningDelivered || 0,
    idempotencyKey: ticket.idempotencyKey || null,
    detached: Boolean(ticket.detached),
    claimedBy: ticket.claimedBy || null,
    claimedAt: ticket.claimedAt || null,
    finishedAt: ticket.finishedAt || null,
    text: ticket.text || "",
    finishReason: ticket.finishReason || null,
    usage: ticket.usage || null,
    sseLog: Array.isArray(ticket.sseLog) ? ticket.sseLog.slice(-2000) : [],
    anthLog: Array.isArray(ticket.anthLog) ? ticket.anthLog.slice(-2000) : [],
  };
}

export class StateStore {
  constructor({ file, dbFile, backend = "sqlite", logger = console, saveDelayMs = 1000 } = {}) {
    if (!file) throw new Error("StateStore needs a file path");
    this.file = path.resolve(file);
    this.dbFile = path.resolve(dbFile || `${this.file}.db`);
    this.backend = ["sqlite", "json"].includes(backend) ? backend : "sqlite";
    this.journalFile = `${this.file}.journal`;
    this.logger = logger;
    this.saveDelayMs = saveDelayMs;
    this.compactDelayMs = 15_000;
    this.snapshotCache = new Map();
    this.journalDirty = false;
    this.tickets = [];
    this.idempotency = [];
    this.timer = null;
    this.closed = false;
    this.loaded = false;
    this.sqlite = false;
    this.db = null;
    this.idempotencyCache = new Map();
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.mkdirSync(path.dirname(this.dbFile), { recursive: true });
    if (this.backend !== "json" && DatabaseSync) {
      try {
        this.initSqlite();
        return this;
      } catch (error) {
        this.logger.error?.(`[state] sqlite init failed, falling back to json: ${error.message}`);
        try { this.db?.close(); } catch { /* best effort */ }
        this.db = null;
        this.sqlite = false;
        this.tickets = [];
        this.idempotency = [];
      }
    }
    this.load();
    this.applyJournal();
    return this;
  }

  initSqlite() {
    this.db = new DatabaseSync(this.dbFile);
    try { fs.chmodSync(this.dbFile, 0o600); } catch { /* best effort */ }
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        ticket_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tickets_created_idx ON tickets(created_at DESC);
      CREATE TABLE IF NOT EXISTS idempotency (
        key TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        ticket_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idempotency_created_idx ON idempotency(created_at DESC);
    `);
    const ticketRows = this.db.prepare("SELECT ticket_json FROM tickets ORDER BY created_at DESC").all();
    this.tickets = ticketRows.map((row) => JSON.parse(row.ticket_json)).filter((item) => item && item.id);
    const idempotencyRows = this.db.prepare("SELECT ticket_json FROM idempotency ORDER BY created_at DESC").all();
    this.idempotency = idempotencyRows.map((row) => JSON.parse(row.ticket_json)).filter((item) => item && item.key && item.ticketId);
    if (!this.tickets.length && fs.existsSync(this.file)) {
      this.load();
      this.applyJournal();
      this.persistSqliteAll();
    }
    this.snapshotCache = new Map(this.tickets.map((ticket) => [ticket.id, JSON.stringify(ticket)]));
    this.idempotencyCache = new Map(this.idempotency.map((item) => [item.key, JSON.stringify(item)]));
    this.sqlite = true;
    this.loaded = true;
  }

  persistSqliteAll() {
    if (!this.db) return;
    const upsertTicket = this.db.prepare(`
      INSERT INTO tickets (id, created_at, ticket_json) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, ticket_json=excluded.ticket_json
    `);
    const upsertIdempotency = this.db.prepare(`
      INSERT INTO idempotency (key, created_at, ticket_json) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET created_at=excluded.created_at, ticket_json=excluded.ticket_json
    `);
    this.db.exec("BEGIN");
    try {
      for (const ticket of this.tickets) upsertTicket.run(ticket.id, Number(ticket.createdAt) || 0, JSON.stringify(ticket));
      for (const item of this.idempotency) upsertIdempotency.run(item.key, Number(item.createdAt) || 0, JSON.stringify(item));
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw error;
    }
  }

  writeSqliteTickets(changed) {
    if (!this.db || !changed.length) return;
    const upsert = this.db.prepare(`
      INSERT INTO tickets (id, created_at, ticket_json) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, ticket_json=excluded.ticket_json
    `);
    this.db.exec("BEGIN");
    try {
      for (const ticket of changed) upsert.run(ticket.id, Number(ticket.createdAt) || 0, JSON.stringify(ticket));
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw error;
    }
  }

  writeSqliteIdempotency() {
    if (!this.db) return;
    const upsert = this.db.prepare(`
      INSERT INTO idempotency (key, created_at, ticket_json) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET created_at=excluded.created_at, ticket_json=excluded.ticket_json
    `);
    const remove = this.db.prepare("DELETE FROM idempotency WHERE key = ?");
    const next = new Map();
    this.db.exec("BEGIN");
    try {
      for (const item of this.idempotency) {
        const serialized = JSON.stringify(item);
        next.set(item.key, serialized);
        if (this.idempotencyCache.get(item.key) !== serialized) {
          upsert.run(item.key, Number(item.createdAt) || 0, serialized);
        }
      }
      for (const key of this.idempotencyCache.keys()) {
        if (!next.has(key)) remove.run(key);
      }
      this.db.exec("COMMIT");
      this.idempotencyCache = next;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* ignore */ }
      this.logger.error?.(`[state] sqlite idempotency failed: ${error.message}`);
    }
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.persist();
      this.loaded = true;
      return { tickets: [], idempotency: [] };
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      fs.chmodSync(this.file, 0o600);
    } catch (error) {
      throw new Error(`无法读取运行状态文件 ${this.file}: ${error.message}`);
    }
    if (!parsed || parsed.version !== FILE_VERSION) {
      throw new Error(`运行状态文件格式不正确: ${this.file}`);
    }
    this.tickets = Array.isArray(parsed.tickets) ? parsed.tickets.filter((item) => item && item.id) : [];
    this.idempotency = Array.isArray(parsed.idempotency)
      ? parsed.idempotency.filter((item) => item && item.key && item.ticketId)
      : [];
    this.loaded = true;
    return { tickets: this.tickets, idempotency: this.idempotency };
  }

  applyJournal() {
    if (!fs.existsSync(this.journalFile)) return;
    let raw = "";
    try {
      raw = fs.readFileSync(this.journalFile, "utf8");
      fs.chmodSync(this.journalFile, 0o600);
    } catch {
      return;
    }
    const byId = new Map(this.tickets.map((ticket) => [ticket.id, ticket]));
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event?.ticket?.id) byId.set(event.ticket.id, event.ticket);
      } catch {
        /* partially written tail after a crash: ignore */
      }
    }
    this.tickets = [...byId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, MAX_TICKETS);
    this.snapshotCache = new Map(this.tickets.map((ticket) => [ticket.id, JSON.stringify(ticket)]));
  }

  restoreTickets(now = Date.now()) {
    const recovered = [];
    for (const raw of this.tickets) {
      const active = ACTIVE_STATES.has(raw.state);
      let resolveDone = () => {};
      const donePromise = active
        ? new Promise((resolve) => { resolveDone = resolve; })
        : Promise.resolve();
      const ticket = {
        ...raw,
        created: Number(raw.createdAt) || Number(raw.created) || Date.now(),
        createdSec: Number(raw.createdSec) || Math.floor((Number(raw.createdAt) || Date.now()) / 1000),
        finished: !active,
        finishedAt: active ? null : raw.finishedAt || now,
        state: active ? raw.state : raw.state || "done",
        finishReason: active ? null : raw.finishReason || null,
        clientGone: active,
        detached: active,
        res: null,
        donePromise,
        resolveDone,
        ready: false,
        restored: true,
        text: raw.text || "",
        toolCalls: raw.toolCalls || [],
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        priority: Number.isInteger(raw.priority) ? raw.priority : 1,
        notes: Array.isArray(raw.notes) ? raw.notes : [],
        sseLog: raw.sseLog || [],
        anthLog: raw.anthLog || [],
        usage: raw.usage || null,
        headersSent: raw.headersSent === true,
        delivered: Number(raw.delivered) || 0,
        reasoning: raw.reasoning || "",
        reasoningDelivered: Number(raw.reasoningDelivered) || 0,
        heartbeat: null,
        timers: {},
        sendChain: Promise.resolve(),
        releaseSlot: null,
      };
      recovered.push(ticket);
    }
    return recovered;
  }

  snapshot(tickets, idempotency) {
    const nextTickets = [...tickets]
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
      .slice(0, MAX_TICKETS)
      .map(ticketSnapshot);
    const changed = [];
    for (const ticket of nextTickets) {
      const serialized = JSON.stringify(ticket);
      if (this.snapshotCache.get(ticket.id) !== serialized) {
        this.snapshotCache.set(ticket.id, serialized);
        changed.push(ticket);
      }
    }
    this.tickets = nextTickets;
    this.idempotency = [...idempotency]
      .map((item) => (Array.isArray(item) ? { key: item[0], ...item[1] } : item))
      .filter((item) => item && item.key && item.ticketId)
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
      .slice(0, MAX_IDEMPOTENCY);
    if (this.sqlite) {
      try {
        this.writeSqliteTickets(changed);
        this.writeSqliteIdempotency();
      } catch (error) {
        this.logger.error?.(`[state] sqlite write failed: ${error.message}`);
      }
      return;
    }
    if (changed.length) {
      try {
        fs.appendFileSync(
          this.journalFile,
          changed.map((ticket) => JSON.stringify({ ticket })).join("\n") + "\n",
          { mode: 0o600 },
        );
        fs.chmodSync(this.journalFile, 0o600);
        this.journalDirty = true;
      } catch (error) {
        this.logger.error?.(`[state] journal failed: ${error.message}`);
      }
    }
    this.schedule();
  }

  schedule() {
    if (this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.persist();
      } catch (error) {
        this.logger.error?.(`[state] persist failed: ${error.message}`);
      }
    }, this.compactDelayMs);
    this.timer.unref?.();
  }

  persist() {
    if (this.sqlite) return;
    const payload = {
      version: FILE_VERSION,
      savedAt: new Date().toISOString(),
      tickets: this.tickets,
      idempotency: this.idempotency,
    };
    const temp = path.join(
      path.dirname(this.file),
      `.state.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`,
    );
    fs.writeFileSync(temp, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
    try {
      fs.writeFileSync(this.journalFile, "", { mode: 0o600 });
      fs.chmodSync(this.journalFile, 0o600);
      this.journalDirty = false;
    } catch { /* journal can be replayed or safely recreated */ }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.sqlite) return;
    this.persist();
  }

  close() {
    if (this.sqlite) {
      try { this.db?.close(); } catch { /* best effort */ }
      this.db = null;
      this.sqlite = false;
      this.closed = true;
      return;
    }
    this.flush();
    this.closed = true;
  }
}
