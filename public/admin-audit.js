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

function setStatus(text, bad = false) { $("status").textContent = text; $("status").classList.toggle("err", bad); }

function render(events) {
  const tbody = $("auditTable");
  tbody.replaceChildren();
  $("auditCount").textContent = `${events.length} 条`;
  $("auditEmpty").classList.toggle("hidden", events.length > 0);
  for (const event of events) {
    const row = document.createElement("tr");
    for (const value of [new Date(event.at).toLocaleString(), event.actor, event.action, event.target || "—", event.ip || "—", event.detail || "—"]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (value === event.action) cell.className = "mono";
      row.append(cell);
    }
    tbody.append(row);
  }
}

async function load() {
  const params = new URLSearchParams();
  if ($("filterActor").value.trim()) params.set("actor", $("filterActor").value.trim());
  if ($("filterAction").value.trim()) params.set("action", $("filterAction").value.trim());
  const query = params.toString();
  const exportLink = document.getElementById("exportAudit");
  if (exportLink) exportLink.href = `/op/api/audit.csv${query ? `?${query}` : ""}`;
  const data = await api(`/op/api/audit${query ? `?${query}` : ""}`);
  render(Array.isArray(data.events) ? data.events : []);
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
    $("auditFilters").addEventListener("submit", (event) => { event.preventDefault(); load().catch(() => {}); });
    $("auditReset").addEventListener("click", () => { $("filterActor").value = ""; $("filterAction").value = ""; load().catch(() => {}); });
    $("logout").addEventListener("click", async () => {
      try { await api("/auth/logout", { method: "POST", body: {} }); } catch { /* leave */ }
      location.replace("/login");
    });
  } catch (error) {
    setStatus("加载失败", true);
  }
}
init();
