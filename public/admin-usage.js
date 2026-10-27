const $ = (id) => document.getElementById(id);
let csrf = "";
let role = "";
let operator = "";

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

function render(data) {
  const keys = Array.isArray(data.keys) ? data.keys : [];
  const totals = data.totals || {};
  const stats = $("usageStats");
  stats.replaceChildren(
    stat("今日请求", keys.reduce((sum, key) => sum + (key.usage?.day || 0), 0)),
    stat("本月请求", keys.reduce((sum, key) => sum + (key.usage?.month || 0), 0)),
    stat("累计请求", totals.requests || 0),
    stat("累计 tokens", totals.tokens || 0),
    stat("密钥数", keys.length),
  );
  const chart = $("usageChart");
  chart.replaceChildren();
  const history = Array.isArray(data.history) ? data.history : [];
  const max = Math.max(1, ...history.map((row) => row.requests));
  if (!history.length) {
    chart.append(Object.assign(document.createElement("div"), { className: "admin-empty", textContent: "还没有历史数据" }));
  } else {
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
  const tbody = $("usageTable");
  tbody.replaceChildren();
  $("usageEmpty").classList.toggle("hidden", keys.length > 0);
  for (const key of keys) {
    const row = document.createElement("tr");
    for (const value of [
      key.name,
      key.usage?.minute ?? 0,
      key.usage?.day ?? 0,
      key.usage?.month ?? 0,
      key.usage?.totalRequests ?? 0,
      key.usage?.totalTokens ?? 0,
      quota(key),
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (value === key.name) cell.className = "cell-main";
      row.append(cell);
    }
    tbody.append(row);
  }
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
    const data = await api("/op/api/usage");
    render(data);
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
