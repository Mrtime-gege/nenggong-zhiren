const $ = (id) => document.getElementById(id);
let csrf = "";
let role = "";
let operator = "";
let availableModels = [];
let usageData = { keys: [], totals: {}, history: [] };
let selectedKeyIds = new Set();

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
  $("status").textContent = text;
  $("status").classList.toggle("err", bad);
}

function stat(label, value) {
  const box = document.createElement("div");
  box.className = "stat-box";
  const v = document.createElement("div");
  v.className = "stat-value";
  v.textContent = value;
  const l = document.createElement("div");
  l.className = "stat-label";
  l.textContent = label;
  box.append(v, l);
  return box;
}

function quota(key) {
  const l = key.limits || {};
  return `${l.requestsPerMinute || "不限"}/分 · ${l.requestsPerDay || "不限"}/日 · ${l.requestsPerMonth || "不限"}/月`;
}

function keyStatus(key) {
  if (key.expiresAt && key.expiresAt <= Date.now()) return "expired";
  return key.disabled ? "disabled" : "active";
}

function dateBounds() {
  let from = $("usageFilterFrom").value;
  let to = $("usageFilterTo").value;
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to, active: Boolean(from || to) };
}

function inRange(date, bounds) {
  if (bounds.from && date < bounds.from) return false;
  if (bounds.to && date > bounds.to) return false;
  return true;
}

function rangeForKey(key, bounds) {
  let requests = 0;
  let tokens = 0;
  for (const row of key.usage?.history || []) {
    if (!inRange(row.date, bounds)) continue;
    requests += row.requests || 0;
    tokens += row.tokens || 0;
  }
  return { requests, tokens };
}

function filteredKeys() {
  const query = $("usageFilterQuery").value.trim().toLowerCase();
  const status = $("usageFilterStatus").value;
  const model = $("usageFilterModel").value;
  return (usageData.keys || []).filter((key) => {
    if (selectedKeyIds.size && !selectedKeyIds.has(key.id)) return false;
    if (query && !`${key.name} ${key.hint || ""}`.toLowerCase().includes(query)) return false;
    if (status !== "all" && keyStatus(key) !== status) return false;
    if (model && key.allowedModels?.length && !key.allowedModels.includes(model)) return false;
    return true;
  });
}

function aggregateHistory(keys, bounds) {
  const map = new Map();
  for (const key of keys) {
    for (const row of key.usage?.history || []) {
      if (!inRange(row.date, bounds)) continue;
      const current = map.get(row.date) || { date: row.date, requests: 0, tokens: 0 };
      current.requests += row.requests || 0;
      current.tokens += row.tokens || 0;
      map.set(row.date, current);
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function renderStats(keys, bounds) {
  const today = keys.reduce((sum, key) => sum + (key.usage?.day || 0), 0);
  const month = keys.reduce((sum, key) => sum + (key.usage?.month || 0), 0);
  const totalRequests = keys.reduce((sum, key) => sum + (key.usage?.totalRequests || 0), 0);
  const totalTokens = keys.reduce((sum, key) => sum + (key.usage?.totalTokens || 0), 0);
  let stats;
  if (bounds.active) {
    const scoped = keys.reduce(
      (sum, key) => {
        const range = rangeForKey(key, bounds);
        sum.requests += range.requests;
        sum.tokens += range.tokens;
        return sum;
      },
      { requests: 0, tokens: 0 },
    );
    stats = [
      stat("区间请求", scoped.requests),
      stat("区间 tokens", scoped.tokens),
      stat("今日请求", today),
      stat("本月请求", month),
      stat("密钥数", keys.length),
    ];
  } else {
    stats = [
      stat("今日请求", today),
      stat("本月请求", month),
      stat("累计请求", totalRequests),
      stat("累计 tokens", totalTokens),
      stat("密钥数", keys.length),
    ];
  }
  $("usageStats").replaceChildren(...stats);
}

function renderChart(keys, bounds) {
  const chart = $("usageChart");
  chart.replaceChildren();
  const history = aggregateHistory(keys, bounds).slice(-60);
  const title = $("usageChartTitle");
  title.textContent = bounds.active
    ? `筛选趋势 · ${bounds.from || "最早"} ~ ${bounds.to || "今天"}`
    : "最近 30 天";
  if (!history.length) {
    chart.append(Object.assign(document.createElement("div"), { className: "admin-empty", textContent: "还没有历史数据" }));
    return;
  }
  const max = Math.max(1, ...history.map((row) => row.requests));
  for (const row of history) {
    const col = document.createElement("div");
    col.className = "chart-col";
    col.title = `${row.date} · ${row.requests} 次 · ${row.tokens} tokens`;
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${Math.max(3, Math.round((row.requests / max) * 100))}%`;
    const label = document.createElement("span");
    label.textContent = row.date.slice(5);
    col.append(bar, label);
    chart.append(col);
  }
}

function renderTable(keys, bounds) {
  const head = $("usageTableHead");
  const headers = bounds.active
    ? ["密钥", "区间请求", "区间 tokens", "分钟", "今日", "本月", "累计请求", "累计 tokens", "配额"]
    : ["密钥", "分钟", "今日", "本月", "累计请求", "累计 tokens", "配额"];
  const headRow = document.createElement("tr");
  for (const label of headers) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  }
  head.replaceChildren(headRow);

  const tbody = $("usageTable");
  tbody.replaceChildren();
  for (const key of keys) {
    const row = document.createElement("tr");
    const values = [key.name];
    if (bounds.active) {
      const range = rangeForKey(key, bounds);
      values.push(range.requests, range.tokens);
    }
    values.push(
      key.usage?.minute ?? 0,
      key.usage?.day ?? 0,
      key.usage?.month ?? 0,
      key.usage?.totalRequests ?? 0,
      key.usage?.totalTokens ?? 0,
      quota(key),
    );
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (value === key.name) cell.className = "cell-main";
      row.append(cell);
    }
    tbody.append(row);
  }
  $("usageEmpty").classList.toggle("hidden", keys.length > 0);
  $("usageEmpty").textContent = usageData.keys.length
    ? "没有匹配当前筛选条件的密钥。"
    : "还没有调用记录。";
}

function renderKeyChips() {
  const picker = $("usageKeyChips");
  picker.replaceChildren();
  const keys = usageData.keys || [];
  const all = document.createElement("button");
  all.type = "button";
  all.className = "model-chip";
  all.textContent = "全部密钥";
  all.classList.toggle("active", selectedKeyIds.size === 0);
  all.addEventListener("click", () => {
    selectedKeyIds.clear();
    render();
  });
  picker.append(all);
  for (const key of keys) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "model-chip usage-key-chip";
    chip.textContent = key.name;
    chip.title = `${key.name} · ${key.disabled ? "已停用" : "可用"}`;
    chip.classList.toggle("active", selectedKeyIds.has(key.id));
    chip.addEventListener("click", () => {
      if (selectedKeyIds.size === 0) {
        selectedKeyIds.add(key.id);
      } else if (selectedKeyIds.has(key.id)) {
        selectedKeyIds.delete(key.id);
      } else {
        selectedKeyIds.add(key.id);
        if (selectedKeyIds.size === keys.length) selectedKeyIds.clear();
      }
      render();
    });
    picker.append(chip);
  }
  if (!keys.length) {
    picker.append(Object.assign(document.createElement("span"), {
      className: "admin-hint",
      textContent: "还没有密钥。",
    }));
  }
}

function renderFilterSummary(keys, bounds) {
  const total = usageData.keys.length;
  const visible = keys.length;
  const parts = [`显示 ${visible} / ${total} 个密钥`];
  if (selectedKeyIds.size) parts.push(`已选 ${selectedKeyIds.size} 个`);
  if ($("usageFilterStatus").value !== "all") {
    parts.push(`状态：${$("usageFilterStatus").selectedOptions[0].textContent}`);
  }
  if ($("usageFilterModel").value) parts.push(`模型：${$("usageFilterModel").value}`);
  if ($("usageFilterQuery").value.trim()) parts.push(`搜索：${$("usageFilterQuery").value.trim()}`);
  if (bounds.active) parts.push(`UTC ${bounds.from || "最早"} ~ ${bounds.to || "今天"}`);
  $("usageFilterSummary").textContent = parts.join(" · ");
  $("usageFilterCount").textContent = `${visible} / ${total}`;
}

function render() {
  const bounds = dateBounds();
  for (const id of [...selectedKeyIds]) {
    if (!usageData.keys.some((key) => key.id === id)) selectedKeyIds.delete(id);
  }
  const keys = filteredKeys();
  renderKeyChips();
  renderStats(keys, bounds);
  renderChart(keys, bounds);
  renderTable(keys, bounds);
  renderFilterSummary(keys, bounds);
}

function renderModelOptions() {
  const select = $("usageFilterModel");
  const current = select.value;
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部模型";
  select.append(all);
  for (const model of availableModels) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    select.append(option);
  }
  select.value = availableModels.includes(current) ? current : "";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportCurrent() {
  const bounds = dateBounds();
  const keys = filteredKeys();
  const header = ["key_id", "name", "hint", "status", "requests_per_minute", "requests_per_day", "requests_per_month"];
  if (bounds.active) header.push("range_requests", "range_tokens");
  header.push("minute_used", "day_used", "month_used", "total_requests", "total_tokens", "quota");
  const rows = [header];
  for (const key of keys) {
    const l = key.limits || {};
    const row = [
      key.id,
      key.name,
      key.hint || "",
      keyStatus(key),
      l.requestsPerMinute || 0,
      l.requestsPerDay || 0,
      l.requestsPerMonth || 0,
    ];
    if (bounds.active) {
      const range = rangeForKey(key, bounds);
      row.push(range.requests, range.tokens);
    }
    row.push(
      key.usage?.minute ?? 0,
      key.usage?.day ?? 0,
      key.usage?.month ?? 0,
      key.usage?.totalRequests ?? 0,
      key.usage?.totalTokens ?? 0,
      quota(key),
    );
    rows.push(row);
  }
  const text = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `usage-filtered-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  setStatus(`已导出 ${keys.length} 个密钥的用量`);
}

function resetFilters() {
  $("usageFilterQuery").value = "";
  $("usageFilterStatus").value = "all";
  $("usageFilterModel").value = "";
  $("usageFilterFrom").value = "";
  $("usageFilterTo").value = "";
  selectedKeyIds.clear();
  render();
}

function bindFilters() {
  $("usageFilters").addEventListener("submit", (event) => event.preventDefault());
  $("usageFilterQuery").addEventListener("input", render);
  for (const id of ["usageFilterStatus", "usageFilterModel", "usageFilterFrom", "usageFilterTo"]) {
    $(id).addEventListener("change", render);
  }
  $("usageFilterReset").addEventListener("click", resetFilters);
  $("usageExport").addEventListener("click", exportCurrent);
}

async function init() {
  try {
    const me = await api("/auth/me");
    csrf = me.csrfToken;
    role = me.user.role;
    operator = me.user.username;
    if (role !== "admin") { location.replace("/console"); return; }
    availableModels = Array.isArray(me.models) ? me.models.map((name) => String(name)) : [];
    $("userLabel").textContent = `${operator} · 管理员`;
    window.NGZRNAV?.render(role, me.features);
    renderModelOptions();
    bindFilters();
    const data = await api("/op/api/usage");
    usageData = { keys: Array.isArray(data.keys) ? data.keys : [], totals: data.totals || {}, history: data.history || [] };
    for (const model of usageData.keys.flatMap((key) => key.allowedModels || [])) {
      if (!availableModels.includes(model)) availableModels.push(model);
    }
    renderModelOptions();
    render();
    setStatus("已登录");
    $("logout").addEventListener("click", async () => {
      try { await api("/auth/logout", { method: "POST", body: {} }); } catch { /* leave */ }
      location.replace("/login");
    });
  } catch (error) {
    setStatus("加载失败", true);
  }
}
init();
