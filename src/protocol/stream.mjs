/** Anthropic Messages streaming event encoder. */

import { anthropicStopReason, anthropicToolBlocks, anthropicUsage } from "./anthropic.mjs";

function writeEvent(ticket, type, payload) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  if (!ticket.anthLog) ticket.anthLog = [];
  ticket.anthLog.push(frame);
  if (!ticket.res || ticket.res.writableEnded || ticket.res.destroyed) return false;
  try {
    return ticket.res.write(frame);
  } catch {
    return false;
  }
}

function nextIndex(ticket) {
  const index = ticket.anthBlockIndex || 0;
  ticket.anthBlockIndex = index + 1;
  return index;
}

export function startAnthropicStream(ticket) {
  if (ticket.anthStarted) return;
  ticket.anthStarted = true;
  ticket.anthBlockIndex = 0;
  ticket.anthTextOpen = false;
  ticket.anthClosedBlocks = new Set();
  ticket.anthLog = [];
  writeEvent(ticket, "message_start", {
    type: "message_start",
    message: {
      id: ticket.id,
      type: "message",
      role: "assistant",
      model: ticket.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: ticket.promptTokens, output_tokens: 0 },
    },
  });
}

export function openAnthropicText(ticket) {
  if (ticket.anthTextOpen) return;
  ticket.anthTextIndex = nextIndex(ticket);
  ticket.anthTextOpen = true;
  writeEvent(ticket, "content_block_start", {
    type: "content_block_start",
    index: ticket.anthTextIndex,
    content_block: { type: "text", text: "" },
  });
}

export function closeAnthropicText(ticket) {
  if (!ticket.anthTextOpen) return;
  writeEvent(ticket, "content_block_stop", {
    type: "content_block_stop",
    index: ticket.anthTextIndex,
  });
  ticket.anthTextOpen = false;
}

export function appendAnthropicText(ticket, text) {
  if (!text) return;
  openAnthropicText(ticket);
  writeEvent(ticket, "content_block_delta", {
    type: "content_block_delta",
    index: ticket.anthTextIndex,
    delta: { type: "text_delta", text: String(text) },
  });
}

export function appendAnthropicToolCalls(ticket) {
  const blocks = anthropicToolBlocks(ticket);
  if (!blocks.length) return;
  closeAnthropicText(ticket);
  for (const block of blocks) {
    const index = nextIndex(ticket);
    writeEvent(ticket, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
    });
    const json = JSON.stringify(block.input || {});
    const size = Math.max(16, Math.ceil(json.length / 2));
    for (let offset = 0; offset < json.length; offset += size) {
      writeEvent(ticket, "content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: json.slice(offset, offset + size) },
      });
    }
    writeEvent(ticket, "content_block_stop", { type: "content_block_stop", index });
  }
}

export function finishAnthropicStream(ticket, usage) {
  if (!ticket.anthStarted) startAnthropicStream(ticket);
  if (!ticket.anthTextOpen && !ticket.anthBlockIndex) {
    openAnthropicText(ticket);
  }
  closeAnthropicText(ticket);
  writeEvent(ticket, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: anthropicStopReason(ticket.finishReason), stop_sequence: null },
    usage: { output_tokens: anthropicUsage(usage).output_tokens },
  });
  writeEvent(ticket, "message_stop", { type: "message_stop" });
  return Boolean(ticket.res && !ticket.res.writableEnded);
}
