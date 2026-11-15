/* Request inspector: filter tickets and compare raw vs normalized protocol bodies. */

const $ = (id) => document.getElementById(id);
let me = null;
let csrf = "";
let tickets = [];
let totalTickets = 0;
let pageOffset = 0;
let hasMore = false;
let serverFiltered = false;
let selectedId = null;
let selectedTicket = null;
let selectedView = "raw";
let relatedOnly = false;
let refreshTimer = null;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf && options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrf;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function fmtTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function fmtBytes(value) {
  const n = Number(value) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function stateLabel(state) {
  return {
    queued: "待认领",
    claimed: "已认领",
    streaming: "流式中",
    finishing: "收尾中",
    done: "已完成",
    failed: "失败",
    cancelled: "已取消",
  }[state] || state || "—";
}

function stateTone(state) {
  if (state === "queued") return "queued";
  if (["claimed", "streaming", "finishing"].includes(state)) return "active";
  if (state === "done") return "done";
  return "failed";
}

function protocolLabel(protocol) {
  return protocol === "anthropic" ? "Anthropic" : "OpenAI";
}

let currentJsonData = null;
const fieldAnchors = new Map();

function jsonContainerLabel(value) {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).length}}`;
  return "";
}

function jsonValueSize(value) {
  try { return JSON.stringify(value)?.length || 0; }
  catch { return 0; }
}

function jsonValueClass(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function makeJsonLeaf(key, value, path) {
  const row = el("div", `json-leaf ${jsonValueClass(value)}`);
  row.dataset.path = path;
  row.append(el("span", "json-key", key));
  let text = value === null ? "null" : JSON.stringify(value);
  if (typeof text === "string" && text.length > 1800) text = `${text.slice(0, 1800)}… (${text.length} chars)`;
  const val = el("span", "json-value", text);
  const full = value === null ? "null" : String(JSON.stringify(value));
  if (full.length <= 300) val.title = full;
  row.append(val);
  return row;
}

function makeJsonNode(key, value, path, depth) {
  if (!value || typeof value !== "object") {
    const leaf = makeJsonLeaf(key, value, path);
    fieldAnchors.set(path, leaf);
    return leaf;
  }
  const node = el("details", "json-node");
  node.dataset.path = path;
  node.open = false;
  const summary = el("summary", "json-summary");
  summary.append(el("span", "json-key", key), el("span", "json-meta", `${jsonContainerLabel(value)} ${jsonValueSize(value)} B`));
  node.append(summary);
  let built = false;
  const build = () => {
    if (built) return;
    built = true;
    for (const [childKey, childValue] of Object.entries(value)) {
      const childPath = Array.isArray(value) ? `${path}[${childKey}]` : `${path}.${childKey}`;
      node.append(makeJsonNode(Array.isArray(value) ? `[${childKey}]` : childKey, childValue, childPath, depth + 1));
    }
  };
  node.addEventListener("toggle", () => {
    if (!node.open) return;
    build();
    // Let the browser lay out the newly inserted children before measuring.
  });
  fieldAnchors.set(path, node);
  // Build children lazily on first expansion. Large message arrays are common
  // in real Agent traffic and should not create thousands of DOM nodes up front.
  return node;
}

function renderJsonTree(data) {
  const host = $("requestPayload");
  host.replaceChildren();
  fieldAnchors.clear();
  if (!data || typeof data !== "object") {
    host.append(el("div", "request-empty-line", "没有可展开的 JSON 字段。"));
    return;
  }
  const root = el("div", "json-root");
  for (const [key, value] of Object.entries(data)) {
    root.append(makeJsonNode(key, value, key, 0));
  }
  host.append(root);
}

function topLevelGroups(data) {
  const groups = [
    { label: "model", keys: ["model"], tone: "model" },
    { label: "messages", keys: ["messages", "system"], tone: "messages" },
    { label: "tools", keys: ["tools", "tool_choice", "functions", "function_call", "parallel_tool_calls"], tone: "tools" },
    { label: "params", keys: [], tone: "params" },
  ];
  const assigned = new Set();
  for (const group of groups) {
    for (const key of group.keys) assigned.add(key);
  }
  groups.at(-1).keys = Object.keys(data || {}).filter((key) => !assigned.has(key));
  return groups;
}

function renderPacket(data) {
  const host = $("requestPacket");
  host.replaceChildren();
  if (!data || typeof data !== "object") return;
  const groups = topLevelGroups(data).map((group) => ({
    ...group,
    bytes: group.keys.reduce((sum, key) => sum + (Object.prototype.hasOwnProperty.call(data, key) ? jsonValueSize(data[key]) : 0), 0),
    firstKey: group.keys.find((key) => Object.prototype.hasOwnProperty.call(data, key)),
  })).filter((group) => group.bytes > 0);
  const total = groups.reduce((sum, group) => sum + group.bytes, 0) || 1;
  const bar = el("div", "packet-bar");
  for (const group of groups) {
    const segment = el("button", `packet-segment ${group.tone}`);
    segment.type = "button";
    segment.style.flex = `${Math.max(3, group.bytes / total * 100)} 1 0`;
    segment.append(el("span", "packet-segment-label", group.label), el("span", "packet-segment-size", fmtBytes(group.bytes)));
    segment.title = `${group.keys.join(", ")} · ${fmtBytes(group.bytes)}`;
    segment.addEventListener("click", () => revealJsonField(group.firstKey));
    bar.append(segment);
  }
  const legend = el("div", "packet-legend");
  for (const group of groups) {
    const item = el("button", "packet-legend-item");
    item.type = "button";
    item.append(el("span", `packet-dot ${group.tone}`), el("span", "", `${group.label} ${Math.round(group.bytes / total * 100)}%`));
    item.addEventListener("click", () => revealJsonField(group.firstKey));
    legend.append(item);
  }
  host.append(bar, legend);
}

function renderFields(data) {
  const host = $("requestFields");
  host.replaceChildren();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    host.append(el("div", "request-empty-line", "没有顶层字段。"));
    return;
  }
  host.append(el("div", "request-fields-title", "顶层字段"));
  for (const [key, value] of Object.entries(data)) {
    const button = el("button", "request-field-row");
    button.type = "button";
    button.title = "跳转到该字段";
    button.append(el("span", "request-field-name", key), el("span", "request-field-type", jsonContainerLabel(value) || typeof value), el("span", "request-field-size", fmtBytes(jsonValueSize(value))));
    button.addEventListener("click", () => revealJsonField(key));
    host.append(button);
  }
}

function revealJsonField(key) {
  if (!key) return;
  const node = fieldAnchors.get(key);
  if (!node) return;
  if (node.tagName === "DETAILS") node.open = true;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  node.classList.add("field-flash");
  setTimeout(() => node.classList.remove("field-flash"), 900);
}

function setTopLevelOpen(open) {
  for (const node of fieldAnchors.values()) {
    if (node.tagName === "DETAILS" && !node.parentElement?.closest(".json-node")) {
      node.open = open;
      if (open) node.dispatchEvent(new Event("toggle"));
    }
  }
}

function normalizedTicket(ticket) {
  return {
    protocol: ticket.protocol === "anthropic" ? "anthropic" : "openai",
    model: ticket.model,
    stream: ticket.stream === true,
    messages: ticket.messages || [],
    tools: ticket.tools || [],
    toolChoice: ticket.toolChoice,
    parallelToolCalls: ticket.parallelToolCalls !== false,
    responseFormat: ticket.responseFormat || null,
    maxTokens: ticket.maxTokens ?? null,
    stops: ticket.stops || [],
    includeUsage: ticket.includeUsage === true,
    effort: ticket.effort || "",
    clientUser: ticket.clientUser || null,
  };
}

function filtersActive() {
  return [...document.querySelectorAll("#requestFilters input, #requestFilters select")]
    .some((input) => input.id !== "requestAutoRefresh" && input.value !== "");
}

function modelOptions() {
  const select = $("requestModel");
  const current = select.value;
  const models = [...new Set(tickets.map((ticket) => ticket.model).filter(Boolean))].sort();
  select.replaceChildren(new Option("全部模型", ""));
  for (const model of models) select.append(new Option(model, model));
  if (models.includes(current)) select.value = current;
}

function readFilters() {
  return {
    q: $("requestQ").value.trim().toLowerCase(),
    protocol: $("requestProtocol").value,
    state: $("requestState").value,
    model: $("requestModel").value,
    caller: $("requestCaller").value.trim().toLowerCase(),
    operator: $("requestOperator").value.trim().toLowerCase(),
    session: $("requestSession").value.trim(),
    stream: $("requestStream").value,
    tools: $("requestTools").value,
    images: $("requestImages").value,
    capture: $("requestCapture").value,
    from: $("requestFrom").value ? new Date(`${$("requestFrom").value}T00:00:00`).getTime() : 0,
    to: $("requestTo").value ? new Date(`${$("requestTo").value}T23:59:59.999`).getTime() : 0,
  };
}

function matches(ticket, f) {
  if (f.protocol && ticket.protocol !== f.protocol) return false;
  if (f.state && ticket.state !== f.state) return false;
  if (f.model && ticket.model !== f.model) return false;
  if (f.caller && !(ticket.caller || "").toLowerCase().includes(f.caller)) return false;
  if (f.operator && !(ticket.claimedBy || "").toLowerCase().includes(f.operator)) return false;
  if (f.session && ticket.sessionId !== f.session) return false;
  if (f.stream !== "" && (ticket.stream === true) !== (f.stream === "1")) return false;
  if (f.tools !== "" && ((ticket.toolCount || 0) > 0) !== (f.tools === "1")) return false;
  if (f.images !== "" && Boolean(ticket.hasImages) !== (f.images === "1")) return false;
  if (f.capture !== "" && Boolean(ticket.requestCaptured) !== (f.capture === "1")) return false;
  const at = ticket.finishedAt || ticket.createdAt || 0;
  if (f.from && at < f.from) return false;
  if (f.to && at > f.to) return false;
  if (f.q) {
    const text = `${ticket.id} ${ticket.model} ${ticket.caller} ${ticket.claimedBy} ${ticket.sessionId} ${ticket.preview || ""} ${ticket.searchText || ""}`.toLowerCase();
    if (!text.includes(f.q)) return false;
  }
  return true;
}

function visibleTickets() {
  if (!serverFiltered) {
    const filters = readFilters();
    return tickets.filter((ticket) => matches(ticket, filters));
  }
  return tickets;
}

function relatedTickets(ticket) {
  if (!ticket?.sessionId) return [];
  return tickets.filter((item) => item.sessionId === ticket.sessionId);
}

function renderRows() {
  const body = $("requestRows");
  const rows = visibleTickets();
  $("requestCount").textContent = `${rows.length} / ${serverFiltered ? totalTickets : tickets.length} 条`;
  // Auto-refresh runs every few seconds; avoid rebuilding an unchanged table.
  const rowSignature = JSON.stringify([
    selectedId,
    rows.map((ticket) => [
      ticket.id, ticket.state, ticket.model, ticket.sessionId, ticket.sessionTurn,
      ticket.claimedBy, ticket.requestBytes, ticket.toolCount, ticket.hasImages,
      ticket.requestCaptured, ticket.requestTruncated,
    ]),
  ]);
  if (body.dataset.signature === rowSignature) {
    if (relatedOnly && selectedTicket?.sessionId) {
      $("requestRelatedHint").textContent = `同会话 ${relatedTickets(selectedTicket).length} 张`;
    }
    return;
  }
  body.dataset.signature = rowSignature;
  body.replaceChildren();
  for (const ticket of rows) {
    const tr = el("tr", `request-row${ticket.id === selectedId ? " selected" : ""}`);
    tr.tabIndex = 0;
    tr.dataset.id = ticket.id;
    const protocolModel = el("td", "request-protocol-cell");
    protocolModel.append(
      el("span", "request-protocol-name", protocolLabel(ticket.protocol)),
      el("span", "request-model-name", ticket.model || "—"),
    );
    const flags = el("td", "request-flags");
    if (ticket.toolCount) flags.append(el("span", "request-flag", `T${ticket.toolCount}`));
    if (ticket.hasImages) flags.append(el("span", "request-flag", "IMG"));
    if (ticket.requestCaptured) flags.append(el("span", "request-flag captured", ticket.requestTruncated ? "截断" : "RAW"));
    if (!flags.childNodes.length) flags.textContent = "—";
    tr.append(
      el("td", "mono request-time-cell", fmtTime(ticket.createdAt)),
      protocolModel,
      (() => { const td = el("td"); td.append(el("span", `request-state ${stateTone(ticket.state)}`, stateLabel(ticket.state))); return td; })(),
      el("td", "mono request-session-cell", ticket.sessionId ? `${String(ticket.sessionId).slice(0, 10)} · ${ticket.sessionTurn || 1}` : "单次"),
      el("td", "request-caller-cell", ticket.caller || "—"),
      el("td", "mono", fmtBytes(ticket.requestBytes || 0)),
      flags,
    );
    const select = () => selectTicket(ticket.id);
    tr.addEventListener("click", select);
    tr.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
    });
    body.append(tr);
  }
  $("requestEmpty").classList.toggle("hidden", rows.length > 0);
  if (relatedOnly && selectedTicket?.sessionId) {
    $("requestRelatedHint").textContent = `同会话 ${relatedTickets(selectedTicket).length} 张`;
  } else {
    $("requestRelatedHint").textContent = "";
  }
}

function relatedFilterEnabled() {
  return Boolean($("requestRelatedOnly")?.checked);
}

function applyRelatedFilter(ticket) {
  if (!ticket || !relatedFilterEnabled() || !ticket.sessionId) {
    relatedOnly = false;
    $("requestRelatedClear").classList.add("hidden");
    return;
  }
  relatedOnly = true;
  $("requestSession").value = ticket.sessionId;
  $("requestRelatedClear").classList.remove("hidden");
  renderRows();
}

function selectTicket(id) {
  selectedId = id;
  selectedTicket = tickets.find((ticket) => ticket.id === id) || null;
  applyRelatedFilter(selectedTicket);
  renderRows();
  try { history.replaceState(null, "", `/console/requests?ticket=${encodeURIComponent(id)}`); } catch { /* optional */ }
  loadTicketDetail(id).catch((error) => {
    $("requestPayload").textContent = `加载失败：${error.message}`;
  });
}

async function loadTicketDetail(id) {
  const data = await api(`/op/api/tickets/${encodeURIComponent(id)}`);
  const ticket = data.ticket;
  if (!ticket) return;
  selectedTicket = ticket;
  const index = tickets.findIndex((item) => item.id === id);
  if (index >= 0) tickets[index] = { ...tickets[index], ...ticket };
  applyRelatedFilter(ticket);
  renderDetail(ticket);
}

function showDetailEmpty() {
  selectedTicket = null;
  $("requestDetail").classList.add("hidden");
  $("requestDetailEmpty").classList.remove("hidden");
}

function renderDetail(ticket) {
  $("requestDetailEmpty").classList.add("hidden");
  $("requestDetail").classList.remove("hidden");
  $("requestDetailTitle").textContent = `${protocolLabel(ticket.protocol)} · ${ticket.id}`;
  const exportBase = `/op/api/tickets/${encodeURIComponent(ticket.id)}/report`;
  if ($("requestExportJson")) $("requestExportJson").href = `${exportBase}?format=json`;
  if ($("requestExportMarkdown")) $("requestExportMarkdown").href = `${exportBase}?format=md`;
  const meta = $("requestDetailMeta");
  meta.replaceChildren();
  const pairs = [
    ["模型", ticket.model],
    ["状态", `${stateLabel(ticket.state)} · ${ticket.stream ? "流式" : "非流式"}`],
    ["调用方", ticket.caller],
    ["回复员", ticket.claimedBy || "未认领"],
    ["会话", ticket.sessionId ? `${ticket.sessionId} · 第 ${ticket.sessionTurn || 1} 轮` : "独立请求"],
    ["创建", fmtTime(ticket.createdAt)],
    ["请求大小", fmtBytes(ticket.requestInspection?.raw?.length || 0)],
    ["工具 / 附件", `${ticket.toolCount ?? (ticket.tools || []).length} / ${ticket.attachmentCount ?? (ticket.attachments || []).length}`],
  ];
  for (const [key, value] of pairs) {
    const pair = el("div", "request-meta-pair");
    pair.append(el("span", "request-meta-label", key), el("span", "request-meta-value", String(value || "—")));
    meta.append(pair);
  }
  const related = relatedTickets(ticket);
  $("requestRelatedHint").textContent = ticket.sessionId ? `同会话 ${related.length} 张` : "无会话 ID";
  renderParameters(ticket);
  renderPayload();
}

const PARAM_STATUS = {
  supported: ["已使用", "param-supported"],
  ignored: ["已接收未使用", "param-ignored"],
  unsupported: ["不支持", "param-unsupported"],
  unknown: ["未识别", "param-unknown"],
  derived: ["派生/默认", "param-derived"],
  nested: ["嵌套字段", "param-nested"],
};

const PARAM_DIFF = {
  unchanged: ["原样", "diff-unchanged"],
  converted: ["已转换", "diff-converted"],
  dropped: ["已丢弃", "diff-dropped"],
  truncated: ["已截断", "diff-truncated"],
  default: ["默认值", "diff-default"],
  ignored: ["未使用", "diff-ignored"],
  unknown: ["未识别", "diff-unknown"],
  rejected: ["不支持", "diff-rejected"],
  nested: ["嵌套", "diff-nested"],
};

function renderParameterWarnings(ticket, rows) {
  const host = $("requestParameterWarnings");
  if (!host) return;
  host.replaceChildren();
  const warnings = Array.isArray(ticket.requestParameterWarnings) ? ticket.requestParameterWarnings : [];
  if (!warnings.length) return;
  const head = el("div", "request-param-warning-head");
  const errorCount = warnings.filter((item) => item.level === "error").length;
  head.append(el("span", "", errorCount ? `有 ${errorCount} 个参数会导致请求被拒绝` : `${warnings.length} 个参数需要留意`));
  const jump = el("select", "request-param-warning-jump");
  jump.append(new Option("跳到参数…", ""));
  for (const warning of warnings) jump.append(new Option(warning.path, warning.path));
  jump.addEventListener("change", () => {
    if (!jump.value) return;
    const row = host.parentElement?.querySelector(`[data-param-path="${jump.value}"]`);
    row?.scrollIntoView({ block: "nearest" });
    row?.classList.add("param-flash");
    setTimeout(() => row?.classList.remove("param-flash"), 1200);
  });
  head.append(jump);
  host.append(head);
  for (const warning of warnings) {
    const chip = el("span", `request-param-warning ${warning.level}`, `${warning.path}：${warning.message}`);
    host.append(chip);
  }
}

function renderParameters(ticket) {
  const host = $("requestParameters");
  const count = $("requestParameterCount");
  if (!host) return;
  const rows = Array.isArray(ticket.requestParameters) ? ticket.requestParameters : [];
  if (count) count.textContent = `${rows.length} 项`;
  renderParameterWarnings(ticket, rows);
  host.replaceChildren();
  if (!rows.length) {
    host.append(el("div", "request-param-empty", "这张票据没有可用的参数快照；新请求会显示完整参数说明。"));
    return;
  }
  const onlyIssues = Boolean($("requestParamOnlyIssues")?.checked);
  const query = String($("requestParamSearch")?.value || "").trim().toLowerCase();
  const visible = rows.filter((row) => {
    if (onlyIssues && !["converted", "dropped", "ignored", "unknown", "rejected"].includes(row.diff)) return false;
    if (query && !`${row.path} ${row.meaning} ${row.effect}`.toLowerCase().includes(query)) return false;
    return true;
  });
  if (!visible.length) {
    host.append(el("div", "request-param-empty", "没有匹配当前筛选的参数。"));
    return;
  }
  const groups = new Map();
  for (const row of visible) {
    const group = row.group || "请求";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  for (const [group, items] of groups) {
    const section = el("section", "request-param-group");
    section.append(el("div", "request-param-group-title", group));
    for (const row of items) {
      const node = el("article", "request-param-row");
      node.dataset.paramPath = row.path || "";
      const head = el("div", "request-param-head");
      const path = el("code", "request-param-path", row.path || row.normalizedField || "—");
      path.title = "点击定位到对应 JSON 字段";
      path.addEventListener("click", () => {
        const top = String(row.path || "").split(".")[0].replace(/\[\].*$/, "");
        if (top) revealJsonField(top);
      });
      const status = PARAM_STATUS[row.status] || PARAM_STATUS.nested;
      head.append(path, el("span", `request-param-status ${status[1]}`, status[0]));
      const diff = PARAM_DIFF[row.diff];
      if (diff && !["unchanged", "nested"].includes(row.diff)) {
        head.append(el("span", `request-param-diff ${diff[1]}`, diff[0]));
      }
      node.append(head);
      const meta = el("div", "request-param-meta");
      if (row.type) meta.append(el("span", "request-param-tag", row.type));
      if (row.rawValue !== undefined && row.rawValue !== "") meta.append(el("span", "", `原始 ${row.rawValue}`));
      if (row.normalizedField) meta.append(el("span", "", `归一化 ${row.normalizedField}=${row.normalizedValue ?? "—"}`));
      node.append(meta);
      node.append(el("p", "request-param-meaning", row.meaning || "—"));
      node.append(el("p", "request-param-effect", row.effect || ""));
      section.append(node);
    }
    host.append(section);
  }
}


async function replaySelectedTicket() {
  const ticket = selectedTicket;
  const host = $("requestReplayResult");
  if (!ticket || !host) return;
  host.classList.remove("hidden", "ok", "error");
  host.textContent = "正在按当前协议重新校验…";
  $("requestReplay")?.setAttribute("disabled", "disabled");
  try {
    const data = await api(`/op/api/tickets/${encodeURIComponent(ticket.id)}/replay`, { method: "POST", body: {} });
    const ignored = (data.parameters || []).filter((row) => row.status === "ignored").length;
    const unknown = (data.parameters || []).filter((row) => row.status === "unknown").length;
    host.classList.add("ok");
    host.textContent = `重放通过：${data.protocol} · ${data.normalized.messages} 条消息 · ${data.normalized.tools} 个工具 · ${data.parameters.length} 个参数（${ignored} 个未使用，${unknown} 个未识别）`;
  } catch (error) {
    host.classList.add("error");
    const param = error.status ? `（HTTP ${error.status}）` : "";
    host.textContent = `重放失败${param}：${error.message}`;
  } finally {
    $("requestReplay")?.removeAttribute("disabled");
  }
}

let compatibilityLoaded = false;

async function loadCompatibility() {
  if (compatibilityLoaded) return;
  const host = $("requestCompatibility");
  if (!host) return;
  host.textContent = "正在加载兼容性矩阵…";
  try {
    const data = await api("/op/api/compatibility");
    host.replaceChildren();
    for (const protocol of data.protocols || []) {
      const section = el("section", "request-compat-protocol");
      const title = el("div", "request-compat-title");
      title.append(
        el("strong", "", protocol.protocol === "anthropic-messages" ? "Anthropic Messages" : "OpenAI Chat"),
        el("span", "admin-hint", `支持 ${protocol.counts.supported} · 未使用 ${protocol.counts.ignored} · 不支持 ${protocol.counts.unsupported}`),
      );
      section.append(title);
      const table = el("table", "admin-table request-compat-table");
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const label of ["字段", "状态", "含义"]) headRow.append(el("th", "", label));
      head.append(headRow);
      const body = document.createElement("tbody");
      for (const field of protocol.fields) {
        const row = document.createElement("tr");
        row.append(el("td", "", field.path));
        const status = PARAM_STATUS[field.status] || PARAM_STATUS.nested;
        const cell = document.createElement("td");
        cell.append(el("span", `request-param-status ${status[1]}`, status[0]));
        row.append(cell, el("td", "", field.meaning || ""));
        body.append(row);
      }
      table.append(head, body);
      section.append(table);
      host.append(section);
    }
    const hint = $("requestCompatibilityHint");
    if (hint) hint.textContent = `版本 ${data.version}`;
    compatibilityLoaded = true;
  } catch (error) {
    host.textContent = `兼容性报告加载失败：${error.message}`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const onlyIssues = $("requestParamOnlyIssues");
  if (onlyIssues) {
    onlyIssues.addEventListener("change", () => {
      if (selectedTicket) renderParameters(selectedTicket);
    });
    $("requestParamSearch")?.addEventListener("input", () => {
      if (selectedTicket) renderParameters(selectedTicket);
    });
  }
});

function renderPayload() {
  const ticket = selectedTicket;
  if (!ticket) return;
  const inspection = ticket.requestInspection;
  const hasRaw = Boolean(inspection?.raw);
  if (selectedView === "raw" && !hasRaw) selectedView = "normalized";
  let data = null;
  let fallback = "";
  if (selectedView === "raw") {
    try { data = JSON.parse(inspection.raw); }
    catch { fallback = String(inspection.raw || ""); }
  } else {
    data = normalizedTicket(ticket);
  }
  currentJsonData = data;
  $("requestRawView").classList.toggle("active", selectedView === "raw");
  $("requestNormalizedView").classList.toggle("active", selectedView === "normalized");
  $("requestRawView").disabled = !hasRaw;
  const rawBytes = inspection?.raw ? new Blob([inspection.raw]).size : 0;
  $("requestViewHint").textContent = selectedView === "raw"
    ? (inspection?.truncated ? `原始请求超过捕获上限（${rawBytes} 字节），已截断。` : `收到请求时的原始 JSON（${rawBytes} 字节）。展开字段或使用左侧字段列表跳转。`)
    : "进入票据队列前的归一化结构；不包含原始字段别名和未知字段。";
  if (fallback) {
    $("requestPacket").replaceChildren();
    $("requestFields").replaceChildren();
    $("requestPayload").classList.add("fallback");
    $("requestPayload").textContent = fallback;
    return;
  }
  $("requestPayload").classList.remove("fallback");
  renderPacket(data);
  renderFields(data);
  renderJsonTree(data);
}

function buildSearchQuery(filters, offset) {
  const params = new URLSearchParams({ compact: "1", mode: "search", limit: "50", offset: String(offset) });
  for (const [key, value] of Object.entries({
    q: filters.q,
    protocol: filters.protocol,
    state: filters.state,
    model: filters.model,
    caller: filters.caller,
    operator: filters.operator,
    session: filters.session,
    stream: filters.stream,
    tools: filters.tools,
    images: filters.images,
    capture: filters.capture,
    from: filters.from ? String(filters.from) : "",
    to: filters.to ? String(filters.to) : "",
  })) {
    if (value !== "" && value !== 0) params.set(key, String(value));
  }
  return params;
}

async function loadTickets({ append = false } = {}) {
  const filters = readFilters();
  const useSearch = filtersActive() || relatedOnly;
  const data = useSearch
    ? await api(`/op/api/tickets?${buildSearchQuery(filters, append ? pageOffset : 0)}`)
    : await api("/op/api/tickets?compact=1&limit=200");
  const incoming = data.tickets || [];
  if (append && useSearch) {
    const seen = new Set(tickets.map((ticket) => ticket.id));
    tickets = [...tickets, ...incoming.filter((ticket) => !seen.has(ticket.id))];
  } else {
    tickets = incoming;
  }
  serverFiltered = useSearch;
  totalTickets = useSearch ? Number(data.total) || 0 : tickets.length;
  pageOffset = useSearch ? (Number(data.offset) || 0) + incoming.length : tickets.length;
  hasMore = useSearch && pageOffset < totalTickets;
  $("requestLoadMore")?.classList.toggle("hidden", !hasMore);
  modelOptions();
  renderRows();
  if (selectedId && !tickets.some((ticket) => ticket.id === selectedId)) {
    selectedId = null;
    showDetailEmpty();
  }
  $("requestSummary").textContent = useSearch
    ? `筛选 ${totalTickets} 条 · 已加载 ${tickets.length} 条 · ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`
    : `最近 ${tickets.length} 条 · ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
}

function resetFilters() {
  for (const id of ["requestQ", "requestCaller", "requestOperator", "requestSession", "requestFrom", "requestTo"]) $(id).value = "";
  for (const id of ["requestProtocol", "requestState", "requestModel", "requestStream", "requestTools", "requestImages", "requestCapture"]) $(id).value = "";
  relatedOnly = false;
  $("requestRelatedClear").classList.add("hidden");
  loadTickets().catch((error) => { $("status").textContent = error.message; });
}

async function init() {
  try {
    me = await api("/auth/me");
    csrf = me.csrfToken || "";
    $("userLabel").textContent = `${me.user?.username || ""} · ${me.user?.role === "admin" ? "管理员" : "人工回复员"}`;
    window.NGZRNAV?.render(me.user?.role || "", me.features || {});
    $("status").textContent = "已连接";
    $("status").classList.add("ok");
    $("logout").addEventListener("click", async () => {
      await api("/auth/logout", { method: "POST" });
      location.href = "/login";
    });
    await loadTickets();
    const params = new URLSearchParams(location.search);
    const initialSession = params.get("session") || "";
    const initialTicket = params.get("ticket") || "";
    if (initialSession) {
      $("requestSession").value = initialSession;
      relatedOnly = true;
      $("requestRelatedClear").classList.remove("hidden");
      renderRows();
    }
    if (initialTicket) selectTicket(initialTicket);
    $("requestFilters").addEventListener("submit", (event) => {
      event.preventDefault();
      relatedOnly = false;
      $("requestRelatedClear").classList.add("hidden");
      loadTickets().catch((error) => { $("status").textContent = error.message; });
    });
    $("requestFilters").addEventListener("change", () => {
      if (relatedOnly && $("requestSession").value !== selectedTicket?.sessionId) relatedOnly = false;
      renderRows();
    });
    $("requestLoadMore")?.addEventListener("click", () => {
      loadTickets({ append: true }).catch((error) => { $("status").textContent = error.message; });
    });
    $("requestReset").addEventListener("click", resetFilters);
    $("requestRefresh").addEventListener("click", () => loadTickets().catch((error) => { $("status").textContent = error.message; }));
    $("requestRelatedClear").addEventListener("click", () => {
      relatedOnly = false;
      $("requestSession").value = "";
      $("requestRelatedClear").classList.add("hidden");
      renderRows();
    });
    $("requestRelatedOnly").addEventListener("change", () => applyRelatedFilter(selectedTicket));
    $("requestRawView").addEventListener("click", () => { selectedView = "raw"; renderPayload(); });
    $("requestNormalizedView").addEventListener("click", () => { selectedView = "normalized"; renderPayload(); });
    $("requestCopy").addEventListener("click", () => {
      const text = currentJsonData ? JSON.stringify(currentJsonData, null, 2) : $("requestPayload").textContent;
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
    });
    $("requestExpandAll").addEventListener("click", () => setTopLevelOpen(true));
    $("requestCollapseAll").addEventListener("click", () => setTopLevelOpen(false));
    $("requestDetailClose").addEventListener("click", () => { selectedId = null; showDetailEmpty(); renderRows(); });
    $("requestReplay").addEventListener("click", () => { replaySelectedTicket(); });
    $("requestReplayResult").classList.add("hidden");
    $("requestCompatibilityBox").addEventListener("toggle", () => {
      if ($("requestCompatibilityBox").open) loadCompatibility();
    });
    const refresh = () => {
      clearTimeout(refreshTimer);
      if (!$("requestAutoRefresh").checked) return;
      refreshTimer = setTimeout(async () => {
        try { await loadTickets(); } catch { /* keep last view */ }
        refresh();
      }, 5000);
    };
    $("requestAutoRefresh").addEventListener("change", refresh);
    refresh();
  } catch (error) {
    $("status").textContent = error.status === 401 ? "请重新登录" : `加载失败：${error.message}`;
    $("status").classList.add("ok");
  }
}

init();
