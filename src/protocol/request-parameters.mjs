/**
 * Human-readable parameter inventory for request inspection.
 *
 * This module deliberately returns summaries, not full message bodies. The raw
 * JSON view remains available separately for exact inspection.
 */

const COMMON_RAW = {
  model: {
    type: "string", group: "请求", meaning: "调用方选择的模型 ID。",
    effect: "必须存在于模型注册表，并满足调用密钥的模型白名单。", normalizedField: "model",
  },
  messages: {
    type: "array", group: "请求", meaning: "对话消息列表，包含角色和内容块。",
    effect: "归一化为内部 {role, content, parts} 结构；最多保留允许的消息数量。", normalizedField: "messages",
  },
  stream: {
    type: "boolean", group: "响应", meaning: "是否以 SSE 流式返回。",
    effect: "只影响响应传输方式；票据仍由人工处理。", normalizedField: "stream",
  },
  tools: {
    type: "array", group: "工具", meaning: "调用方声明的可调用工具。",
    effect: "校验工具名、参数 schema 和数量；工具不会在本机执行。", normalizedField: "tools",
  },
  tool_choice: {
    type: "string | object", group: "工具", meaning: "控制是否允许以及选择哪个工具。",
    effect: "转换为内部 toolChoice；none 会阻止工具建议。", normalizedField: "toolChoice",
  },
  parallel_tool_calls: {
    type: "boolean", group: "工具", meaning: "是否允许一次响应返回多个工具调用。",
    effect: "false 时内部票据只允许一个工具调用。", normalizedField: "parallelToolCalls",
  },
  stop: {
    type: "string | string[]", group: "生成", meaning: "调用方要求的停止词。",
    effect: "归一化为 stops；回复员发送时用于修剪正文。", normalizedField: "stops",
  },
};

const OPENAI_RAW = {
  ...COMMON_RAW,
  max_tokens: {
    type: "integer", group: "生成", meaning: "调用方允许的输出 token 上限。",
    effect: "归一化为 maxTokens，提示回复员控制长度。", normalizedField: "maxTokens",
  },
  max_completion_tokens: {
    type: "integer", group: "生成", meaning: "max_tokens 的新版别名。",
    effect: "两者同时出现时，归一化使用 max_tokens；否则使用本字段。", normalizedField: "maxTokens",
  },
  stream_options: {
    type: "object", group: "响应", meaning: "流式响应选项，例如 include_usage。",
    effect: "只有 include_usage=true 会进入归一化 includeUsage。", normalizedField: "includeUsage",
  },
  response_format: {
    type: "object", group: "生成", meaning: "要求文本、JSON object 或 JSON schema 输出。",
    effect: "归一化为 responseFormat；发送前会校验 JSON 结构。", normalizedField: "responseFormat",
  },
  user: {
    type: "string", group: "客户端", meaning: "调用方的终端用户标识。",
    effect: "截断到 256 字符，进入归一化 clientUser；不参与鉴权。", normalizedField: "clientUser",
  },
  reasoning_effort: {
    type: "string", group: "生成", meaning: "调用方建议的推理力度。",
    effect: "归一化为 effort；人工回复流程不会据此调用模型。", normalizedField: "effort",
  },
  temperature: {
    type: "number", group: "生成", meaning: "采样温度。",
    effect: "当前人工回复流程不消费该参数；保留在原始快照中供对照。", status: "ignored",
  },
  top_p: {
    type: "number", group: "生成", meaning: "核采样概率。",
    effect: "当前人工回复流程不消费该参数。", status: "ignored",
  },
  n: {
    type: "integer", group: "生成", meaning: "生成候选数量。",
    effect: "仅支持 1；其他值在入库前拒绝。", status: "unsupported",
  },
  logprobs: {
    type: "boolean", group: "生成", meaning: "是否返回 token 对数概率。",
    effect: "当前供应商不支持，入库前拒绝。", status: "unsupported",
  },
  functions: {
    type: "array", group: "工具", meaning: "OpenAI 旧版函数定义。",
    effect: "当前主路径使用 tools；本字段不进入归一化。", status: "ignored",
  },
  function_call: {
    type: "string | object", group: "工具", meaning: "OpenAI 旧版函数选择。",
    effect: "当前主路径使用 tool_choice；本字段不进入归一化。", status: "ignored",
  },
};

const ANTHROPIC_RAW = {
  model: COMMON_RAW.model,
  messages: {
    type: "array", group: "请求", meaning: "Anthropic messages 数组，roles 为 user/assistant。",
    effect: "转换为统一消息结构；content block 会被拆分。", normalizedField: "messages",
  },
  system: {
    type: "string | array", group: "请求", meaning: "Anthropic 系统提示，不作为普通消息。",
    effect: "归一化时合并为文本上下文。", normalizedField: "messages",
  },
  max_tokens: {
    type: "integer", group: "生成", meaning: "Anthropic 必填输出 token 上限。",
    effect: "归一化为 maxTokens。", normalizedField: "maxTokens",
  },
  stream: COMMON_RAW.stream,
  tools: COMMON_RAW.tools,
  tool_choice: {
    type: "object", group: "工具", meaning: "Anthropic 工具选择（auto/any/tool）。",
    effect: "转换为内部 toolChoice；disable_parallel_tool_use 进入并行开关。", normalizedField: "toolChoice",
  },
  stop_sequences: {
    type: "string[]", group: "生成", meaning: "Anthropic 停止序列。",
    effect: "归一化为 stops。", normalizedField: "stops",
  },
  metadata: {
    type: "object", group: "客户端", meaning: "调用方附带的元数据，例如 user_id。",
    effect: "只有 metadata.user_id 进入 clientUser；其余字段保留在原始快照。", normalizedField: "clientUser",
  },
  temperature: {
    type: "number", group: "生成", meaning: "采样温度。",
    effect: "当前人工回复流程不消费该参数。", status: "ignored",
  },
  top_p: {
    type: "number", group: "生成", meaning: "核采样概率。",
    effect: "当前人工回复流程不消费该参数。", status: "ignored",
  },
  top_k: {
    type: "integer", group: "生成", meaning: "采样候选数量。",
    effect: "当前人工回复流程不消费该参数。", status: "ignored",
  },
  thinking: {
    type: "object", group: "生成", meaning: "Anthropic 扩展思考配置。",
    effect: "当前人工回复流程不启用上游思考预算，保留原始快照供分析。", status: "ignored",
  },
};

const NORMALIZED_FIELDS = {
  protocol: { label: "协议", meaning: "解析使用的协议适配器。", effect: "决定响应序列化和错误格式。" },
  model: { label: "模型", meaning: "归一化后的模型 ID。", effect: "参与模型白名单、调度和权限判断。" },
  messages: { label: "消息", meaning: "归一化后的内部消息数组。", effect: "坐席看到的时间线和 AI 输入。" },
  attachments: { label: "附件", meaning: "从消息内容提取的图片/文件引用。", effect: "按调用方 Key 和票据隔离。" },
  tools: { label: "工具", meaning: "归一化后的工具定义。", effect: "交给回复员确认后返回调用方，不在本机执行。" },
  toolChoice: { label: "工具选择", meaning: "归一化工具策略。", effect: "auto/none/required 或指定工具名。" },
  parallelToolCalls: { label: "并行工具", meaning: "是否允许多个工具调用。", effect: "false 时票据只允许一个调用。" },
  responseFormat: { label: "输出格式", meaning: "文本、JSON object 或 JSON schema 约束。", effect: "发送前校验最终正文结构。" },
  maxTokens: { label: "输出上限", meaning: "归一化 token 上限。", effect: "提示回复员控制长度。" },
  stops: { label: "停止词", meaning: "归一化停止序列。", effect: "发送时修剪正文。" },
  stream: { label: "流式", meaning: "响应是否使用 SSE。", effect: "由服务端按协议写入事件流。" },
  includeUsage: { label: "返回 usage", meaning: "是否在流式响应中返回用量。", effect: "OpenAI stream_options.include_usage 的结果。" },
  clientUser: { label: "客户端用户", meaning: "调用方附带的终端用户标识。", effect: "仅用于展示/诊断，不参与鉴权。" },
  effort: { label: "推理力度", meaning: "调用方建议的推理强度。", effect: "当前人工流程不消费该参数。" },
};

const NESTED = {
  "messages[].role": {
    type: "string", group: "消息", meaning: "消息角色（system/user/assistant/tool 等）。",
    effect: "决定消息在时间线中的位置和上下文分类。",
  },
  "messages[].content": {
    type: "string | array", group: "消息", meaning: "消息正文或内容块数组。",
    effect: "文本进入正文；图片/文件拆成附件引用。",
  },
  "messages[].tool_calls": {
    type: "array", group: "消息", meaning: "助手消息中的工具调用。",
    effect: "校验函数名和 JSON 参数；工具不会在本机执行。",
  },
  "messages[].tool_call_id": {
    type: "string", group: "消息", meaning: "工具结果关联的调用 ID。",
    effect: "用于把工具结果接回上下文。",
  },
  "messages[].name": {
    type: "string", group: "消息", meaning: "消息作者名称。",
    effect: "只作上下文展示，不参与鉴权。",
  },
  "tools[].type": {
    type: "string", group: "工具", meaning: "工具类型，通常为 function。",
    effect: "只接受支持的函数工具。",
  },
  "tools[].function.name": {
    type: "string", group: "工具", meaning: "工具函数名。",
    effect: "调用时按名称匹配；重复/非法名称会被拒绝。",
  },
  "tools[].function.description": {
    type: "string", group: "工具", meaning: "工具用途说明。",
    effect: "帮助回复员理解何时调用。",
  },
  "tools[].function.parameters": {
    type: "object", group: "工具", meaning: "工具参数的 JSON Schema。",
    effect: "调用参数发送前按此 schema 校验。",
  },
  "response_format.type": {
    type: "string", group: "生成", meaning: "输出格式类型。",
    effect: "text/json_object/json_schema。",
  },
  "response_format.json_schema": {
    type: "object", group: "生成", meaning: "JSON Schema 包装（name/schema/strict）。",
    effect: "最终正文必须是合法 JSON 并符合 schema。",
  },
};

const MAX_PARAMETER_ROWS = 256;
const MAX_WARNING_ROWS = 64;

const FIELD_SETS = {
  openai: OPENAI_RAW,
  anthropic: ANTHROPIC_RAW,
};

function valueType(value) {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return "null";
  if (typeof value === "object") return `object(${Object.keys(value).length})`;
  return typeof value;
}

function summarize(value) {
  if (Array.isArray(value)) return `[${value.length} 项]`;
  if (value && typeof value === "object") return `{${Object.keys(value).length} 个字段}`;
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > 80 ? `"${text.slice(0, 80)}…"` : `"${text}"`;
  }
  if (value === undefined) return "—";
  return String(value);
}

function childRows(key, value, group) {
  const rows = [];
  const add = (path, fieldValue, def) => {
    const meta = NESTED[path];
    if (!meta) return;
    rows.push({
      path,
      group: def?.group || group || "嵌套",
      type: meta.type,
      meaning: meta.meaning,
      effect: meta.effect,
      rawValue: summarize(fieldValue),
      normalizedField: "",
      normalizedValue: "",
      status: "nested",
      diff: "nested",
      warning: "",
    });
  };
  if (key === "messages" && Array.isArray(value) && value.length) {
    const first = value[0] || {};
    for (const path of ["messages[].role", "messages[].content", "messages[].tool_calls", "messages[].tool_call_id", "messages[].name"]) {
      const field = path.split(".").pop();
      if (first[field] !== undefined) add(path, first[field], NESTED[path]);
    }
  }
  if (key === "tools" && Array.isArray(value) && value.length) {
    const first = value[0] || {};
    add("tools[].type", first.type, NESTED["tools[].type"]);
    for (const field of ["name", "description", "parameters"]) {
      if (first.function?.[field] !== undefined) add(`tools[].function.${field}`, first.function[field], NESTED[`tools[].function.${field}`]);
    }
  }
  if (key === "response_format" && value && typeof value === "object") {
    if (value.type !== undefined) add("response_format.type", value.type, NESTED["response_format.type"]);
    if (value.json_schema !== undefined) add("response_format.json_schema", value.json_schema, NESTED["response_format.json_schema"]);
  }
  return rows;
}

function diffFor(status, rawValue, normalizedValue, normalizedField) {
  if (status === "unsupported") return "rejected";
  if (status === "ignored" || status === "unknown") return status;
  if (status === "nested") return "nested";
  if (status === "derived") return "default";
  if (!normalizedField) return "unchanged";
  if (normalizedValue === undefined) return "dropped";
  if (rawValue === normalizedValue) return "unchanged";
  return "converted";
}

function warningFor(path, status) {
  if (status === "ignored") return "该参数已接收，但当前人工回复流程不会使用。";
  if (status === "unknown") return "当前协议适配器不认识该字段，只会保留在原始快照中。";
  if (status === "unsupported") return "该参数不受支持，请求会在入库前被拒绝。";
  return "";
}

export function summarizeParameterWarnings(rows) {
  const warnings = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row.warning) continue;
    if (warnings.length >= MAX_WARNING_ROWS) break;
    warnings.push({
      path: row.path,
      level: row.status === "unsupported" ? "error" : row.status === "unknown" ? "warn" : "info",
      message: row.warning,
    });
  }
  warnings.truncated = warnings.length >= MAX_WARNING_ROWS;
  return warnings;
}

export function describeRequestParameters(protocol, rawBody, normalized = {}) {
  const raw = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? rawBody : {};
  const defs = FIELD_SETS[protocol] || FIELD_SETS.openai;
  const mapped = new Set();
  const rows = [];
  for (const [key, value] of Object.entries(raw)) {
    const def = defs[key];
    if (def) {
      mapped.add(def.normalizedField || "");
      const normalizedValue = def.normalizedField ? normalized[def.normalizedField] : undefined;
      rows.push({
        path: key,
        group: def.group || "请求",
        type: def.type || valueType(value),
        meaning: def.meaning,
        effect: def.effect,
        rawValue: summarize(value),
        normalizedField: def.normalizedField || "",
        normalizedValue: def.normalizedField ? summarize(normalizedValue) : "",
        status: def.status || "supported",
        diff: diffFor(def.status || "supported", summarize(value), def.normalizedField ? summarize(normalizedValue) : undefined, def.normalizedField),
        warning: warningFor(key, def.status || "supported"),
      });
      rows.push(...childRows(key, value, def.group));
    } else {
      rows.push({
        path: key,
        group: "未识别",
        type: valueType(value),
        meaning: "当前协议适配器未识别的字段。",
        effect: "不会进入归一化作业字段；保留在原始请求快照中。",
        rawValue: summarize(value),
        normalizedField: "",
        normalizedValue: "",
        status: "unknown",
        diff: "unknown",
        warning: warningFor(key, "unknown"),
      });
    }
  }
  for (const [field, def] of Object.entries(NORMALIZED_FIELDS)) {
    if (mapped.has(field)) continue;
    const value = normalized[field];
    if (value === undefined) continue;
    rows.push({
      path: `normalized.${field}`,
      group: "归一化默认",
      type: valueType(value),
      meaning: def.meaning,
      effect: def.effect,
      rawValue: "（由默认值或派生逻辑生成）",
      normalizedField: field,
      normalizedValue: summarize(value),
      status: "derived",
      diff: "default",
      warning: "",
    });
  }
  if (rows.length > MAX_PARAMETER_ROWS) {
    const dropped = rows.length - MAX_PARAMETER_ROWS;
    rows.length = MAX_PARAMETER_ROWS;
    rows.push({
      path: `…（${dropped} 个参数未展开）`,
      group: "截断",
      type: "summary",
      meaning: "参数行数超过展示上限。",
      effect: "完整字段仍保留在原始请求快照中，请查看 raw。",
      rawValue: "",
      normalizedField: "",
      normalizedValue: "",
      status: "truncated",
      diff: "truncated",
      warning: "",
    });
    rows.truncated = true;
  }
  return rows;
}


export function protocolFieldCatalog(protocol = "openai") {
  const defs = FIELD_SETS[protocol] || FIELD_SETS.openai;
  return Object.entries(defs).map(([key, def]) => ({
    path: key,
    group: def.group || "请求",
    type: def.type,
    meaning: def.meaning,
    effect: def.effect,
    status: def.status || "supported",
    warning: warningFor(key, def.status || "supported"),
  }));
}
