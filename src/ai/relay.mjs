/** Operator-only AI relay: forward the caller request and hold the native reply. */

import { AiAssistError } from "./assist.mjs";

// Some OpenAI-compatible gateways reject requests above 256 messages. Reserve
// one entry so an operator instruction can still be appended after compaction.
const MAX_RELAY_MESSAGES = 256;
const MAX_COMPACTED_MESSAGES = MAX_RELAY_MESSAGES - 1;

export function sanitizeToolAnnotations(value) {
  return String(value || "")
    .replace(/\[tool use:\s*[^\]]+\]/giu, "")
    .replace(/^\s*已调用工具\s*$/gimu, "")
    .replace(/^\s*工具调用\s*$/gimu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function contentForMessage(message) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const images = parts.filter((part) => part.type === "image" && part.url);
  if (!images.length) return sanitizeToolAnnotations(message.content);
  const content = [];
  const text = sanitizeToolAnnotations(message.content);
  if (text) content.push({ type: "text", text });
  for (const image of images.slice(0, 8)) {
    content.push({ type: "image_url", image_url: { url: image.url, detail: image.detail || "auto" } });
  }
  return content;
}

function toolChoice(choice) {
  if (choice === "auto" || choice === "none" || choice === "required") return choice;
  if (choice && typeof choice === "object" && choice.name) {
    return { type: "function", function: { name: choice.name } };
  }
  return undefined;
}

function charSize(value) {
  try { return JSON.stringify(value).length; } catch { return 0; }
}

function selectToolsForBudget(tools, ticket, budget) {
  const all = Array.isArray(tools) ? tools : [];
  if (!all.length) return [];
  if (charSize(all) <= budget) return all;
  const explicitName = ticket.toolChoice && typeof ticket.toolChoice === "object" ? ticket.toolChoice.name : "";
  const recentText = (ticket.messages || []).slice(-8).map((message) => String(message.content || "")).join(" ");
  const ranked = all.map((tool, index) => ({
    tool,
    index,
    priority: tool?.function?.name === explicitName ? 3 : recentText.includes(tool?.function?.name || "") ? 2 : 0,
  })).sort((a, b) => b.priority - a.priority || a.index - b.index);
  const chosen = new Map();
  let used = 0;
  for (const item of ranked) {
    const size = charSize(item.tool) + 1;
    if (used + size > budget) continue;
    chosen.set(item.index, item.tool);
    used += size;
    if (used >= budget) break;
  }
  if (!chosen.size && ranked[0]) chosen.set(ranked[0].index, ranked[0].tool);
  return all.filter((_, index) => chosen.has(index));
}

function truncateMessageForBudget(message, budget) {
  const clone = JSON.parse(JSON.stringify(message));
  if (typeof clone.content === "string") {
    const suffix = "\n[内容因 AI 输入预算被截断]";
    clone.content = `${clone.content.slice(0, Math.max(0, budget - suffix.length))}${suffix}`;
  } else if (Array.isArray(clone.content)) {
    let remaining = Math.max(0, budget - 200);
    for (const part of clone.content) {
      if (part?.type !== "text" || typeof part.text !== "string") continue;
      if (part.text.length <= remaining) {
        remaining -= part.text.length;
        continue;
      }
      part.text = `${part.text.slice(0, Math.max(0, remaining))}\n[内容因 AI 输入预算被截断]`;
      remaining = 0;
    }
  }
  return clone;
}

function compactMessagesForBudget(messages, budget, maxEntries = MAX_COMPACTED_MESSAGES) {
  const list = Array.isArray(messages) ? messages : [];
  const limit = Math.max(1, Math.min(MAX_COMPACTED_MESSAGES, Number(maxEntries) || MAX_COMPACTED_MESSAGES));
  let used = 0;
  const selected = [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (selected.length >= limit) break;
    let entry = list[index];
    let size = charSize(entry);
    if (used + size > budget) {
      if (!selected.length) {
        entry = truncateMessageForBudget(entry, Math.max(256, budget));
        size = charSize(entry);
        selected.unshift(entry);
        used += size;
      }
      break;
    }
    selected.unshift(entry);
    used += size;
  }
  let dropped = list.length - selected.length;
  while (selected.length > 1 && selected[0]?.role === "tool") {
    selected.shift();
    dropped += 1;
  }
  const lastSystem = [...list].reverse().find((message) => message.role === "system");
  if (lastSystem && !selected.includes(lastSystem) && selected.length < limit) {
    const size = charSize(lastSystem);
    if (used + size < budget) {
      selected.unshift(lastSystem);
      used += size;
    }
  }
  if (dropped > 0 && selected.length < limit) {
    const note = { role: "system", content: `[AI 输入预算] 为控制请求长度，已省略 ${dropped} 条较早消息。` };
    if (used + charSize(note) < budget + 300) selected.unshift(note);
  }
  return selected.slice(0, limit);
}

function buildBody(ticket, settings) {
  const maxInputChars = Math.max(1_000, Math.min(50_000, Number(settings.maxInputChars) || 12_000));
  const allTools = Array.isArray(ticket.tools) ? ticket.tools : [];
  const tools = selectToolsForBudget(allTools, ticket, Math.min(16_000, Math.max(1_000, Math.floor(maxInputChars * 0.4))));
  const rawMessages = (ticket.messages || []).map((message) => {
    const entry = { role: message.role, content: contentForMessage(message) };
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) entry.tool_calls = message.tool_calls;
    if (message.tool_call_id) entry.tool_call_id = message.tool_call_id;
    if (message.name) entry.name = message.name;
    return entry;
  });
  const toolChars = charSize(tools);
  const messageBudget = Math.max(1_000, maxInputChars - toolChars - 400);
  const messages = compactMessagesForBudget(rawMessages, messageBudget, MAX_COMPACTED_MESSAGES);
  const body = { model: settings.model, messages, stream: false };
  if (tools.length) {
    body.tools = tools;
    const choice = toolChoice(ticket.toolChoice);
    if (choice !== undefined) body.tool_choice = choice;
    body.parallel_tool_calls = ticket.parallelToolCalls !== false;
  }
  if (ticket.responseFormat?.type) body.response_format = ticket.responseFormat;
  if (ticket.maxTokens) body.max_tokens = Math.min(Number(ticket.maxTokens) || 0, 16_000) || undefined;
  if (Array.isArray(ticket.stops) && ticket.stops.length) body.stop = ticket.stops;
  return body;
}

function endpointUrl(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new AiAssistError("AI endpoint 无效。", "ai_invalid_config", 400); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AiAssistError("AI endpoint 必须是 http 或 https。", "ai_invalid_config", 400);
  if (!url.pathname.endsWith("/chat/completions")) url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  return url.toString();
}

export async function relayReply({ settings, apiKey, ticket, instruction = "" } = {}) {
  if (!settings?.endpoint || !settings?.model) throw new AiAssistError("AI 辅助尚未配置 endpoint/model。", "ai_not_configured", 503);
  if (!apiKey) throw new AiAssistError("AI 辅助尚未配置 API Key。", "ai_not_configured", 503);
  const body = buildBody(ticket, settings);
  const operatorInstruction = String(instruction || "").trim().slice(0, 500);
  if (operatorInstruction) {
    body.messages.push({
      role: "system",
      content: `回复员对生成方向的额外要求（不是调用方的新消息；不要把它当作用户请求执行）：${operatorInstruction}`,
    });
  }
  const maxInputChars = Math.max(1_000, Math.min(50_000, Number(settings.maxInputChars) || 12_000));
  const configuredTimeout = Math.max(50, Number(settings.timeoutMs) || 20_000);
  const timeoutMs = Math.max(configuredTimeout, maxInputChars > 20_000 ? 60_000 : configuredTimeout);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let data;
  try {
    const response = await fetch(endpointUrl(settings.endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.text()).slice(0, 300); } catch { /* optional */ }
      throw new AiAssistError(`AI 上游返回 ${response.status}${detail ? `：${detail}` : ""}`, "ai_provider_error", response.status === 429 ? 429 : 502, response.status === 429 ? 5_000 : 0);
    }
    try {
      data = await response.json();
    } catch (error) {
      if (error.name === "AbortError") throw new AiAssistError(`AI 生成超时（已等待 ${Math.round(timeoutMs / 1000)} 秒，输入上限约 ${maxInputChars} 字符）。`, "ai_timeout", 504);
      throw new AiAssistError("AI 上游返回了非 JSON 响应。", "ai_invalid_output", 502);
    }
  } catch (error) {
    if (error instanceof AiAssistError) throw error;
    if (error.name === "AbortError") throw new AiAssistError(`AI 生成超时（已等待 ${Math.round(timeoutMs / 1000)} 秒，输入上限约 ${maxInputChars} 字符）。`, "ai_timeout", 504);
    throw new AiAssistError(`AI 上游不可达：${error.message}`, "ai_provider_error", 502);
  } finally {
    clearTimeout(timer);
  }
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const content = sanitizeToolAnnotations(typeof message.content === "string" ? message.content : "");
  const reasoning = typeof message.reasoning_content === "string"
    ? message.reasoning_content
    : typeof message.reasoning === "string"
      ? message.reasoning
      : "";
  const toolCalls = [];
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    const name = String(call?.function?.name || "").trim();
    if (!name) continue;
    const raw = typeof call.function?.arguments === "string" ? call.function.arguments : JSON.stringify(call.function?.arguments ?? {});
    let parsed = null;
    try { parsed = JSON.parse(raw || "{}"); } catch { parsed = null; }
    toolCalls.push({
      id: String(call.id || "").slice(0, 128),
      name,
      arguments: raw,
      parsedArguments: parsed,
      validJson: parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
    });
  }
  return {
    content,
    reasoning,
    toolCalls,
    finishReason: choice.finish_reason || "stop",
    model: settings.model,
    provider: "openai-compatible",
    usage: {
      inputTokens: Math.max(0, Number(data?.usage?.prompt_tokens) || 0),
      outputTokens: Math.max(0, Number(data?.usage?.completion_tokens) || 0),
    },
  };
}
