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

const FILE_VERSION = 1;
const MAX_TICKETS = 300;
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
    promptTokens: ticket.promptTokens,
    maxTokens: ticket.maxTokens,
    stops: ticket.stops || [],
    tools: ticket.tools || [],
    toolChoice: ticket.toolChoice,
    parallelToolCalls: ticket.parallelToolCalls !== false,
    toolCalls: ticket.toolCalls || [],
    responseFormat: ticket.responseFormat,
    reasoning: ticket.reasoning || "",
    refusal: ticket.refusal || null,
    clientUser: ticket.clientUser,
    state: ticket.state,
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
  constructor({ file, logger = console, saveDelayMs = 200 } = {}) {
    if (!file) throw new Error("StateStore needs a file path");
    this.file = path.resolve(file);
    this.logger = logger;
    this.saveDelayMs = saveDelayMs;
    this.tickets = [];
    this.idempotency = [];
    this.timer = null;
    this.closed = false;
    this.loaded = false;
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.load();
    return this;
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

  restoreTickets(now = Date.now()) {
    const recovered = [];
    for (const raw of this.tickets) {
      const active = ACTIVE_STATES.has(raw.state);
      const ticket = {
        ...raw,
        created: Number(raw.createdAt) || Number(raw.created) || Date.now(),
        createdSec: Number(raw.createdSec) || Math.floor((Number(raw.createdAt) || Date.now()) / 1000),
        finished: !active,
        finishedAt: active ? now : raw.finishedAt || now,
        state: active ? "failed" : raw.state || "done",
        finishReason: active ? "server_restarted" : raw.finishReason || null,
        clientGone: true,
        res: null,
        donePromise: Promise.resolve(),
        resolveDone: () => {},
        ready: false,
        restored: true,
        text: raw.text || "",
        toolCalls: raw.toolCalls || [],
        sseLog: raw.sseLog || [],
        anthLog: raw.anthLog || [],
        usage: raw.usage || null,
      };
      recovered.push(ticket);
    }
    return recovered;
  }

  snapshot(tickets, idempotency) {
    this.tickets = [...tickets]
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
      .slice(0, MAX_TICKETS)
      .map(ticketSnapshot);
    this.idempotency = [...idempotency]
      .map((item) => (Array.isArray(item) ? { key: item[0], ...item[1] } : item))
      .filter((item) => item && item.key && item.ticketId)
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
      .slice(0, MAX_IDEMPOTENCY);
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
    }, this.saveDelayMs);
    this.timer.unref?.();
  }

  persist() {
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
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.persist();
  }

  close() {
    this.flush();
    this.closed = true;
  }
}
