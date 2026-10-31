/** Operator-only AI relay: forward the caller request and hold the native reply. */

import { AiAssistError } from "./assist.mjs";

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

function buildBody(ticket, settings) {
  const messages = (ticket.messages || []).map((message) => {
    const entry = { role: message.role, content: contentForMessage(message) };
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) entry.tool_calls = message.tool_calls;
    if (message.tool_call_id) entry.tool_call_id = message.tool_call_id;
    if (message.name) entry.name = message.name;
    return entry;
  });
  const body = { model: settings.model, messages, stream: false };
  if (ticket.tools?.length) {
    body.tools = ticket.tools;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
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
      if (error.name === "AbortError") throw new AiAssistError("AI 生成超时。", "ai_timeout", 504);
      throw new AiAssistError("AI 上游返回了非 JSON 响应。", "ai_invalid_output", 502);
    }
  } catch (error) {
    if (error instanceof AiAssistError) throw error;
    if (error.name === "AbortError") throw new AiAssistError("AI 生成超时。", "ai_timeout", 504);
    throw new AiAssistError(`AI 上游不可达：${error.message}`, "ai_provider_error", 502);
  } finally {
    clearTimeout(timer);
  }
  const choice = data?.choices?.[0] || {};
  const message = choice.message || {};
  const content = sanitizeToolAnnotations(typeof message.content === "string" ? message.content : "");
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
