/**
 * Canonical message/part helpers shared by every protocol adapter.
 *
 * The rest of the application only sees:
 *   { role, content, parts, tool_calls?, name?, tool_call_id? }
 *
 * A new content type can be supported by adding a part normalizer here and a
 * serializer in the relevant adapter; the queue and browser UI do not need a
 * new data model.
 */

export class ProtocolError extends Error {
  constructor(message, { status = 400, code = "invalid_request_error", param = null } = {}) {
    super(message);
    this.name = "ProtocolError";
    this.status = status;
    this.code = code;
    this.param = param;
  }
}

export const ANTHROPIC_PROTOCOL = "anthropic";
export const OPENAI_PROTOCOL = "openai";

export function textPart(text) {
  return { type: "text", text: String(text ?? "") };
}

export function canonicalText(parts) {
  let text = "";
  for (const part of parts) {
    if (!part) continue;
    if (part.type === "text") text += part.text;
    else if (part.type === "image") text += "\n[image attached]";
    else if (part.type === "file") text += "\n[file attached]";
    else if (part.type === "tool_use") text += `\n[tool use: ${part.name}]`;
    else if (part.type === "tool_result") text += "\n[tool result]";
    else if (part.type === "thinking") text += "\n[thinking]";
    else if (part.type === "unknown") text += `\n[unsupported content: ${part.originalType || "unknown"}]`;
  }
  return text;
}

export function validateFileId(value) {
  return typeof value === "string" && /^file_[A-Za-z0-9_-]{8,80}$/.test(value);
}

export const MAX_MESSAGES_PER_REQUEST = 256;
export const MAX_CONTENT_PARTS_PER_MESSAGE = 512;

export function collectFiles(parts, messageIndex) {
  const attachments = [];
  for (const part of parts) {
    if (part?.type !== "file" || !part.fileId) continue;
    attachments.push({ messageIndex, type: "file", fileId: part.fileId });
  }
  return attachments;
}

export function collectImages(parts, messageIndex) {
  const attachments = [];
  for (const part of parts) {
    if (part?.type !== "image" || !part.url) continue;
    attachments.push({ messageIndex, type: "image", url: part.url, detail: part.detail || "auto" });
  }
  return attachments;
}

export function validateImageUrl(url) {
  const value = String(url || "");
  return (
    (/^https?:\/\//i.test(value) || /^data:image\/(?:png|jpe?g|webp|gif)[;,]/i.test(value)) &&
    value.length <= 2_000_000
  );
}

export function unixNow() {
  return Date.now();
}

export function parseInteger(value, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

export function normalizeToolName(value) {
  const name = String(value ?? "").trim();
  return name ? name.slice(0, 64) : "";
}

export function normalizeToolListOpenAI(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ProtocolError("tools must be an array.", { code: "invalid_tools", param: "tools" });
  }
  const tools = [];
  for (const item of raw.slice(0, 128)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (item.type !== "function" || !item.function || typeof item.function !== "object") continue;
    const fn = item.function;
    const name = normalizeToolName(fn.name);
    if (!name) continue;
    tools.push({
      type: "function",
      function: {
        name,
        description: typeof fn.description === "string" ? fn.description.slice(0, 16_000) : "",
        parameters:
          fn.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters)
            ? fn.parameters
            : { type: "object", properties: {} },
        ...(fn.strict === true ? { strict: true } : {}),
      },
    });
  }
  return tools;
}

export function normalizeToolListAnthropic(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ProtocolError("tools must be an array.", { code: "invalid_tools", param: "tools" });
  }
  const tools = [];
  for (const item of raw.slice(0, 128)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const name = normalizeToolName(item.name);
    if (!name) continue;
    const schema = item.input_schema;
    tools.push({
      type: "function",
      function: {
        name,
        description: typeof item.description === "string" ? item.description.slice(0, 16_000) : "",
        parameters:
          schema && typeof schema === "object" && !Array.isArray(schema)
            ? schema
            : { type: "object", properties: {} },
      },
    });
  }
  return tools;
}

export function normalizeToolChoiceOpenAI(raw, tools) {
  if (raw === undefined || raw === null) return tools.length ? "auto" : "none";
  if (typeof raw === "string") {
    if (!["auto", "none", "required"].includes(raw)) {
      throw new ProtocolError("tool_choice must be 'auto', 'none', 'required', or a function selector.", {
        code: "invalid_tool_choice",
        param: "tool_choice",
      });
    }
    if (raw === "required" && !tools.length) {
      throw new ProtocolError("tool_choice 'required' needs at least one tool.", {
        code: "invalid_tool_choice",
        param: "tool_choice",
      });
    }
    return raw;
  }
  if (!tools.length || !raw || typeof raw !== "object" || raw.type !== "function" || !raw.function) {
    throw new ProtocolError("A tool_choice function selector needs at least one tool.", {
      code: "invalid_tool_choice",
      param: "tool_choice",
    });
  }
  const name = normalizeToolName(raw.function.name);
  if (!name || !tools.some((tool) => tool.function.name === name)) {
    throw new ProtocolError(`tool_choice names '${name}', which is not in tools.`, {
      code: "invalid_tool_choice",
      param: "tool_choice",
    });
  }
  return { type: "function", name };
}

export function normalizeToolChoiceAnthropic(raw, tools) {
  if (raw === undefined || raw === null) return tools.length ? "auto" : "none";
  if (typeof raw === "string") {
    if (raw === "auto") return tools.length ? "auto" : "none";
    if (raw === "any") return tools.length ? "required" : "auto";
    if (raw === "none") return "none";
    throw new ProtocolError("tool_choice must be auto, any, none, or a tool selector.", {
      code: "invalid_tool_choice",
      param: "tool_choice",
    });
  }
  if (!raw || typeof raw !== "object") {
    throw new ProtocolError("tool_choice must be auto, any, none, or a tool selector.", {
      code: "invalid_tool_choice",
      param: "tool_choice",
    });
  }
  if (raw.type === "auto" || raw.type === "any" || raw.type === "none") {
    return normalizeToolChoiceAnthropic(raw.type, tools);
  }
  if (raw.type !== "tool" || !tools.length) {
    throw new ProtocolError("A tool_choice tool selector needs at least one tool.", {
      code: "invalid_tool_choice",
      param: "tool_choice",
    });
  }
  const name = normalizeToolName(raw.name);
  if (!name || !tools.some((tool) => tool.function.name === name)) {
    throw new ProtocolError(`tool_choice names '${name}', which is not in tools.`, {
      code: "invalid_tool_choice",
      param: "tool_choice",
    });
  }
  return { type: "function", name };
}

export function normalizeStops(raw, field = "stop") {
  if (raw === undefined || raw === null) return [];
  const list = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : null;
  if (!list) {
    throw new ProtocolError(`${field} must be a string or an array of strings.`, {
      code: "invalid_stop",
      param: field,
    });
  }
  const out = [];
  for (const item of list) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (out.length >= 4) {
      throw new ProtocolError(`You can provide at most 4 ${field} values.`, {
        code: "invalid_stop",
        param: field,
      });
    }
    out.push(item);
  }
  return out;
}

export function normalizeMaxTokens(raw, { required = false } = {}) {
  if (raw === undefined || raw === null) {
    if (required) {
      throw new ProtocolError("max_tokens is required.", { code: "missing_max_tokens", param: "max_tokens" });
    }
    return undefined;
  }
  const number = Number(raw);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number <= 0) {
    throw new ProtocolError("max_tokens must be a positive integer.", {
      code: "invalid_max_tokens",
      param: "max_tokens",
    });
  }
  return Math.min(32_000, number);
}

export function canonicalMessage(role, parts, extras = {}) {
  return {
    role,
    content: canonicalText(parts),
    parts,
    ...extras,
  };
}
