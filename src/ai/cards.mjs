/** Durable AI result cards attached to a ticket. Content is operator-visible only. */

import { randomUUID } from "node:crypto";

export const MAX_AI_CARDS = 20;

export function aiInputSummary(ticket) {
  const messages = Array.isArray(ticket?.messages) ? ticket.messages : [];
  const chars = messages.reduce((sum, message) => {
    if (typeof message?.content === "string") return sum + message.content.length;
    if (Array.isArray(message?.content)) {
      return sum + message.content.reduce((partSum, part) => partSum + (typeof part?.text === "string" ? part.text.length : 0), 0);
    }
    return sum;
  }, 0);
  return `${messages.length} 条消息 · ${chars} 字符`;
}

export function appendAiCard(ticket, { source, content, reasoning, toolCalls, finishReason, usage, model, instruction, startedAt, finishedAt = Date.now() }) {
  const card = {
    id: `ai_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    source: source || "manual",
    model: model || ticket.model || "",
    content: String(content || ""),
    reasoning: String(reasoning || ""),
    toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
    finishReason: String(finishReason || ""),
    usage: usage || null,
    instruction: String(instruction || "").slice(0, 500),
    inputSummary: aiInputSummary(ticket),
    startedAt: Number(startedAt) || finishedAt,
    finishedAt,
    elapsedMs: Math.max(0, finishedAt - (Number(startedAt) || finishedAt)),
    createdAt: finishedAt,
  };
  const cards = Array.isArray(ticket.aiCards) ? ticket.aiCards : [];
  ticket.aiCards = [...cards, card].slice(-MAX_AI_CARDS);
  return card;
}
