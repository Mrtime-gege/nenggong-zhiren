/** Anthropic Messages API input/output adapter. */

import {
  ANTHROPIC_PROTOCOL,
  ProtocolError,
  canonicalMessage,
  collectFiles,
  collectImages,
  validateFileId,
  MAX_CONTENT_PARTS_PER_MESSAGE,
  MAX_MESSAGES_PER_REQUEST,
  normalizeMaxTokens,
  normalizeStops,
  normalizeToolChoiceAnthropic,
  normalizeToolListAnthropic,
  textPart,
  validateImageUrl,
} from "./common.mjs";

function imagePart(source) {
  if (!source || typeof source !== "object") return null;
  if (source.type === "base64") {
    const mediaType = typeof source.media_type === "string" ? source.media_type : "image/png";
    const data = typeof source.data === "string" ? source.data : "";
    const url = `data:${mediaType};base64,${data}`;
    return validateImageUrl(url) ? { type: "image", url, detail: "auto" } : null;
  }
  if (source.type === "url" && typeof source.url === "string" && validateImageUrl(source.url)) {
    return { type: "image", url: source.url, detail: "auto" };
  }
  return null;
}

function parseBlocks(blocks, messageIndex, role) {
  const parts = [];
  const toolCalls = [];
  const attachments = [];
  if (typeof blocks === "string") {
    parts.push(textPart(blocks));
    return { parts, toolCalls, attachments };
  }
  if (!Array.isArray(blocks)) {
    throw new ProtocolError("Message content must be a string or an array of content blocks.", {
      code: "invalid_messages",
      param: "messages",
    });
  }
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text") {
      const text = typeof block.text === "string" ? block.text : "";
      parts.push(textPart(text));
    } else if (block.type === "document") {
      const source = block.source;
      if (source?.type === "file" && validateFileId(source.file_id)) {
        parts.push({ type: "file", fileId: source.file_id });
        attachments.push({ messageIndex, type: "file", fileId: source.file_id });
      } else {
        parts.push({ type: "unknown", originalType: "document" });
      }
    } else if (block.type === "image") {
      const part = imagePart(block.source);
      if (part) {
        parts.push(part);
        attachments.push({ messageIndex, type: "image", url: part.url, detail: "auto" });
      } else {
        parts.push({ type: "unknown", originalType: "image" });
      }
    } else if (block.type === "tool_use") {
      const id = String(block.id || `call_${messageIndex}_${parts.length}`).slice(0, 128);
      const name = String(block.name || "").slice(0, 64);
      const input = block.input && typeof block.input === "object" ? block.input : {};
      parts.push({ type: "tool_use", id, name, input });
      if (name) {
        toolCalls.push({
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(input) },
        });
      }
    } else if (block.type === "tool_result") {
      const toolUseId = String(block.tool_use_id || "").slice(0, 128);
      const nested = block.content;
      const nestedParts = [];
      if (typeof nested === "string") nestedParts.push(textPart(nested));
      else if (Array.isArray(nested)) {
        for (const item of nested) {
          if (item?.type === "text") nestedParts.push(textPart(item.text));
          else if (item?.type === "image") {
            const part = imagePart(item.source);
            if (part) {
              nestedParts.push(part);
              attachments.push({ messageIndex, type: "image", url: part.url, detail: "auto" });
            }
          }
        }
      }
      parts.push({
        type: "tool_result",
        toolUseId,
        isError: block.is_error === true,
        parts: nestedParts,
      });
    } else if (block.type === "thinking") {
      parts.push({ type: "thinking", text: typeof block.thinking === "string" ? block.thinking : "" });
    } else if (block.type === "redacted_thinking") {
      parts.push({ type: "thinking", text: "[redacted]" });
    } else {
      parts.push({ type: "unknown", originalType: String(block.type || "unknown").slice(0, 40) });
    }
  }
  if (parts.length > MAX_CONTENT_PARTS_PER_MESSAGE) {
    throw new ProtocolError(`A message may contain at most ${MAX_CONTENT_PARTS_PER_MESSAGE} content parts.`, {
      code: "too_many_content_parts",
      param: "messages",
    });
  }
  return { parts, toolCalls, attachments };
}

function systemText(system) {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function normalizeAnthropicRequest(body, { models } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ProtocolError("Request body must be a JSON object.", { code: "invalid_request_error" });
  }
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    throw new ProtocolError("model: Field required", { code: "missing_model", param: "model" });
  }
  if (models && !models.has(model)) {
    throw new ProtocolError(`model: ${model} not found`, {
      status: 404,
      code: "not_found_error",
      param: "model",
    });
  }
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    throw new ProtocolError("stream must be a boolean.", { code: "invalid_request_error", param: "stream" });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ProtocolError("messages: Field required", {
      code: "invalid_request_error",
      param: "messages",
    });
  }
  if (body.messages.length > MAX_MESSAGES_PER_REQUEST) {
    throw new ProtocolError(`messages may contain at most ${MAX_MESSAGES_PER_REQUEST} entries.`, {
      code: "too_many_messages",
      param: "messages",
    });
  }

  const messages = [];
  const attachments = [];
  const system = systemText(body.system);
  if (system) messages.push(canonicalMessage("system", [textPart(system)]));

  for (const entry of body.messages) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ProtocolError("messages: each message must be an object", {
        code: "invalid_request_error",
        param: "messages",
      });
    }
    const role = entry.role === "assistant" ? "assistant" : entry.role === "user" ? "user" : "";
    if (!role) {
      throw new ProtocolError("messages.role must be user or assistant.", {
        code: "invalid_request_error",
        param: "messages",
      });
    }
    const messageIndex = messages.length;
    const parsed = parseBlocks(entry.content, messageIndex, role);
    const message = canonicalMessage(role, parsed.parts, {
      ...(parsed.toolCalls.length ? { tool_calls: parsed.toolCalls } : {}),
      ...(parsed.parts.find((part) => part.type === "tool_result")?.toolUseId
        ? { tool_call_id: parsed.parts.find((part) => part.type === "tool_result").toolUseId }
        : {}),
    });
    messages.push(message);
    attachments.push(...parsed.attachments);
  }

  const tools = normalizeToolListAnthropic(body.tools);
  const maxTokens = normalizeMaxTokens(body.max_tokens, { required: true });
  return {
    protocol: ANTHROPIC_PROTOCOL,
    model,
    messages,
    attachments,
    tools,
    toolChoice: normalizeToolChoiceAnthropic(body.tool_choice, tools),
    parallelToolCalls: body.tool_choice?.disable_parallel_tool_use !== true,
    responseFormat: undefined,
    maxTokens,
    stops: normalizeStops(body.stop_sequences, "stop_sequences"),
    stream: body.stream === true,
    includeUsage: true,
    clientUser:
      body.metadata && typeof body.metadata.user_id === "string"
        ? body.metadata.user_id.slice(0, 256)
        : undefined,
    rawBody: body,
  };
}

export function anthropicStopReason(finishReason) {
  switch (finishReason) {
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      return "refusal";
    case "stop":
      return "end_turn";
    default:
      return finishReason || "end_turn";
  }
}

function parseToolInput(argumentsText) {
  try {
    const value = JSON.parse(argumentsText || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function anthropicToolBlocks(ticket) {
  return (ticket.toolCalls || []).map((call) => ({
    type: "tool_use",
    id: call.id,
    name: call.function.name,
    input: parseToolInput(call.function.arguments),
  }));
}

export function anthropicUsage(usage) {
  return {
    input_tokens: Number(usage?.prompt_tokens) || 0,
    output_tokens: Number(usage?.completion_tokens) || 0,
  };
}

export function anthropicMessageJson(ticket, usage) {
  const content = [];
  if (ticket.refusal) content.push({ type: "text", text: ticket.refusal });
  else if (ticket.text) content.push({ type: "text", text: ticket.text });
  content.push(...anthropicToolBlocks(ticket));
  if (!content.length) content.push({ type: "text", text: "" });
  return {
    id: ticket.id,
    type: "message",
    role: "assistant",
    model: ticket.model,
    content,
    stop_reason: anthropicStopReason(ticket.finishReason),
    stop_sequence: null,
    usage: anthropicUsage(usage),
  };
}
