/* Request inspector: filter tickets and compare raw vs normalized protocol bodies. */

const $ = (id) => document.getElementById(id);
let me = null;
let csrf = "";
let tickets = [];
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

function prettyJson(text) {
  const raw = String(text || "");
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch { return raw; }
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
  const filters = readFilters();
  return tickets.filter((ticket) => matches(ticket, filters));
}

function relatedTickets(ticket) {
  if (!ticket?.sessionId) return [];
  return tickets.filter((item) => item.sessionId === ticket.sessionId);
}

function renderRows() {
  const body = $("requestRows");
  const rows = visibleTickets();
  $("requestCount").textContent = `${rows.length} / ${tickets.length} 条`;
  body.replaceChildren();
  for (const ticket of rows) {
    const tr = el("tr", `request-row${ticket.id === selectedId ? " selected" : ""}`);
    tr.tabIndex = 0;
    tr.dataset.id = ticket.id;
    tr.append(
      el("td", "mono", fmtTime(ticket.createdAt)),
      el("td", "", protocolLabel(ticket.protocol)),
      el("td", "mono", ticket.model || "—"),
      (() => { const td = el("td"); td.append(el("span", `request-state ${stateTone(ticket.state)}`, stateLabel(ticket.state))); return td; })(),
      el("td", "mono request-session-cell", ticket.sessionId ? `${String(ticket.sessionId).slice(0, 10)} · ${ticket.sessionTurn || 1}` : "单次"),
      el("td", "", ticket.caller || "—"),
      el("td", "", ticket.claimedBy || "—"),
      el("td", "mono", fmtBytes(ticket.requestBytes || 0)),
      el("td", "mono", String(ticket.toolCount || 0)),
      el("td", "mono", ticket.requestCaptured ? (ticket.requestTruncated ? "截断" : "有") : "无"),
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
    ["工具 / 附件", `${ticket.toolCount || 0} / ${ticket.attachmentCount || 0}`],
  ];
  for (const [key, value] of pairs) {
    const pair = el("div", "request-meta-pair");
    pair.append(el("span", "request-meta-label", key), el("span", "request-meta-value", String(value || "—")));
    meta.append(pair);
  }
  const related = relatedTickets(ticket);
  $("requestRelatedHint").textContent = ticket.sessionId ? `同会话 ${related.length} 张` : "无会话 ID";
  renderPayload();
}

function renderPayload() {
  const ticket = selectedTicket;
  if (!ticket) return;
  const inspection = ticket.requestInspection;
  const hasRaw = Boolean(inspection?.raw);
  if (selectedView === "raw" && !hasRaw) selectedView = "normalized";
  const text = selectedView === "raw"
    ? prettyJson(inspection.raw)
    : JSON.stringify(normalizedTicket(ticket), null, 2);
  $("requestRawView").classList.toggle("active", selectedView === "raw");
  $("requestNormalizedView").classList.toggle("active", selectedView === "normalized");
  $("requestRawView").disabled = !hasRaw;
  $("requestPayload").textContent = selectedView === "raw" && !hasRaw ? "这张票据没有原始请求快照。" : text;
  $("requestViewHint").textContent = selectedView === "raw"
    ? (inspection?.truncated ? "原始请求超过捕获上限，已截断。" : "收到请求时的原始 JSON。")
    : "进入票据队列前的归一化结构；不包含原始字段别名和未知字段。";
}

async function loadTickets() {
  const data = await api("/op/api/tickets?compact=1&limit=200");
  tickets = data.tickets || [];
  modelOptions();
  renderRows();
  if (selectedId && !tickets.some((ticket) => ticket.id === selectedId)) {
    selectedId = null;
    showDetailEmpty();
  }
  $("requestSummary").textContent = `最近 ${tickets.length} 条 · ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
}

function resetFilters() {
  for (const id of ["requestQ", "requestCaller", "requestOperator", "requestSession", "requestFrom", "requestTo"]) $(id).value = "";
  for (const id of ["requestProtocol", "requestState", "requestModel", "requestStream", "requestTools", "requestImages", "requestCapture"]) $(id).value = "";
  relatedOnly = false;
  $("requestRelatedClear").classList.add("hidden");
  renderRows();
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
    $("requestFilters").addEventListener("submit", (event) => { event.preventDefault(); relatedOnly = false; $("requestRelatedClear").classList.add("hidden"); renderRows(); });
    $("requestFilters").addEventListener("change", () => { if (relatedOnly && $("requestSession").value !== selectedTicket?.sessionId) relatedOnly = false; renderRows(); });
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
      const text = $("requestPayload").textContent;
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
    });
    $("requestDetailClose").addEventListener("click", () => { selectedId = null; showDetailEmpty(); renderRows(); });
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
