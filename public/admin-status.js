const $ = (id) => document.getElementById(id);
let csrf = "";
let role = "";
let operator = "";

async function api(path, options = {}) {
  const headers = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrf;
  const response = await fetch(path, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  if (response.status === 401) { location.replace(`/login?next=${encodeURIComponent(location.pathname)}`); throw new Error("请重新登录"); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `请求失败（${response.status}）`);
  return data;
}

function setStatus(text, bad = false) { $("status").textContent = text; $("status").classList.toggle("err", bad); }

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

function bytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function render(data) {
  const q = data.queue || {};
  const stats = $("statusStats");
  stats.replaceChildren(
    stat("运行时间", `${Math.floor((data.uptimeSec || 0) / 60)} 分`),
    stat("待接单", q.queued ?? 0),
    stat("进行中", (q.claimed || 0) + (q.streaming || 0) + (q.finishing || 0)),
    stat("票据总数", data.ticketsTotal ?? 0),
    stat("内存", `${data.memoryMb || 0} MB`),
    stat("版本", data.version || "—"),
  );
  const readonly = $("statusReadonly");
  readonly.replaceChildren();
  const pairs = [
    ["Node", data.node],
    ["模式", data.protocol?.mode || "—"],
    ["默认模型", data.protocol?.default_model || "—"],
    ["并发上限", data.settings?.limits?.maxConcurrentPerKey],
    ["等待超时", `${data.settings?.queue?.waitTimeoutMs} ms`],
    ["回复超时", `${data.settings?.queue?.responseTimeoutMs} ms`],
    ["通知", data.settings?.features?.browserNotifications ? "开启" : "关闭"],
    ["审计", data.settings?.features?.auditLog ? "开启" : "关闭"],
  ];
  for (const [key, value] of pairs) {
    const cell = document.createElement("div");
    cell.className = "readonly-item";
    const k = document.createElement("span");
    k.textContent = key;
    const v = document.createElement("code");
    v.textContent = String(value ?? "—");
    cell.append(k, v);
    readonly.append(cell);
  }
  const storage = $("storageTable");
  storage.replaceChildren();
  for (const [name, info] of Object.entries(data.storage || {})) {
    const row = document.createElement("tr");
    for (const value of [name, info.exists ? "是" : "否", bytes(info.bytes || 0), info.mode || "—"]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (value === name) cell.className = "cell-main";
      row.append(cell);
    }
    storage.append(row);
  }
  const audit = $("recentAudit");
  audit.replaceChildren();
  for (const event of data.audit || []) {
    const row = document.createElement("tr");
    for (const value of [new Date(event.at).toLocaleString(), event.actor, event.action, event.target || "—"]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    audit.append(row);
  }
}

async function load() {
  const data = await api("/op/api/status");
  render(data);
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
    setStatus("已登录");
    $("refresh").addEventListener("click", () => load().catch(() => {}));
    $("logout").addEventListener("click", async () => {
      try { await api("/auth/logout", { method: "POST", body: {} }); } catch { /* leave */ }
      location.replace("/login");
    });
  } catch (error) {
    setStatus("加载失败", true);
  }
}
init();
