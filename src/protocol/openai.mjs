/** OpenAI Chat Completions input normalizer. */

import {
  OPENAI_PROTOCOL,
  ProtocolError,
  canonicalMessage,
  collectImages,
  normalizeMaxTokens,
  normalizeStops,
  normalizeToolChoiceOpenAI,
  normalizeToolListOpenAI,
  textPart,
  validateImageUrl,
} from "./common.mjs";

const ALLOWED_ROLES = new Set(["system", "developer", "user", "assistant", "tool", "function"]);

function normalizeContent(entry, messageIndex) {
  const parts = [];
  let text = "";
  if (typeof entry.content === "string") {
    parts.push(textPart(entry.content));
    text = entry.content;
  } else if (Array.isArray(entry.content)) {
    for (const rawPart of entry.content) {
      if (typeof rawPart === "string") {
        parts.push(textPart(rawPart));
        text += rawPart;
        continue;
      }
      if (!rawPart || typeof rawPart !== "object") continue;
      if (rawPart.type === "text" || rawPart.type === "input_text") {
        const value = typeof rawPart.text === "string" ? rawPart.text : "";
        parts.push(textPart(value));
        text += value;
      } else if (rawPart.type === "image_url" || rawPart.type === "input_image") {
        const rawUrl = typeof rawPart.image_url === "string" ? rawPart.image_url : rawPart.image_url?.url;
        const url = typeof rawUrl === "string" ? rawUrl : "";
        if (validateImageUrl(url)) {
          parts.push({ type: "image", url, detail: rawPart.image_url?.detail || rawPart.detail || "auto" });
          text += "\n[image attached]";
        } else {
          parts.push({ type: "unknown", originalType: "image_url" });
          text += "\n[unsupported image]";
        }
      } else {
        parts.push({ type: "unknown", originalType: String(rawPart.type || "unknown").slice(0, 40) });
        text += `\n[unsupported content: ${String(rawPart.type || "unknown").slice(0, 40)}]`;
      }
    }
  } else if (entry.content !== undefined && entry.content !== null) {
    throw new ProtocolError("Message content must be a string or an array.", {
      code: "invalid_messages",
      param: "messages",
    });
  }
  return { parts, text };
}

export function normalizeOpenAIRequest(body, { models } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ProtocolError("Request body must be a JSON object.", { code: "invalid_body" });
  }
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) throw new ProtocolError("You must provide a model parameter.", { code: "missing_model", param: "model" });
  if (models && !models.has(model)) {
    throw new ProtocolError(
      `The model '${model}' does not exist or you do not have access to it.`,
      { status: 404, code: "model_not_found", param: "model" },
    );
  }
  if (body.n !== undefined && Number(body.n) !== 1) {
    throw new ProtocolError("n>1 is not supported by this provider.", { code: "unsupported_n", param: "n" });
  }
  if (body.logprobs === true || body.top_logprobs !== undefined) {
    throw new ProtocolError("logprobs are not supported by this provider.", {
      code: "unsupported_logprobs",
      param: "logprobs",
    });
  }
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    throw new ProtocolError("stream must be a boolean.", { code: "invalid_stream", param: "stream" });
  }
  if (body.stream_options !== undefined && (!body.stream_options || typeof body.stream_options !== "object")) {
    throw new ProtocolError("stream_options must be an object.", {
      code: "invalid_stream_options",
      param: "stream_options",
    });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ProtocolError("messages must be a non-empty array.", { code: "invalid_messages", param: "messages" });
  }

  const messages = [];
  const attachments = [];
  const toolCalls = [];
  for (const entry of body.messages) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ProtocolError("Each message must be an object.", { code: "invalid_messages", param: "messages" });
    }
    const role = typeof entry.role === "string" ? entry.role : "";
    if (!ALLOWED_ROLES.has(role)) {
      throw new ProtocolError(`Invalid role '${role}'.`, { code: "invalid_role", param: "messages" });
    }
    const messageIndex = messages.length;
    const { parts } = normalizeContent(entry, messageIndex);
    const calls = role === "assistant" && Array.isArray(entry.tool_calls) ? entry.tool_calls : [];
    const canonicalCalls = [];
    for (const call of calls.slice(0, 32)) {
      if (!call || typeof call !== "object" || !call.function) continue;
      const name = String(call.function.name || "").slice(0, 64);
      if (!name) continue;
      const args =
        typeof call.function.arguments === "string"
          ? call.function.arguments
          : JSON.stringify(call.function.arguments ?? {});
      canonicalCalls.push({
        id: String(call.id || `call_${messageIndex}_${canonicalCalls.length}`).slice(0, 128),
        type: "function",
        function: { name, arguments: args.slice(0, 64_000) },
      });
    }
    for (const call of canonicalCalls) {
      parts.push({ type: "tool_use", id: call.id, name: call.function.name, input: call.function.arguments });
      toolCalls.push(call);
    }
    const message = canonicalMessage(role, parts, {
      ...(canonicalCalls.length ? { tool_calls: canonicalCalls } : {}),
      ...(typeof entry.name === "string" ? { name: entry.name.slice(0, 64) } : {}),
      ...(typeof entry.tool_call_id === "string" ? { tool_call_id: entry.tool_call_id.slice(0, 128) } : {}),
    });
    messages.push(message);
    attachments.push(...collectImages(parts, messageIndex));
  }

  const tools = normalizeToolListOpenAI(body.tools);
  return {
    protocol: OPENAI_PROTOCOL,
    model,
    messages,
    attachments,
    tools,
    toolChoice: normalizeToolChoiceOpenAI(body.tool_choice, tools),
    parallelToolCalls: body.parallel_tool_calls !== false,
    responseFormat: normalizeResponseFormat(body.response_format),
    maxTokens: normalizeMaxTokens(body.max_tokens ?? body.max_completion_tokens),
    stops: normalizeStops(body.stop),
    stream: body.stream === true,
    includeUsage: body.stream_options?.include_usage === true,
    clientUser: typeof body.user === "string" ? body.user.slice(0, 256) : undefined,
    rawBody: body,
  };
}

function normalizeResponseFormat(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProtocolError("response_format must be an object.", {
      code: "invalid_response_format",
      param: "response_format",
    });
  }
  if (raw.type === "text") return { type: "text" };
  if (raw.type === "json_object") return { type: "json_object" };
  if (raw.type === "json_schema") {
    const spec = raw.json_schema;
    if (!spec || typeof spec !== "object" || !spec.schema || typeof spec.schema !== "object") {
      throw new ProtocolError("response_format.json_schema.schema must be an object.", {
        code: "invalid_response_format",
        param: "response_format",
      });
    }
    return {
      type: "json_schema",
      json_schema: {
        name: typeof spec.name === "string" ? spec.name.slice(0, 64) : "response",
        schema: spec.schema,
        strict: spec.strict === true,
      },
    };
  }
  throw new ProtocolError("response_format.type must be text, json_object, or json_schema.", {
    code: "invalid_response_format",
    param: "response_format",
  });
}
