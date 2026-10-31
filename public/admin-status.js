const $ = (id) => document.getElementById(id);
let csrf = "";
let role = "";
let operator = "";
let refreshTimer = null;

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

function setStatus(text, bad = false) {
  $("status").textContent = text;
  $("status").classList.toggle("err", bad);
}

function duration(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function bytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function heroMetric(label, value, tone = "") {
  const item = document.createElement("div");
  item.className = `hero-metric ${tone}`;
  const l = document.createElement("span");
  l.textContent = label;
  const v = document.createElement("strong");
  v.textContent = value;
  item.append(l, v);
  return item;
}

function vital(icon, label, value, sub, tone = "", meter = null) {
  const card = document.createElement("div");
  card.className = `vital-card ${tone}`;
  const top = document.createElement("div");
  top.className = "vital-top";
  const glyph = document.createElement("span");
  glyph.className = "vital-glyph";
  glyph.textContent = icon;
  top.append(glyph, Object.assign(document.createElement("span"), { className: "vital-label", textContent: label }));
  const number = document.createElement("div");
  number.className = "vital-value";
  number.textContent = value;
  const caption = document.createElement("div");
  caption.className = "vital-sub";
  caption.textContent = sub || "";
  card.append(top, number, caption);
  if (meter !== null) {
    const track = document.createElement("div");
    track.className = "vital-meter";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(0, Math.min(100, meter))}%`;
    track.append(fill);
    card.append(track);
  }
  return card;
}

function flowStep(label, count, tone, max) {
  const step = document.createElement("div");
  step.className = `flow-step ${tone}`;
  const marker = document.createElement("span");
  marker.className = "flow-marker";
  const name = document.createElement("div");
  name.className = "flow-name";
  name.textContent = label;
  const value = document.createElement("div");
  value.className = "flow-value";
  value.textContent = count;
  const bar = document.createElement("div");
  bar.className = "flow-bar";
  const fill = document.createElement("span");
  fill.style.width = `${Math.round((count / max) * 100)}%`;
  bar.append(fill);
  step.append(marker, name, value, bar);
  return step;
}

let lastLoadedAt = 0;

function updateSyncStamp() {
  const el = $("lastSync");
  if (!el) return;
  if (!lastLoadedAt) {
    el.textContent = "尚未同步";
    return;
  }
  const next = Math.max(0, 15 - Math.floor((Date.now() - lastLoadedAt) / 1000));
  el.textContent = `同步于 ${new Date(lastLoadedAt).toLocaleTimeString()} · ${next}s 后刷新`;
}

function render(data) {
  const q = data.queue || {};
  const active = (q.claimed || 0) + (q.streaming || 0) + (q.finishing || 0);
  const total = data.ticketsTotal || 0;
  const alerts = data.alerts?.active || [];
  const degraded = alerts.length > 0;
  const health = $("heroHealth");
  if (health) {
    health.classList.toggle("degraded", degraded);
    health.classList.toggle("online", !degraded);
  }
  $("heroHealthText").textContent = degraded ? `检测到 ${alerts.length} 项告警` : "运行正常";
  const memory = data.memory || {};
  const rss = memory.rssMb ?? data.memoryMb ?? 0;
  const heapUsed = memory.heapUsedMb ?? 0;
  const heapTotal = memory.heapTotalMb ?? 0;
  const load1 = data.loadAverage?.[0] ?? 0;
  const cpuCount = data.cpuCount ?? 1;
  const loadPercent = Math.min(100, Math.round((load1 / Math.max(1, cpuCount)) * 100));
  const heapPercent = heapTotal ? Math.min(100, Math.round((heapUsed / heapTotal) * 100)) : 0;
  const heroEl = document.querySelector(".status-hero");
  heroEl?.classList.toggle("degraded", degraded);
  $("heroState").textContent = degraded ? "DEGRADED" : "ONLINE";
  $("heroUptime").textContent = `uptime ${duration(data.uptimeSec)}`;
  const hero = $("heroMetrics");
  hero.replaceChildren(
    heroMetric("VERSION", data.version || "—", "accent"),
    heroMetric("NODE", data.node || "—"),
    heroMetric("LOAD 1M", `${load1.toFixed(2)} / ${cpuCount}`),
    heroMetric("RSS", `${rss} MB`),
  );
  lastLoadedAt = Date.now();
  updateSyncStamp();

  const alertStrip = $("alertStrip");
  alertStrip.classList.toggle("hidden", alerts.length === 0);
  if (alerts.length) {
    const labels = { queue_depth: "队列积压", oldest_wait: "最老请求等待超时" };
    alertStrip.textContent = `● ${alerts.map((key) => labels[key] || key).join(" / ")} · 当前待接单 ${data.alerts?.queueDepth ?? q.queued ?? 0} · 最长等待 ${Math.round((data.alerts?.oldestWaitMs || 0) / 1000)}s`;
  }

  $("statusStats").replaceChildren(
    vital("◷", "运行时间", duration(data.uptimeSec), "process uptime", "cyan"),
    vital("⌁", "待接单", q.queued ?? 0, "waiting requests", (q.queued || 0) > 0 ? "warm" : ""),
    vital("◉", "进行中", active, "claimed + streaming", active > 0 ? "violet" : ""),
    vital("▤", "内存票据", total, "in-memory tickets", ""),
    vital("▣", "内存", `${rss} MB`, `heap ${heapUsed}/${heapTotal} MB`, "", heapPercent),
    vital("◌", "系统负载", `${load1.toFixed(2)} / ${cpuCount}`, `1m load · ${loadPercent}%`, loadPercent > 80 ? "warm" : "", loadPercent),
  );

  const flow = $("queueFlow");
  const max = Math.max(1, q.queued || 0, q.claimed || 0, q.streaming || 0, q.finishing || 0);
  const idle = !(q.queued || q.claimed || q.streaming || q.finishing);
  flow.dataset.idle = idle ? "true" : "false";
  if ($("flowNote")) $("flowNote").textContent = idle ? "当前无排队活动" : "当前队列切片";
  flow.replaceChildren(
    flowStep("待接单", q.queued ?? 0, "queued", max),
    flowStep("已认领", q.claimed ?? 0, "claimed", max),
    flowStep("流式中", q.streaming ?? 0, "streaming", max),
    flowStep("收尾中", q.finishing ?? 0, "finishing", max),
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
    ["审计", data.settings?.features?.auditLog ? "开启" : "关闭"],
    ["本进程请求 / 完成", `${data.stats?.created ?? 0} / ${data.stats?.completed ?? 0}`],
    ["本进程失败 / 拒绝", `${data.stats?.failed ?? 0} / ${data.stats?.cancelled ?? 0}`],
    ["平均等待", `${data.stats?.avgClaimMs ?? 0} ms`],
    ["平均处理", `${data.stats?.avgHandleMs ?? 0} ms`],
  ];
  for (const [key, value] of pairs) {
    const cell = document.createElement("div");
    cell.className = "runtime-item";
    const k = document.createElement("span");
    k.textContent = key;
    const v = document.createElement("code");
    v.textContent = String(value ?? "—");
    cell.append(k, v);
    readonly.append(cell);
  }

  const vault = $("statusVault");
  vault.replaceChildren();
  const storage = Object.entries(data.storage || {});
  const maxBytes = Math.max(1, ...storage.map(([, info]) => info.bytes || 0));
  const storageLabels = {
    users: "账号库",
    api_keys: "调用密钥",
    state: "旧版 state（可选）",
    state_db: "状态数据库",
    history: "历史索引",
    usage: "调用用量",
    models: "模型清单",
    attachments: "附件目录",
    audit: "审计日志",
  };
  for (const [name, info] of storage) {
    const row = document.createElement("div");
    row.className = `vault-row ${info.exists ? "present" : "missing"}`;
    const head = document.createElement("div");
    head.className = "vault-head";
    const label = document.createElement("span");
    label.textContent = storageLabels[name] || name;
    const state = document.createElement("span");
    const legacyOptional = name === "state";
    state.className = `vault-state ${info.exists ? "ok" : legacyOptional ? "optional" : "off"}`;
    state.textContent = info.exists ? "ONLINE" : legacyOptional ? "未使用" : "MISSING";
    head.append(label, state);
    const meta = document.createElement("div");
    meta.className = "vault-meta";
    const size = document.createElement("span");
    size.textContent = bytes(info.bytes || 0);
    const mode = document.createElement("span");
    mode.textContent = `mode ${info.mode || "—"}`;
    meta.append(size, mode);
    const track = document.createElement("div");
    track.className = "vault-track";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(2, Math.round(((info.bytes || 0) / maxBytes) * 100))}%`;
    track.append(fill);
    row.append(head, meta, track);
    vault.append(row);
  }

  const feed = $("recentAudit");
  feed.replaceChildren();
  const actionLabels = {
    "ticket.claim": "认领",
    "ticket.finish": "完成",
    "ticket.meta": "修改标签",
    "ai.relay": "AI 中继",
    "settings.update": "修改设置",
    "key.create": "新增密钥",
    "key.update": "修改密钥",
    "key.delete": "删除密钥",
    "user.update": "修改用户",
    "login-ok": "登录成功",
    "login-fail": "登录失败",
  };
  for (const event of data.audit || []) {
    const item = document.createElement("div");
    item.className = "feed-item";
    const dot = document.createElement("span");
    dot.className = "feed-dot";
    const body = document.createElement("div");
    body.className = "feed-body";
    const top = document.createElement("div");
    top.className = "feed-top";
    const action = document.createElement("strong");
    action.textContent = actionLabels[event.action] || event.action || "event";
    const time = document.createElement("span");
    time.textContent = new Date(event.at).toLocaleTimeString();
    top.append(action, time);
    const detail = document.createElement("div");
    detail.className = "feed-detail";
    detail.textContent = [event.actor || "—", event.target || ""].filter(Boolean).join(" → ");
    body.append(top, detail);
    item.append(dot, body);
    feed.append(item);
  }
  if (!data.audit?.length) {
    feed.append(Object.assign(document.createElement("div"), { className: "admin-empty", textContent: "还没有操作信号。" }));
  }
}

function initPointerMotion() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const hero = document.querySelector(".status-hero");
  const cards = $("statusStats");
  if (!hero || !cards) return;

  hero.addEventListener("pointermove", (event) => {
    const rect = hero.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    hero.style.setProperty("--mx", `${x}px`);
    hero.style.setProperty("--my", `${y}px`);
    hero.style.setProperty("--px", ((x / rect.width - 0.5) * 2).toFixed(3));
    hero.style.setProperty("--py", ((y / rect.height - 0.5) * 2).toFixed(3));
  });
  hero.addEventListener("pointerleave", () => {
    hero.style.setProperty("--mx", "72%");
    hero.style.setProperty("--my", "18%");
    hero.style.setProperty("--px", "0");
    hero.style.setProperty("--py", "0");
  });

  const clearCard = (card) => {
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--gx", "50%");
    card.style.setProperty("--gy", "50%");
  };
  cards.addEventListener("pointermove", (event) => {
    const card = event.target.closest(".vital-card");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    for (const other of cards.querySelectorAll(".vital-card")) {
      if (other !== card) clearCard(other);
    }
    card.style.setProperty("--ry", `${((x / rect.width - 0.5) * 7).toFixed(2)}deg`);
    card.style.setProperty("--rx", `${(-(y / rect.height - 0.5) * 6).toFixed(2)}deg`);
    card.style.setProperty("--gx", `${((x / rect.width) * 100).toFixed(1)}%`);
    card.style.setProperty("--gy", `${((y / rect.height) * 100).toFixed(1)}%`);
  });
  cards.addEventListener("pointerleave", () => {
    for (const card of cards.querySelectorAll(".vital-card")) clearCard(card);
  });
}

async function load() {
  const button = $("refresh");
  button.classList.add("busy");
  try {
    const data = await api("/op/api/status");
    render(data);
    setStatus("已同步");
  } finally {
    button.classList.remove("busy");
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
    await load();
    initPointerMotion();
    $("refresh").addEventListener("click", () => load().catch(() => {}));
    const syncTicker = setInterval(updateSyncStamp, 1_000);
    refreshTimer = setInterval(() => {
      if (!document.hidden) load().catch(() => {});
    }, 15_000);
    $("logout").addEventListener("click", async () => {
      clearInterval(refreshTimer);
      try { await api("/auth/logout", { method: "POST", body: {} }); } catch { /* leave */ }
      location.replace("/login");
    });
  } catch (error) {
    setStatus("加载失败", true);
  }
}
init();
