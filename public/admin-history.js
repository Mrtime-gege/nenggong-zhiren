const $ = (id) => document.getElementById(id);
let csrf = "";
let role = "";
let operator = "";
let offset = 0;
let total = 0;
let lastResult = null;

async function api(path, options = {}) {
  const headers = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrf;
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 401) {
    location.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
    throw new Error("请重新登录");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `请求失败（${response.status}）`);
  return data;
}

function setStatus(text, bad = false) {
  const node = $("status");
  if (!node) return;
  node.textContent = text;
  node.classList.toggle("err", bad);
}

function currentParams() {
  const params = new URLSearchParams();
  const q = $("historyQ").value.trim();
  if (q) params.set("q", q);
  if ($("historyModel").value) params.set("model", $("historyModel").value);
  if ($("historyState").value) params.set("state", $("historyState").value);
  if ($("historyOperator").value.trim()) params.set("operator", $("historyOperator").value.trim());
  if ($("historyFrom").value) params.set("from", $("historyFrom").value);
  if ($("historyTo").value) params.set("to", $("historyTo").value);
  params.set("limit", $("historyLimit").value);
  params.set("offset", String(offset));
  return params;
}

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function stateLabel(value) {
  return { done: "已完成", failed: "失败", cancelled: "已取消" }[value] || value;
}

function stateClass(value) {
  return value === "done" ? "done" : value === "failed" ? "failed" : "cancelled";
}

function render(result) {
  lastResult = result;
  total = result.total || 0;
  const tbody = $("historyTable");
  tbody.replaceChildren();
  $("historyCount").textContent = `${total} 条`;
  $("historyEmpty").classList.toggle("hidden", result.items.length > 0);
  const maxPage = Math.max(1, Math.ceil(total / Number($("historyLimit").value)));
  const page = Math.min(maxPage, Math.floor(offset / Number($("historyLimit").value)) + 1);
  $("historyPage").textContent = `第 ${page} / ${maxPage} 页`;
  $("historyPrev").disabled = offset <= 0;
  $("historyNext").disabled = offset + result.items.length >= total;

  for (const row of result.items) {
    const tr = document.createElement("tr");
    const cells = [
      [formatTime(row.finishedAt || row.createdAt), "mono history-time"],
      [row.sessionId ? `#${row.sessionTurn || 1} ${String(row.sessionId).slice(0, 10)}` : "单次", "mono history-session"],
      [row.model, "mono"],
      [row.caller || "—", ""],
      [row.operator || "—", ""],
      [stateLabel(row.state), `history-state ${stateClass(row.state)}`],
      [row.preview || "(空)", "history-preview"],
      [`${row.promptTokens || 0} / ${row.completionTokens || 0}`, "mono history-tokens"],
    ];
    for (const [value, className] of cells) {
      const td = document.createElement("td");
      td.textContent = value;
      if (className) td.className = className;
      tr.append(td);
    }
    tr.title = row.id;
    tbody.append(tr);
  }
}

async function load() {
  setStatus("检索中…");
  const params = currentParams();
  const query = params.toString();
  $("exportHistory").href = `/op/api/history.csv?${query}`;
  const data = await api(`/op/api/history?${query}`);
  render(data);
  setStatus(`${data.total || 0} 条`);
}

function fillOptions(result) {
  if (!result) return;
  const modelSelect = $("historyModel");
  const current = modelSelect.value;
  const models = [["", "全部模型"], ...(result.models || []).map((model) => [model, model])];
  modelSelect.replaceChildren(...models.map(([value, text]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    return option;
  }));
  modelSelect.value = current;
}

async function init() {
  try {
    const me = await api("/auth/me");
    csrf = me.csrfToken;
    role = me.user.role;
    operator = me.user.username;
    if (role !== "admin") { location.replace("/console"); return; }
    $("userLabel").textContent = `${operator} · 管理员`;
    window.NGZRNAV?.render(role, me.features);
    await load();
    fillOptions(lastResult);
    $("historyFilters").addEventListener("submit", (event) => {
      event.preventDefault();
      offset = 0;
      load().catch((error) => setStatus(error.message, true));
    });
    $("historyReset").addEventListener("click", () => {
      for (const id of ["historyQ", "historyOperator", "historyFrom", "historyTo"]) $(id).value = "";
      $("historyModel").value = "";
      $("historyState").value = "";
      offset = 0;
      load().catch((error) => setStatus(error.message, true));
    });
    $("historyLimit").addEventListener("change", () => { offset = 0; load().catch(() => {}); });
    $("historyPrev").addEventListener("click", () => { offset = Math.max(0, offset - Number($("historyLimit").value)); load().catch(() => {}); });
    $("historyNext").addEventListener("click", () => { offset += Number($("historyLimit").value); load().catch(() => {}); });
    $("logout").addEventListener("click", async () => {
      try { await api("/auth/logout", { method: "POST", body: {} }); } catch { /* leave */ }
      location.replace("/login");
    });
  } catch (error) {
    setStatus("加载失败", true);
  }
}
init();
