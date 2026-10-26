/* Human Provider — operator console (vanilla JS, no build step) */

const $ = (id) => document.getElementById(id);

const els = {
  userLabel: $("userLabel"),
  usersBtn: $("usersBtn"),
  logout: $("logout"),
  usersModal: $("usersModal"),
  usersClose: $("usersClose"),
  userCreateForm: $("userCreateForm"),
  newUsername: $("newUsername"),
  newPassword: $("newPassword"),
  newRole: $("newRole"),
  userCreateBtn: $("userCreateBtn"),
  userList: $("userList"),
  usersError: $("usersError"),
  keysBtn: $("keysBtn"),
  keysModal: $("keysModal"),
  keysClose: $("keysClose"),
  keyCreateForm: $("keyCreateForm"),
  newKeyName: $("newKeyName"),
  newKeyRpm: $("newKeyRpm"),
  newKeyPerDay: $("newKeyPerDay"),
  newKeyPerMonth: $("newKeyPerMonth"),
  newKeyConcurrent: $("newKeyConcurrent"),
  newKeyModels: $("newKeyModels"),
  newKeyExpires: $("newKeyExpires"),
  keyCreateBtn: $("keyCreateBtn"),
  keyList: $("keyList"),
  keysError: $("keysError"),
  newKeyBox: $("newKeyBox"),
  newKeyValue: $("newKeyValue"),
  copyKeyBtn: $("copyKeyBtn"),
  status: $("status"),
  statusDot: $("statusDot"),
  stats: $("stats"),
  queue: $("queue"),
  queueSearch: $("queueSearch"),
  queueFilters: $("queueFilters"),
  detail: $("detail"),
  autoclaim: $("autoclaim"),
  toast: $("toast"),
  commandTicket: $("commandTicket"),
  commandState: $("commandState"),
  commandHint: $("commandHint"),
  cmdClaim: $("cmdClaim"),
  cmdPush: $("cmdPush"),
  cmdFinish: $("cmdFinish"),
  cmdRelease: $("cmdRelease"),
  cmdRefuse: $("cmdRefuse"),
  cmdCancel: $("cmdCancel"),
  cmdShortcuts: $("cmdShortcuts"),
  shortcutModal: $("shortcutModal"),
  shortcutList: $("shortcutList"),
  shortcutClose: $("shortcutClose"),
  shortcutReset: $("shortcutReset"),
};

const state = {
  user: null,
  operator: "",
  role: "",
  csrfToken: "",
  connected: false,
  me: null,
  config: null,
  tickets: [],
  stats: null,
  selectedId: null,
  drafts: new Map(),
  thinkingDrafts: new Map(),
  toolDrafts: new Map(),
  busy: false,
  pollTimer: null,
  lastQueued: null,
  queueQuery: "",
  queueFilter: "all",
  shortcuts: null,
  recordingShortcut: null,
};

const SHORTCUT_DEFS = [
  { id: "finish", label: "完成并发送", desc: "提交回复并结束票据" },
  { id: "push", label: "推送片段", desc: "立即发送当前草稿" },
  { id: "claim", label: "认领票据", desc: "认领当前选中的待认领票据" },
  { id: "release", label: "放回队列", desc: "把未开始的票据放回队列" },
  { id: "refuse", label: "拒答", desc: "以 content_filter 结束" },
  { id: "cancel", label: "取消请求", desc: "中止当前请求" },
  { id: "focus", label: "聚焦回复框", desc: "把光标放到回复编辑器" },
  { id: "next", label: "下一张票据", desc: "在队列中切换选中票据" },
  { id: "help", label: "快捷键面板", desc: "打开这个设置窗口" },
];

const DEFAULT_SHORTCUTS = Object.freeze({
  finish: "Mod+Enter",
  push: "Mod+Shift+Enter",
  claim: "Alt+C",
  release: "Alt+B",
  refuse: "Alt+R",
  cancel: "Alt+X",
  focus: "Alt+E",
  next: "Alt+J",
  help: "Mod+/",
});

let detail = null;
let toastTimer = null;
let audioCtx = null;

/* ------------------------------ helpers ------------------------------ */

function el(tag, className = "", text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

function badge(text, tone, extra = "") {
  return el("span", `badge ${tone || ""} ${extra}`.trim(), text);
}

const STATE_LABELS = {
  queued: "待认领",
  claimed: "已认领",
  streaming: "流式中",
  finishing: "收尾中",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const ROLE_LABELS = {
  system: "system",
  developer: "developer",
  user: "user",
  assistant: "assistant",
  tool: "tool",
  function: "function",
};

function isActive(ticket) {
  return ["queued", "claimed", "streaming", "finishing"].includes(ticket.state);
}

function purposeOf(ticket) {
  const messages = ticket.messages || [];
  if (messages.some((message) => message.role === "tool")) {
    return {
      id: "tool_result",
      queueLabel: "工具续跑",
      detailLabel: "工具结果续跑",
      tone: "active",
      rank: 1,
    };
  }
  const tools = ticket.tools || [];
  if (tools.length === 0 && messages.length <= 3) {
    const text = messages
      .filter((message) => message.role === "system" || message.role === "user")
      .map((message) => message.content || "")
      .join("\n");
    if (/create a concise title|generate the session title|session title/i.test(text)) {
      return {
        id: "session_title",
        queueLabel: "会话标题",
        detailLabel: "会话标题请求",
        tone: "queued",
        rank: 2,
      };
    }
  }
  return { id: "chat", queueLabel: "主请求", detailLabel: "主请求", tone: "mine", rank: 0 };
}

function queuePriority(a, b) {
  return purposeOf(a).rank - purposeOf(b).rank || a.createdAt - b.createdAt;
}

function isContextMessage(message) {
  if (message.role === "system" || message.role === "developer") return true;
  if (message.role !== "user") return false;
  const text = (message.content || "").trimStart();
  return (
    text.startsWith("Current runtime context.") ||
    text.startsWith("<system-reminder>") ||
    text.startsWith("Time sampled while preparing") ||
    text.startsWith("Browser time zone for this request") ||
    text.startsWith("Elapsed since the preceding") ||
    text.startsWith("Current working directory:") ||
    text.startsWith("Current DSH file policy:") ||
    text.startsWith("Approval policy:")
  );
}

function messageBuckets(ticket) {
  const conversation = [];
  const context = [];
  (ticket.messages || []).forEach((message, index) => {
    (isContextMessage(message) ? context : conversation).push({ message, index });
  });
  return { conversation, context };
}

function stateTone(value) {
  if (value === "queued") return "queued";
  if (["claimed", "streaming", "finishing"].includes(value)) return "active";
  if (value === "done") return "done";
  return value;
}

function shortId(id) {
  return String(id || "").replace(/^chatcmpl-/, "").slice(0, 10);
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "—";
  const value = Math.max(0, Math.round(ms));
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function fmtTime(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
}

function prettyArgs(raw) {
  if (typeof raw !== "string") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function previewOf(ticket) {
  const messages = ticket.messages || [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return (messages[i].content || "").replace(/\s+/g, " ").trim();
    }
  }
  if (messages.length) return (messages[messages.length - 1].content || "").replace(/\s+/g, " ").trim();
  return "(空请求)";
}

function setStatus(tone, text) {
  els.status.textContent = text;
  els.statusDot.className = "status-dot";
  if (tone === "ok") els.statusDot.classList.add("ok");
  else if (tone === "err" || tone === "warn") els.statusDot.classList.add("err");
}

function toast(message, duration = 2800) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), duration);
}


function beep() {
  try {
    if (!state.connected) return;
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.035;
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.09);
  } catch {
    /* audio is a nice-to-have */
  }
}

function maybeBeep() {
  const queued = state.stats?.queued ?? state.tickets.filter((ticket) => ticket.state === "queued").length;
  if (state.lastQueued !== null && queued > state.lastQueued) beep();
  state.lastQueued = queued;
}

/* ------------------------------ API ------------------------------ */

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD" && state.csrfToken) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || `${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/* ------------------------------ connection / polling ------------------------------ */

function redirectToLogin() {
  const next = encodeURIComponent(`${location.pathname}${location.search}`);
  location.replace(`/login?next=${next}`);
}

async function loadSession() {
  setStatus("waiting", "验证会话…");
  try {
    const me = await api("/auth/me");
    state.me = me;
    state.user = me.user;
    state.operator = me.user.username;
    state.role = me.user.role;
    state.csrfToken = me.csrfToken;
    state.config = me.config || null;
    state.connected = true;
    state.lastQueued = null;
    els.userLabel.textContent = `${me.user.username} · ${me.user.role === "admin" ? "管理员" : "人工回复员"}`;
    els.usersBtn.classList.toggle("hidden", me.user.role !== "admin");
    els.keysBtn.classList.toggle("hidden", me.user.role !== "admin");
    setStatus("ok", `${me.user.username} 已登录`);
    clearTimeout(state.pollTimer);
    await pollOnce();
  } catch (error) {
    if (error.status === 401) {
      redirectToLogin();
      return;
    }
    console.error("[nenggong-zhiren] session load failed:", error);
    setStatus("err", "会话加载失败");
    toast(`无法加载会话：${error.message}`, 6000);
  }
}

async function logout() {
  if (state.busy) return;
  try {
    await api("/auth/logout", { method: "POST", body: {} });
  } catch (error) {
    if (error.status !== 401) toast(`退出失败：${error.message}`);
  } finally {
    state.connected = false;
    clearTimeout(state.pollTimer);
    location.replace("/login");
  }
}

function setUsersError(message = "") {
  els.usersError.textContent = message;
}

function openUsers() {
  if (state.role !== "admin") return;
  setUsersError("");
  els.usersModal.classList.remove("hidden");
  loadUsers().catch((error) => setUsersError(error.message));
}

function closeUsers() {
  els.usersModal.classList.add("hidden");
}

function renderUsers(users) {
  els.userList.replaceChildren();
  for (const user of users) {
    const row = el("div", "user-row");
    row.append(el("div", "user-name", user.username));
    row.append(badge(user.role === "admin" ? "管理员" : "人工回复员", user.role === "admin" ? "warn" : ""));
    row.append(el("div", "user-created", new Date(user.createdAt).toLocaleString()));
    const actions = el("div", "user-actions");
    const reset = el("button", "btn ghost", "重置密码");
    reset.type = "button";
    reset.addEventListener("click", () => resetUserPassword(user.username));
    actions.append(reset);
    if (user.username !== state.operator) {
      const remove = el("button", "btn danger", "删除");
      remove.type = "button";
      remove.addEventListener("click", () => deleteUser(user.username));
      actions.append(remove);
    }
    row.append(actions);
    els.userList.append(row);
  }
  if (!users.length) els.userList.append(el("div", "hint", "（暂无用户）"));
}

async function loadUsers() {
  const data = await api("/op/api/users");
  renderUsers(Array.isArray(data.users) ? data.users : []);
}

async function createUser(event) {
  event.preventDefault();
  if (state.busy) return;
  setUsersError("");
  state.busy = true;
  els.userCreateBtn.disabled = true;
  try {
    await api("/op/api/users", {
      method: "POST",
      body: {
        username: els.newUsername.value.trim(),
        password: els.newPassword.value,
        role: els.newRole.value,
      },
    });
    els.newUsername.value = "";
    els.newPassword.value = "";
    els.newUsername.focus();
    toast("用户已添加");
    await loadUsers();
  } catch (error) {
    setUsersError(error.message);
  } finally {
    state.busy = false;
    els.userCreateBtn.disabled = false;
  }
}

async function resetUserPassword(username) {
  const password = window.prompt(`为 ${username} 设置新密码（至少 12 位）：`);
  if (!password) return;
  setUsersError("");
  try {
    await api(`/op/api/users/${encodeURIComponent(username)}`, {
      method: "PATCH",
      body: { password },
    });
    toast(`已重置 ${username} 的密码`);
    if (username === state.operator) {
      state.connected = false;
      clearTimeout(state.pollTimer);
      toast("当前账号密码已更新，请重新登录", 5000);
      setTimeout(() => redirectToLogin(), 800);
    }
  } catch (error) {
    setUsersError(error.message);
  }
}

async function deleteUser(username) {
  if (!window.confirm(`删除用户 ${username}？该用户现有会话会立即失效。`)) return;
  setUsersError("");
  try {
    await api(`/op/api/users/${encodeURIComponent(username)}`, { method: "DELETE" });
    toast(`已删除用户 ${username}`);
    await loadUsers();
  } catch (error) {
    setUsersError(error.message);
  }
}

function setKeysError(message = "") {
  els.keysError.textContent = message;
}

function openKeys() {
  if (state.role !== "admin") return;
  setKeysError("");
  els.newKeyBox.classList.add("hidden");
  els.keysModal.classList.remove("hidden");
  loadKeys().catch((error) => setKeysError(error.message));
}

function closeKeys() {
  els.keysModal.classList.add("hidden");
  setKeysError("");
}

function renderKeys(keys) {
  els.keyList.replaceChildren();
  for (const key of keys) {
    const row = el("div", "key-row");
    const identity = el("div");
    identity.append(el("div", "key-name", key.name));
    identity.append(el("div", "key-hint", key.hint || "—"));
    row.append(identity);
    const meta = el("div", "key-meta");
    meta.append(el("div", "", key.disabled ? "已停用" : "可用"));
    meta.append(el("div", "", `创建：${new Date(key.createdAt).toLocaleString()}`));
    meta.append(el("div", "", `最近使用：${key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "从未"}`));
    const limits = key.limits || {};
    meta.append(
      el(
        "div",
        "",
        `配额：${Number(limits.requestsPerMinute) || "不限"}/分 · ${Number(limits.requestsPerDay) || "不限"}/日 · ${Number(limits.requestsPerMonth) || "不限"}/月 · 并发 ${Number(limits.maxConcurrent) || "继承"}`,
      ),
    );
    if (key.allowedModels?.length) meta.append(el("div", "", `模型：${key.allowedModels.join(", ")}`));
    if (key.expiresAt) meta.append(el("div", "", `过期：${new Date(key.expiresAt).toLocaleString()}`));
    if (key.usage) meta.append(el("div", "", `已用：${key.usage.minute}/分 · ${key.usage.day}/日 · ${key.usage.month}/月`));
    row.append(meta);
    const actions = el("div", "key-actions");
    const toggle = el("button", "btn ghost", key.disabled ? "启用" : "停用");
    toggle.type = "button";
    toggle.addEventListener("click", () => toggleKey(key));
    const quota = el("button", "btn ghost", "配额");
    quota.type = "button";
    quota.addEventListener("click", () => editKeyQuota(key));
    const rename = el("button", "btn ghost", "重命名");
    rename.type = "button";
    rename.addEventListener("click", () => renameKey(key));
    const remove = el("button", "btn danger", "删除");
    remove.type = "button";
    remove.addEventListener("click", () => deleteKey(key));
    actions.append(toggle, quota, rename, remove);
    row.append(actions);
    els.keyList.append(row);
  }
  if (!keys.length) els.keyList.append(el("div", "hint", "（还没有调用密钥，先创建一个）"));
}

async function loadKeys() {
  const data = await api("/op/api/keys");
  renderKeys(Array.isArray(data.keys) ? data.keys : []);
}

async function createKey(event) {
  event.preventDefault();
  if (state.busy) return;
  setKeysError("");
  state.busy = true;
  els.keyCreateBtn.disabled = true;
  try {
    const data = await api("/op/api/keys", {
      method: "POST",
      body: {
        name: els.newKeyName.value.trim(),
        limits: {
          requestsPerMinute: Number(els.newKeyRpm.value) || 0,
          requestsPerDay: Number(els.newKeyPerDay.value) || 0,
          requestsPerMonth: Number(els.newKeyPerMonth.value) || 0,
          maxConcurrent: Number(els.newKeyConcurrent.value) || 0,
        },
        allowedModels: els.newKeyModels.value
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        expiresAt: els.newKeyExpires.value ? new Date(els.newKeyExpires.value).getTime() : null,
      },
    });
    els.newKeyValue.textContent = data.key;
    els.newKeyBox.classList.remove("hidden");
    els.newKeyName.value = "";
    els.newKeyModels.value = "";
    els.newKeyExpires.value = "";
    toast("调用密钥已创建，请现在保存");
    await loadKeys();
  } catch (error) {
    setKeysError(error.message);
  } finally {
    state.busy = false;
    els.keyCreateBtn.disabled = false;
  }
}

async function toggleKey(key) {
  setKeysError("");
  try {
    await api(`/op/api/keys/${encodeURIComponent(key.id)}`, {
      method: "PATCH",
      body: { disabled: !key.disabled },
    });
    toast(key.disabled ? "密钥已启用" : "密钥已停用");
    await loadKeys();
  } catch (error) {
    setKeysError(error.message);
  }
}

async function renameKey(key) {
  const name = window.prompt("给这个调用密钥起个名字：", key.name);
  if (!name || !name.trim()) return;
  setKeysError("");
  try {
    await api(`/op/api/keys/${encodeURIComponent(key.id)}`, {
      method: "PATCH",
      body: { name: name.trim() },
    });
    toast("名称已修改");
    await loadKeys();
  } catch (error) {
    setKeysError(error.message);
  }
}

async function editKeyQuota(key) {
  const current = key.limits || {};
  const rpm = window.prompt("每分钟请求上限（0 = 不限）：", String(current.requestsPerMinute || 0));
  if (rpm === null) return;
  const perDay = window.prompt("每日请求上限（0 = 不限）：", String(current.requestsPerDay || 0));
  if (perDay === null) return;
  const perMonth = window.prompt("每月请求上限（0 = 不限）：", String(current.requestsPerMonth || 0));
  if (perMonth === null) return;
  const concurrent = window.prompt("并发上限（0 = 使用全局默认）：", String(current.maxConcurrent || 0));
  if (concurrent === null) return;
  const models = window.prompt("允许的模型（逗号分隔，留空 = 全部）：", (key.allowedModels || []).join(","));
  if (models === null) return;
  const expires = window.prompt(
    "过期时间（ISO 时间或留空 = 不过期）：",
    key.expiresAt ? new Date(key.expiresAt).toISOString() : "",
  );
  if (expires === null) return;
  const expiresAt = expires.trim() ? Date.parse(expires) : null;
  if (expires.trim() && !Number.isFinite(expiresAt)) {
    setKeysError("过期时间格式无法识别，请使用类似 2026-12-31T00:00:00Z。");
    return;
  }
  setKeysError("");
  try {
    await api(`/op/api/keys/${encodeURIComponent(key.id)}`, {
      method: "PATCH",
      body: {
        limits: {
          requestsPerMinute: Number(rpm) || 0,
          requestsPerDay: Number(perDay) || 0,
          requestsPerMonth: Number(perMonth) || 0,
          maxConcurrent: Number(concurrent) || 0,
        },
        allowedModels: models.split(",").map((value) => value.trim()).filter(Boolean),
        expiresAt,
      },
    });
    toast("配额已更新");
    await loadKeys();
  } catch (error) {
    setKeysError(error.message);
  }
}

async function deleteKey(key) {
  if (!window.confirm(`删除调用密钥「${key.name}」？删除后使用它的调用方会立即失败。`)) return;
  setKeysError("");
  try {
    await api(`/op/api/keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
    toast("调用密钥已删除");
    await loadKeys();
  } catch (error) {
    setKeysError(error.message);
  }
}

async function copyNewKey() {
  const value = els.newKeyValue.textContent || "";
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast("已复制到剪贴板");
  } catch {
    const range = document.createRange();
    range.selectNodeContents(els.newKeyValue);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    toast("请手动复制选中的密钥");
  }
}

async function pollOnce() {
  if (!state.connected) return;
  try {
    let data = await api("/op/api/tickets");
    state.tickets = Array.isArray(data.tickets) ? data.tickets : [];
    state.stats = data.stats || null;

    if (els.autoclaim.checked && !state.busy) {
      const claimed = await maybeAutoClaim();
      if (claimed) {
        data = await api("/op/api/tickets");
        state.tickets = Array.isArray(data.tickets) ? data.tickets : [];
        state.stats = data.stats || null;
      }
    }

    render();
    setStatus("ok", `${state.operator} 已登录`);
  } catch (error) {
    if (error.status === 401) {
      state.connected = false;
      setStatus("err", "会话已失效");
      clearTimeout(state.pollTimer);
      redirectToLogin();
      return;
    }
    setStatus("warn", "连接不稳定，重试中…");
  } finally {
    clearTimeout(state.pollTimer);
    if (state.connected) state.pollTimer = setTimeout(pollOnce, 1200);
  }
}

async function refreshOnce() {
  if (!state.connected) return;
  const data = await api("/op/api/tickets");
  state.tickets = Array.isArray(data.tickets) ? data.tickets : [];
  state.stats = data.stats || null;
  render();
}

async function maybeAutoClaim() {
  if (state.tickets.some((ticket) => isActive(ticket) && ticket.claimedBy === state.operator)) return false;
  const next = state.tickets
    .filter((ticket) => ticket.state === "queued")
    .sort(queuePriority)[0];
  if (!next) return false;

  state.busy = true;
  try {
    await api(`/op/api/tickets/${encodeURIComponent(next.id)}/claim`, {
      method: "POST",
      body: {},
    });
    state.selectedId = next.id;
    toast(`已自动认领 ${shortId(next.id)}`);
    return true;
  } catch {
    return false;
  } finally {
    state.busy = false;
  }
}

/* ------------------------------ rendering ------------------------------ */

function reconcileSelection() {
  if (state.selectedId && !state.tickets.some((ticket) => ticket.id === state.selectedId)) {
    state.selectedId = null;
  }
  if (state.selectedId) return;

  const mine = state.tickets.find((ticket) => isActive(ticket) && ticket.claimedBy === state.operator);
  const queued = state.tickets
    .filter((ticket) => ticket.state === "queued")
    .sort(queuePriority)[0];
  const active = state.tickets.filter((ticket) => isActive(ticket)).sort(queuePriority)[0];
  const chosen = mine || queued || active || state.tickets[0];
  state.selectedId = chosen ? chosen.id : null;
  if (state.selectedId && !state.drafts.has(state.selectedId)) state.drafts.set(state.selectedId, "");
}

function render() {
  syncCommandbar();
  reconcileSelection();
  renderStats();
  renderQueue();
  maybeBeep();

  if (!state.selectedId) {
    showEmpty();
    return;
  }
  const ticket = state.tickets.find((item) => item.id === state.selectedId);
  if (!ticket) {
    showEmpty();
    return;
  }
  updateDetail(ticket);
}

function showEmpty() {
  detail = null;
  syncCommandbar();
  if (els.detail.querySelector(".empty")) return;
  els.detail.replaceChildren();
  const wrap = el("div", "empty");
  wrap.append(el("div", "empty-glyph", "⌁"));
  wrap.append(el("p", "", "选择左侧票据开始接待"));
  wrap.append(el("p", "empty-sub", "没有票据时，用 curl 或任意 OpenAI SDK 发一个请求。"));
  els.detail.append(wrap);
}

function statChip(label, value, tone) {
  const wrap = el("div", "stat");
  wrap.append(el("span", `stat-value ${tone || ""}`.trim(), value));
  wrap.append(el("span", "stat-label", label));
  return wrap;
}

function renderStats() {
  const stats = state.stats || {};
  const active = (stats.claimed || 0) + (stats.streaming || 0) + (stats.finishing || 0);
  els.stats.replaceChildren(
    statChip("待认领", stats.queued ?? 0, "amber"),
    statChip("进行中", active, "teal"),
    statChip("平均等待", stats.avgClaimMs ? fmtMs(stats.avgClaimMs) : "—", ""),
    statChip("已完成", stats.completed ?? 0, ""),
  );
}

function queueItem(ticket) {
  const button = el("button", `qitem${ticket.id === state.selectedId ? " selected" : ""}`);
  button.type = "button";
  button.addEventListener("click", () => {
    state.selectedId = ticket.id;
    render();
  });

  const top = el("div", "qitem-top");
  top.append(el("span", "qitem-model", ticket.model));
  top.append(badge(STATE_LABELS[ticket.state] || ticket.state, stateTone(ticket.state)));
  top.append(el("span", "qitem-mode", ticket.stream ? "SSE" : "JSON"));

  const preview = el("div", "qitem-preview", previewOf(ticket).slice(0, 140) || "(空)");

  const purpose = purposeOf(ticket);
  const foot = el("div", "qitem-foot");
  foot.append(el("span", "qitem-caller", ticket.caller || "caller"));
  foot.append(el("span", "qitem-dot"));
  const purposeLabel = el("span", "qitem-purpose", purpose.queueLabel);
  purposeLabel.title = purpose.detailLabel;
  foot.append(purposeLabel);
  foot.append(el("span", "qitem-dot"));
  const timing = ticket.queueWaitMs !== null && ticket.queueWaitMs !== undefined ? `等 ${fmtMs(ticket.queueWaitMs)}` : fmtMs(ticket.elapsedMs);
  foot.append(el("span", "qitem-time", timing));

  button.append(top, preview, foot);
  return button;
}

function queueMatches(ticket) {
  const query = state.queueQuery.trim().toLowerCase();
  if (query) {
    const haystack = [
      ticket.id,
      ticket.model,
      ticket.claimedBy,
      ticket.caller,
      ticket.messages?.map((message) => message.content).join(" "),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (state.queueFilter === "queued") return ticket.state === "queued";
  if (state.queueFilter === "active") return isActive(ticket) && ticket.state !== "queued";
  if (state.queueFilter === "recent") return !isActive(ticket);
  return true;
}

function renderQueue() {
  const filtered = state.tickets.filter(queueMatches);
  if (!filtered.length) {
    const empty = el("div", "queue-group");
    const head = el("div", "queue-group-head");
    head.append(el("span", "", state.tickets.length ? "没有匹配" : "队列为空"));
    empty.append(head);
    empty.append(
      el(
        "div",
        "qitem-preview",
        state.tickets.length ? "换一个搜索词或筛选条件。" : "等待调用方请求…",
      ),
    );
    els.queue.replaceChildren(empty);
    return;
  }

  const groups = [
    {
      label: "待认领",
      items: filtered.filter((ticket) => ticket.state === "queued").sort(queuePriority),
    },
    {
      label: "进行中",
      items: filtered.filter((ticket) => isActive(ticket) && ticket.state !== "queued").sort(queuePriority),
    },
    { label: "最近结束", items: filtered.filter((ticket) => !isActive(ticket)).slice(0, 12) },
  ];

  const scrollTop = els.queue.scrollTop;
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    if (!group.items.length) continue;
    const wrap = el("div", "queue-group");
    const head = el("div", "queue-group-head");
    head.append(el("span", "", group.label));
    head.append(el("span", "", String(group.items.length).padStart(2, "0")));
    wrap.append(head);
    for (const ticket of group.items) wrap.append(queueItem(ticket));
    fragment.append(wrap);
  }
  els.queue.replaceChildren(fragment);
  els.queue.scrollTop = scrollTop;
}

function buildDetail(ticket) {
  els.detail.replaceChildren();
  const wrap = el("div", "detail-wrap");

  const head = el("div", "detail-head");
  const titleWrap = el("div");
  titleWrap.append(el("div", "eyebrow", "Human ticket"));
  const title = el("h2", "detail-title");
  const model = el("span", "", ticket.model);
  const id = el("span", "id", shortId(ticket.id));
  title.append(model, id);
  titleWrap.append(title);
  const badges = el("div", "badges");
  head.append(titleWrap, badges);

  const meta = el("div", "meta");
  const purposeHint = el("div", "purpose-hint hidden");

  const panes = el("div", "panes");

  const inputPane = el("section", "pane");
  const inputHead = el("div", "pane-head");
  const inputTitle = el("span", "pane-title", "对话与上下文");
  const msgCount = el("span", "pane-note", "");
  inputHead.append(inputTitle, msgCount);
  const messages = el("div", "messages");
  const tools = el("div", "tools");
  tools.style.display = "none";
  inputPane.append(inputHead, messages, tools);

  const outputPane = el("section", "pane");
  const outputHead = el("div", "pane-head");
  const outputTitle = el("span", "pane-title", "对外流式内容");
  const charCount = el("span", "pane-note", "");
  outputHead.append(outputTitle, charCount);
  const transcript = el("div", "transcript placeholder", "还没有发送任何内容。");
  const sentTools = el("div", "sent-toolcalls hidden");
  const composer = el("div", "composer");
  const label = el("label", "", "回复编辑器 · 推送 = 立即输出 · 完成 = 补齐后收尾");
  const draft = el("textarea");
  draft.placeholder = "在这里写回复。Ctrl+Enter 完成并发送，Ctrl+Shift+Enter 推送片段…";
  draft.spellcheck = false;

  const thinkingPanel = el("details", "thinking-panel");
  thinkingPanel.append(el("summary", "", "思考过程（可选，不对外）"));
  const thinkingDraft = el("textarea", "thinking-text");
  thinkingDraft.placeholder = "写给自己/调试用的推理，不进入对外 content；完成时会以 reasoning_content 发给支持的客户端。";
  thinkingDraft.spellcheck = false;
  thinkingPanel.append(thinkingDraft);

  const toolPanel = el("div", "toolcall-panel hidden");
  const toolTitle = el("div", "toolcall-title", "工具调用");
  const toolSub = el("div", "toolcall-sub", "");
  const toolFilter = el("input", "tool-filter");
  toolFilter.placeholder = "筛选工具（支持名称搜索）";
  toolFilter.autocomplete = "off";
  toolFilter.spellcheck = false;
  const toolSelect = el("select", "tool-select");
  const toolDesc = el("div", "tool-desc");
  const toolArgs = el("textarea", "tool-args");
  toolArgs.placeholder = 'JSON 参数，例如 {"city":"上海"}';
  toolArgs.spellcheck = false;
  const toolError = el("div", "tool-error hidden");
  const toolButtons = el("div", "tool-actions");
  const toolAdd = el("button", "btn primary", "添加工具调用");
  toolAdd.type = "button";
  const toolTemplate = el("button", "btn ghost", "填充参数模板");
  toolTemplate.type = "button";
  toolButtons.append(toolAdd, toolTemplate);
  const toolPending = el("div", "toolcall-pending");
  toolPanel.append(toolTitle, toolSub, toolFilter, toolSelect, toolDesc, toolArgs, toolError, toolButtons, toolPending);

  const note = el("div", "composer-note hidden");

  const inspector = el("aside", "inspector");
  const inspectorHead = el("div", "inspector-head");
  inspectorHead.append(el("span", "", "检查器"));
  inspectorHead.append(el("span", "inspector-hint", "工具 / 思考"));
  const inspectorBody = el("div", "inspector-body");
  const toolEmpty = el("div", "inspector-empty", "");
  inspectorBody.append(toolPanel, toolEmpty, thinkingPanel);
  inspector.append(inspectorHead, inspectorBody);

  const composerMain = el("div", "composer-main");
  composerMain.append(label, draft, note);
  composer.append(composerMain);
  outputPane.append(outputHead, transcript, sentTools);

  panes.append(inputPane, outputPane);
  const workspace = el("div", "workspace");
  workspace.append(panes, inspector);
  wrap.append(head, meta, purposeHint, workspace, composer);
  els.detail.append(wrap);

  const current = { id: ticket.id, els: {} };
  current.els = {
    model,
    id,
    badges,
    meta,
    purposeHint,
    messages,
    tools,
    msgCount,
    transcript,
    charCount,
    sentTools,
    draft,
    thinkingPanel,
    thinkingDraft,
    composer,
    composerMain,
    toolPanel,
    toolEmpty,
    toolTitle,
    toolSub,
    toolFilter,
    toolSelect,
    toolDesc,
    toolArgs,
    toolError,
    toolAdd,
    toolTemplate,
    toolPending,
    note,
    claim: els.cmdClaim,
    push: els.cmdPush,
    finish: els.cmdFinish,
    release: els.cmdRelease,
    refuse: els.cmdRefuse,
    cancel: els.cmdCancel,
  };

  draft.value = state.drafts.get(ticket.id) || "";
  thinkingDraft.value = state.thinkingDrafts.get(ticket.id) || "";
  draft.addEventListener("input", () => {
    if (detail) state.drafts.set(detail.id, draft.value);
  });
  thinkingDraft.addEventListener("input", () => {
    if (detail) state.thinkingDrafts.set(detail.id, thinkingDraft.value);
  });
  toolFilter.addEventListener("input", () => {
    const currentTicket = state.tickets.find((item) => item.id === state.selectedId);
    if (currentTicket) renderToolPanel(currentTicket, detail);
  });
  toolSelect.addEventListener("change", () => {
    const currentTicket = state.tickets.find((item) => item.id === state.selectedId);
    if (currentTicket) {
      fillToolTemplate();
      renderToolPanel(currentTicket, detail);
    }
  });
  toolArgs.addEventListener("input", () => setToolError(detail, ""));
  toolArgs.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      addToolCallFromUI();
    }
  });
  toolAdd.addEventListener("click", addToolCallFromUI);
  toolTemplate.addEventListener("click", fillToolTemplate);

  detail = current;
  return current;
}

function updateDetail(ticket) {
  if (!detail || detail.id !== ticket.id) buildDetail(ticket);
  const d = detail;

  d.els.model.textContent = ticket.model;
  d.els.id.textContent = shortId(ticket.id);
  renderBadges(ticket, d.els.badges);
  renderMeta(ticket, d.els.meta);
  renderPurposeHint(ticket, d);
  renderMessages(ticket, d);
  renderTranscript(ticket, d);
  renderSentToolCalls(ticket, d);
  renderToolPanel(ticket, d);
  updateComposer(ticket, d);

  const counts = messageBuckets(ticket);
  d.els.msgCount.textContent = `${counts.conversation.length} 条对话 · ${counts.context.length} 条上下文`;
  d.els.charCount.textContent = `${ticket.text.length} 字符`;
}

function renderBadges(ticket, container) {
  const items = [];
  const purpose = purposeOf(ticket);
  items.push(badge(STATE_LABELS[ticket.state] || ticket.state, stateTone(ticket.state)));
  items.push(badge(ticket.stream ? "stream" : "non-stream", ""));
  if (purpose.id !== "chat") {
    items.push(badge(purpose.detailLabel, purpose.tone));
  }
  if (ticket.claimedBy) {
    items.push(badge(`@${ticket.claimedBy}`, ticket.claimedBy === state.operator ? "mine" : ""));
  }
  if (ticket.toolCalls?.length) {
    items.push(badge(`tools:${ticket.toolCalls.length}`, "mine"));
  }
  if (ticket.finishReason && ticket.finishReason !== "error") {
    const tone = ticket.finishReason === "content_filter"
      ? "failed"
      : ["stop", "tool_calls"].includes(ticket.finishReason)
        ? "done"
        : "";
    items.push(badge(`finish:${ticket.finishReason}`, tone));
  }
  if (ticket.clientGone) items.push(badge("client gone", "failed"));
  container.replaceChildren(...items);
}

function metaItem(label, value) {
  const wrap = el("div", "meta-item");
  wrap.append(el("span", "meta-label", label));
  wrap.append(el("span", "meta-value", value));
  return wrap;
}

function renderPurposeHint(ticket, d) {
  const purpose = purposeOf(ticket);
  let text = "";
  if (purpose.id === "session_title") {
    text =
      "这是 DSH 自动发起的会话标题生成请求，不是用户重复提问。回复一句短标题即可，例如「北京天气」或「查看工作目录」。";
  } else if (purpose.id === "tool_result") {
    text =
      "这是工具执行后的续跑请求：最后一条 tool 消息是工具输出。基于该结果继续回答用户即可；需要时可以再次调用工具。";
  }
  d.els.purposeHint.classList.toggle("hidden", !text);
  d.els.purposeHint.textContent = text;
}

function renderMeta(ticket, container) {
  container.replaceChildren(
    metaItem("调用方", ticket.caller || "—"),
    metaItem("创建", fmtTime(ticket.createdAt)),
    metaItem("排队", ticket.queueWaitMs !== null && ticket.queueWaitMs !== undefined ? fmtMs(ticket.queueWaitMs) : "—"),
    metaItem("耗时", fmtMs(ticket.elapsedMs)),
    metaItem("提示 ≈", `${ticket.promptTokens} tok`),
    metaItem("回复 ≈", `${ticket.completionTokens} tok`),
    metaItem("max_tokens", ticket.maxTokens ?? "—"),
    metaItem("finish", ticket.finishReason || "—"),
  );
}

function renderMessageRow(ticket, message, index, isContext) {
  const row = el("div", `msg ${message.role || ""}${isContext ? " context-msg" : ""}`);
  const content = message.content || (message.tool_calls?.length ? "(tool call)" : "(empty)");
  if (message.role === "tool" && /^(error|Error)[:\s]/.test(content)) {
    row.classList.add("msg-error");
  }

  const head = el("div", "msg-head");
  const roleLabel =
    isContext && message.role === "user"
      ? "context"
      : ROLE_LABELS[message.role] || message.role || "unknown";
  head.append(el("span", "role", roleLabel));
  if (message.tool_call_id) {
    head.append(el("span", "msg-toolref", `↳ ${message.tool_call_id}`));
  }
  head.append(el("span", "msg-index", String(index + 1).padStart(2, "0")));
  row.append(head);
  row.append(el("div", "msg-content", content));

  if (message.tool_calls?.length) {
    const calls = el("div", "msg-toolcalls");
    for (const call of message.tool_calls) {
      const item = el("div", "msg-toolcall");
      item.append(el("span", "msg-tool-name", call.function.name));
      item.append(el("pre", "msg-tool-args", prettyArgs(call.function.arguments)));
      calls.append(item);
    }
    row.append(calls);
  }

  const images = (ticket.attachments || []).filter((attachment) => attachment.messageIndex === index);
  if (images.length) {
    const strip = el("div", "attachments");
    for (const attachment of images) {
      const image = el("img", "attachment-thumb");
      image.src = attachment.url;
      image.alt = "调用方附带的图片";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("click", () => {
        if (/^(https?:|data:image\/)/i.test(attachment.url)) {
          window.open(attachment.url, "_blank", "noopener,noreferrer");
        }
      });
      strip.append(image);
    }
    row.append(strip);
  }
  return row;
}

function renderMessages(ticket, d) {
  const signature = [
    ticket.messages.length,
    ticket.attachments?.length || 0,
    ticket.tools?.length || 0,
    Boolean(ticket.responseFormat),
  ].join(":");
  if (d.msgSignature === signature) return;
  d.msgSignature = signature;

  const { conversation, context } = messageBuckets(ticket);
  d.els.messages.replaceChildren();

  const summary = el("div", "messages-summary");
  summary.append(el("span", "messages-summary-main", `对话历史 · ${conversation.length} 条`));
  if (context.length) {
    summary.append(el("span", "", `系统/上下文 ${context.length} 条已折叠`));
  }
  d.els.messages.append(summary);

  if (conversation.length === 0) {
    d.els.messages.append(el("div", "messages-empty", "本次请求没有用户/助手对话消息。"));
  } else {
    for (const entry of conversation) {
      d.els.messages.append(renderMessageRow(ticket, entry.message, entry.index, false));
    }
  }

  if (context.length) {
    const contextBlock = el("details", "context-block");
    contextBlock.append(el("summary", "", `系统与运行时上下文 · ${context.length} 条（点击展开）`));
    const contextList = el("div", "context-list");
    for (const entry of context) {
      contextList.append(renderMessageRow(ticket, entry.message, entry.index, true));
    }
    contextBlock.append(contextList);
    d.els.messages.append(contextBlock);
  }

  const hasTools = (ticket.tools && ticket.tools.length) || ticket.responseFormat;
  if (hasTools) {
    d.els.tools.style.display = "";
    const toolsBlock = el("details");
    toolsBlock.append(el("summary", "", "tools / response_format（供回复员参考）"));
    const pre = el("pre");
    pre.textContent = JSON.stringify(
      { tools: ticket.tools || [], response_format: ticket.responseFormat || null },
      null,
      2,
    );
    toolsBlock.append(pre);
    d.els.tools.replaceChildren(toolsBlock);
  } else {
    d.els.tools.style.display = "none";
    d.els.tools.replaceChildren();
  }
}

function renderTranscript(ticket, d) {
  const text = ticket.text || "";
  const shown = ticket.refusal ? `拒答：${ticket.refusal}` : text;
  const signature = `${shown.length}:${ticket.state}:${ticket.claimedBy}:${shown.slice(-12)}`;
  if (d.transcriptSignature === signature) return;

  const box = d.els.transcript;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 48;

  box.classList.toggle("placeholder", !shown);
  box.textContent = shown || "还没有发送任何内容。";
  if (ticket.refusal) box.classList.add("refusal-text");
  else box.classList.remove("refusal-text");
  const editable =
    isActive(ticket) && ticket.state !== "finishing" && ticket.claimedBy === state.operator;
  if (editable && !ticket.refusal) box.append(el("span", "caret"));

  if (nearBottom || !shown) box.scrollTop = box.scrollHeight;
  d.transcriptSignature = signature;
}

function currentTicket() {
  return state.tickets.find((item) => item.id === state.selectedId) || null;
}

function toolNamesFor(ticket) {
  const names = (ticket.tools || []).map((tool) => tool.function.name);
  if (ticket.toolChoice && typeof ticket.toolChoice === "object") {
    return names.filter((name) => name === ticket.toolChoice.name);
  }
  return names;
}

function isTicketEditable(ticket) {
  return isActive(ticket) && ticket.state !== "finishing" && ticket.claimedBy === state.operator;
}

function renderToolPanel(ticket, d) {
  if (!d?.els.toolPanel) return;
  const tools = ticket.tools || [];
  const hasTools = tools.length > 0 && ticket.toolChoice !== "none";
  const visible = isTicketEditable(ticket) && hasTools;
  d.els.toolPanel.classList.toggle("hidden", !visible);
  if (d.els.toolEmpty) {
    d.els.toolEmpty.classList.toggle("hidden", visible);
    if (!visible) {
      if (!isActive(ticket)) {
        d.els.toolEmpty.textContent = "票据已结束，工具面板不可编辑。";
      } else if (ticket.claimedBy && ticket.claimedBy !== state.operator) {
        d.els.toolEmpty.textContent = `由 ${ticket.claimedBy} 接待中，无法编辑工具调用。`;
      } else if (!hasTools) {
        d.els.toolEmpty.textContent = "此请求没有可调用工具，可直接文本回复。";
      } else {
        d.els.toolEmpty.textContent = "认领票据后可查看和编辑工具调用。";
      }
    }
  }
  if (!visible) return;

  const filter = d.els.toolFilter.value.trim().toLowerCase();
  const names = toolNamesFor(ticket).filter((name) => name.toLowerCase().includes(filter));
  const signature = `${filter}::${names.join("|")}::${JSON.stringify(ticket.toolChoice)}`;
  const select = d.els.toolSelect;
  if (d.toolSignature !== signature) {
    const previous = select.value;
    select.replaceChildren();
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.append(option);
    }
    select.value = names.includes(previous) ? previous : names[0] || "";
    d.toolSignature = signature;
  }

  const editable = isTicketEditable(ticket);
  const selectedTool = (ticket.tools || []).find((item) => item.function.name === select.value);
  if (editable && selectedTool && !d.els.toolArgs.value.trim()) {
    d.els.toolArgs.value = templateFromSchema(selectedTool.function.parameters);
  }
  d.els.toolFilter.disabled = !editable;
  select.disabled = !editable || !names.length || (names.length <= 1 && Boolean(ticket.toolChoice?.name));
  d.els.toolArgs.disabled = !editable;
  d.els.toolAdd.disabled = !editable || !names.length;
  d.els.toolTemplate.disabled = !editable || !names.length;
  d.els.toolTitle.textContent = `工具调用 · ${tools.length} 个可用`;
  d.els.toolSub.textContent =
    ticket.toolChoice === "required"
      ? "tool_choice=required · 必须至少返回一个工具调用"
      : ticket.toolChoice && typeof ticket.toolChoice === "object"
        ? `tool_choice 指定 ${ticket.toolChoice.name}`
        : "tool_choice=auto · 可文本回复，也可调用工具";

  renderToolDescription(ticket, d);
  renderPendingToolCalls(ticket, d);
  d.els.toolFilter.placeholder = `筛选工具（${toolNamesFor(ticket).length} 个）`;
}

function renderToolDescription(ticket, d) {
  const name = d.els.toolSelect.value;
  const tool = (ticket.tools || []).find((item) => item.function.name === name);
  d.els.toolDesc.replaceChildren();
  if (!tool) return;
  if (tool.function.description) {
    d.els.toolDesc.append(el("div", "tool-desc-text", tool.function.description));
  }
  const required = Array.isArray(tool.function.parameters?.required)
    ? tool.function.parameters.required
    : [];
  if (required.length) {
    d.els.toolDesc.append(el("div", "tool-required", `必填：${required.join("、")}`));
  }
  const details = el("details", "tool-schema");
  details.append(el("summary", "", "参数 schema"));
  const pre = el("pre");
  pre.textContent = JSON.stringify(tool.function.parameters || {}, null, 2);
  details.append(pre);
  d.els.toolDesc.append(details);
}

function renderPendingToolCalls(ticket, d) {
  const calls = state.toolDrafts.get(ticket.id) || [];
  d.els.toolPending.replaceChildren();
  if (!calls.length) {
    d.els.toolPending.append(el("div", "tool-pending-empty", "尚未添加工具调用"));
    return;
  }

  const editable = isTicketEditable(ticket);
  d.els.toolPending.append(el("div", "tool-pending-head", `待发送 ${calls.length} 个工具调用`));
  calls.forEach((call, index) => {
    const row = el("div", "toolcall-item");
    const info = el("div", "toolcall-info");
    info.append(el("div", "toolcall-name", call.name));
    const args = el("pre", "toolcall-args", prettyArgs(call.arguments));
    info.append(args);
    row.append(info);

    if (editable) {
      const remove = el("button", "toolcall-remove", "移除");
      remove.type = "button";
      remove.addEventListener("click", () => {
        const next = [...(state.toolDrafts.get(ticket.id) || [])];
        next.splice(index, 1);
        state.toolDrafts.set(ticket.id, next);
        renderPendingToolCalls(ticket, d);
        updateComposer(ticket, d);
      });
      row.append(remove);
    }
    d.els.toolPending.append(row);
  });
}

function renderSentToolCalls(ticket, d) {
  const calls = ticket.toolCalls || [];
  d.els.sentTools.classList.toggle("hidden", !calls.length);
  if (!calls.length) {
    if (d.sentToolsSignature !== null) {
      d.sentToolsSignature = null;
      d.els.sentTools.replaceChildren();
    }
    return;
  }

  const signature = calls.map((call) => `${call.id}:${call.function.arguments}`).join("|");
  if (d.sentToolsSignature === signature) return;
  d.sentToolsSignature = signature;
  d.els.sentTools.replaceChildren();

  const head = el("div", "sent-tools-head");
  head.append(el("span", "sent-tools-title", "已返回工具调用"));
  head.append(el("span", "sent-tools-count", String(calls.length)));
  d.els.sentTools.append(head);

  for (const call of calls) {
    const row = el("div", "sent-toolcall");
    const name = el("div", "sent-tool-name", call.function.name);
    const args = el("pre", "sent-tool-args", prettyArgs(call.function.arguments));
    row.append(name, args);
    d.els.sentTools.append(row);
  }
}

function templateFromSchema(schema) {
  if (!schema || schema.type !== "object" || !schema.properties) return "{}";
  const out = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!prop || typeof prop !== "object") {
      out[key] = null;
    } else if (prop.default !== undefined) {
      out[key] = prop.default;
    } else if (Array.isArray(prop.enum) && prop.enum.length) {
      out[key] = prop.enum[0];
    } else if (prop.type === "string") {
      out[key] = "";
    } else if (prop.type === "number" || prop.type === "integer") {
      out[key] = 0;
    } else if (prop.type === "boolean") {
      out[key] = false;
    } else if (prop.type === "array") {
      out[key] = [];
    } else if (prop.type === "object") {
      out[key] = {};
    } else {
      out[key] = null;
    }
  }
  return JSON.stringify(out, null, 2);
}

function fillToolTemplate() {
  const ticket = currentTicket();
  if (!ticket || !detail || detail.id !== ticket.id) return;
  const name = detail.els.toolSelect.value;
  const tool = (ticket.tools || []).find((item) => item.function.name === name);
  if (!tool) return;
  detail.els.toolArgs.value = templateFromSchema(tool.function.parameters);
  detail.els.toolArgs.focus();
}

function setToolError(d, message = "") {
  if (!d?.els?.toolError) return;
  d.els.toolError.textContent = message;
  d.els.toolError.classList.toggle("hidden", !message);
}

function addToolCallFromUI() {
  const ticket = currentTicket();
  if (!ticket || !detail || detail.id !== ticket.id) return;
  if (!isTicketEditable(ticket)) {
    toast("先认领票据，再添加工具调用");
    return;
  }

  const name = detail.els.toolSelect.value;
  if (!name) return;
  if (ticket.toolChoice && typeof ticket.toolChoice === "object" && ticket.toolChoice.name !== name) {
    setToolError(detail, `此请求指定使用 ${ticket.toolChoice.name}`);
    return;
  }

  const raw = detail.els.toolArgs.value.trim() || "{}";
  let args;
  try {
    args = JSON.parse(raw);
  } catch {
    setToolError(detail, "参数不是合法 JSON，请检查逗号、引号和括号。");
    detail.els.toolArgs.focus();
    return;
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    setToolError(detail, "参数必须是一个 JSON 对象。");
    detail.els.toolArgs.focus();
    return;
  }
  setToolError(detail, "");

  const calls = [...(state.toolDrafts.get(ticket.id) || [])];
  if (calls.length >= 16) {
    toast("最多 16 个工具调用");
    return;
  }
  if (ticket.parallelToolCalls === false && calls.length >= 1) {
    toast("此请求只允许一个工具调用");
    return;
  }

  calls.push({ name, arguments: JSON.stringify(args) });
  state.toolDrafts.set(ticket.id, calls);
  detail.els.toolArgs.value = "";
  renderPendingToolCalls(ticket, detail);
  const selectedTool = (ticket.tools || []).find((item) => item.function.name === name);
  if (selectedTool) detail.els.toolArgs.value = templateFromSchema(selectedTool.function.parameters);
  updateComposer(ticket, detail);
  toast(`已添加工具调用：${name}`);
}

function updateComposer(ticket, d) {
  const mine = ticket.claimedBy === state.operator;
  const editable = isActive(ticket) && ticket.state !== "finishing" && mine;
  const note = d.els.note;
  const pending = state.toolDrafts.get(ticket.id) || [];
  const toolRequired =
    ticket.toolChoice === "required" ||
    (ticket.toolChoice && typeof ticket.toolChoice === "object");
  const jsonMode =
    ticket.responseFormat?.type === "json_object" ||
    ticket.responseFormat?.type === "json_schema";

  d.els.draft.disabled = !editable;
  d.els.thinkingPanel.classList.toggle("hidden", !isActive(ticket));
  d.els.thinkingDraft.disabled = !editable;

  note.classList.add("hidden");
  if (!isActive(ticket)) {
    note.classList.remove("hidden");
    note.textContent =
      ticket.state === "cancelled"
        ? "调用方已断开，票据关闭。"
        : ticket.state === "failed"
          ? "请求以错误结束，调用方已收到错误响应。"
          : `请求已结束${ticket.finishReason ? `（finish_reason: ${ticket.finishReason}）` : ""}。`;
  } else if (!editable) {
    note.classList.remove("hidden");
    note.textContent =
      ticket.state === "queued"
        ? "这张票还没有被认领。点击「认领票据」后就可以回复。"
        : ticket.state === "finishing"
          ? "正在把剩余内容按节奏推送给调用方…"
          : `由 ${ticket.claimedBy || "其他回复员"} 接待中。`;
  } else if (toolRequired && pending.length === 0) {
    note.classList.remove("hidden");
    note.textContent = "此请求要求返回工具调用：先在下方选择工具并添加，再完成。";
  } else if (jsonMode) {
    note.classList.remove("hidden");
    note.textContent =
      ticket.responseFormat.type === "json_schema"
        ? `response_format=json_schema（${ticket.responseFormat.json_schema?.name || "response"}）：完成时会校验 JSON，不通过会留在当前票让你修改。`
        : "response_format=json_object：完成时会校验 JSON 对象，不通过会留在当前票让你修改。";
  } else {
    note.classList.add("hidden");
  }

  if (d.els.draft.disabled) d.els.draft.placeholder = "认领票据后即可输入回复";
  else d.els.draft.placeholder = `在这里写回复。${prettyShortcut("finish")} 完成，${prettyShortcut("push")} 推送…`;
  syncCommandbar();
}

/* ------------------------------ actions ------------------------------ */

async function doAction(name) {
  const ticket = state.tickets.find((item) => item.id === state.selectedId);
  if (!ticket || state.busy) return;

  const draft = detail && detail.id === ticket.id ? detail.els.draft.value : "";
  if (name === "push" && !draft.trim()) {
    toast("先输入回复内容，再推送片段");
    detail?.els.draft.focus();
    return;
  }
  if (name === "cancel" && !window.confirm("取消这个请求？调用方会收到错误响应。")) return;
  if (name === "release" && !window.confirm("把票据放回队列？")) return;
  if (name === "refuse" && !window.confirm("以拒答结束这个请求？调用方会收到 refusal + content_filter。")) return;

  state.busy = true;
  setButtonsDisabled(true);

  try {
    const body = {};
    const thinking = detail && detail.id === ticket.id ? detail.els.thinkingDraft.value : "";
    if (name === "push" || name === "finish") body.text = draft;
    if (name === "finish") {
      body.finishReason = "stop";
      if (thinking.trim()) body.reasoning = thinking;
      if (ticket.responseFormat) body.replaceText = true;
      const toolCalls = state.toolDrafts.get(ticket.id) || [];
      if (toolCalls.length) body.toolCalls = toolCalls;
    }
    if (name === "refuse") {
      body.refusal = draft.trim() || "无法协助这个请求。";
    }

    const endpoint = name === "push" ? "chunk" : name === "refuse" ? "finish" : name;
    await api(`/op/api/tickets/${encodeURIComponent(ticket.id)}/${endpoint}`, { method: "POST", body });

    if (name === "push" || name === "finish" || name === "refuse") {
      state.drafts.set(ticket.id, "");
      if (detail && detail.id === ticket.id) detail.els.draft.value = "";
    }
    if (name === "finish" || name === "refuse") {
      state.thinkingDrafts.set(ticket.id, "");
      state.toolDrafts.delete(ticket.id);
      if (detail && detail.id === ticket.id) {
        detail.els.thinkingDraft.value = "";
        detail.els.toolArgs.value = "";
        renderPendingToolCalls(ticket, detail);
      }
    }
    if (name === "claim") state.selectedId = ticket.id;
    await refreshOnce();
  } catch (error) {
    toast(error.message);
  } finally {
    state.busy = false;
    setButtonsDisabled(false);
    const current = currentTicket();
    if (current && detail) updateComposer(current, detail);
  }
}

function syncCommandbar() {
  const ticket = currentTicket();
  const editable = ticket ? isTicketEditable(ticket) : false;
  const pending = ticket ? state.toolDrafts.get(ticket.id) || [] : [];
  const toolRequired = ticket
    ? ticket.toolChoice === "required" ||
      (ticket.toolChoice && typeof ticket.toolChoice === "object")
    : false;
  const active = ticket ? isActive(ticket) : false;
  const mine = ticket ? ticket.claimedBy === state.operator : false;

  els.commandTicket.textContent = ticket
    ? `${ticket.model} · ${shortId(ticket.id)}`
    : state.connected
      ? "未选择票据"
      : "未连接";
  els.commandState.textContent = ticket
    ? STATE_LABELS[ticket.state] || ticket.state
    : state.connected
      ? "等待队列"
      : "连接中";
  els.cmdClaim.disabled = state.busy || !ticket || ticket.state !== "queued";
  els.cmdPush.disabled = state.busy || !editable;
  els.cmdFinish.disabled = state.busy || !editable || (toolRequired && pending.length === 0);
  els.cmdFinish.title =
    toolRequired && pending.length === 0 ? "此请求要求先添加工具调用" : "";
  els.cmdRelease.disabled =
    state.busy || !(editable && ticket.state === "claimed" && !ticket.stream && !ticket.text);
  els.cmdRefuse.disabled = state.busy || !editable;
  els.cmdCancel.disabled =
    state.busy || !active || !(mine || ticket.state === "queued" || ticket.state === "finishing");
  els.commandHint.textContent = ticket
    ? `${prettyShortcut("finish")} 完成 · ${prettyShortcut("push")} 推送 · ${prettyShortcut("help")} 快捷键`
    : "选择票据后启用操作";
  updateShortcutLabels();
}

function setButtonsDisabled(flag) {
  for (const button of [els.cmdClaim, els.cmdPush, els.cmdFinish, els.cmdRelease, els.cmdRefuse, els.cmdCancel]) {
    button.disabled = flag;
  }
  if (detail?.els) {
    detail.els.toolAdd.disabled = flag;
    detail.els.toolTemplate.disabled = flag;
  }
  if (!flag) {
    const ticket = currentTicket();
    if (ticket && detail) updateComposer(ticket, detail);
    else syncCommandbar();
  }
}

/* ------------------------------ shortcuts ------------------------------ */

function loadShortcuts() {
  const loaded = {};
  try {
    const stored = JSON.parse(localStorage.getItem("ngzr.shortcuts") || "{}");
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === "string" && /^(Mod|Shift|Alt|Control|Meta)(\+[A-Za-z0-9/\[\]=,.;'`-]+)+$/.test(value)) {
        loaded[key] = value;
      }
    }
  } catch {
    /* corrupt localStorage: use defaults */
  }
  return { ...DEFAULT_SHORTCUTS, ...loaded };
}

function saveShortcuts() {
  try {
    localStorage.setItem("ngzr.shortcuts", JSON.stringify(state.shortcuts));
  } catch {
    toast("快捷键已应用，但浏览器拒绝持久化");
  }
}

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
}

function prettyShortcut(action) {
  const raw = state.shortcuts?.[action] || DEFAULT_SHORTCUTS[action] || "";
  const mac = isMacPlatform();
  return raw
    .split("+")
    .map((part) => {
      if (part === "Mod") return mac ? "⌘" : "Ctrl";
      if (part === "Alt") return mac ? "⌥" : "Alt";
      if (part === "Shift") return mac ? "⇧" : "Shift";
      if (part === "Control") return "Ctrl";
      if (part === "Meta") return "⌘";
      return part;
    })
    .join("+");
}

function comboFromEvent(event) {
  if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return null;
  const mod = event.ctrlKey || event.metaKey;
  const alt = event.altKey;
  if (!mod && !alt) return null;
  const parts = [];
  if (mod) parts.push("Mod");
  if (event.shiftKey) parts.push("Shift");
  if (alt) parts.push("Alt");
  let key = event.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  else if (key === "Escape") key = "Escape";
  parts.push(key);
  return parts.join("+");
}

function shortcutForEvent(event) {
  if (!state.shortcuts) return null;
  const combo = comboFromEvent(event);
  if (!combo) return null;
  return Object.keys(state.shortcuts).find((action) => state.shortcuts[action] === combo) || null;
}

function updateShortcutLabels() {
  for (const node of document.querySelectorAll("[data-shortcut]")) {
    node.textContent = prettyShortcut(node.dataset.shortcut);
  }
}

function closeShortcuts() {
  els.shortcutModal.classList.add("hidden");
  state.recordingShortcut = null;
}

function renderShortcutEditor() {
  els.shortcutList.replaceChildren();
  for (const item of SHORTCUT_DEFS) {
    const row = el("div", "shortcut-row");
    row.append(el("div", "shortcut-label", item.label));
    row.append(el("div", "shortcut-desc", item.desc));
    const input = el("input");
    input.readOnly = true;
    input.value = prettyShortcut(item.id);
    input.dataset.action = item.id;
    input.title = "点击后按下新组合键；Backspace 恢复默认";
    input.addEventListener("focus", () => {
      state.recordingShortcut = item.id;
      input.classList.add("recording");
      input.value = "按下组合键…";
    });
    input.addEventListener("keydown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        input.blur();
        renderShortcutEditor();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        state.shortcuts[item.id] = DEFAULT_SHORTCUTS[item.id];
        saveShortcuts();
        updateShortcutLabels();
        renderShortcutEditor();
        toast(`已恢复：${item.label}`);
        return;
      }
      const combo = comboFromEvent(event);
      if (!combo) return;
      state.shortcuts[item.id] = combo;
      saveShortcuts();
      updateShortcutLabels();
      syncCommandbar();
      renderShortcutEditor();
      toast(`已设置：${item.label} → ${prettyShortcut(item.id)}`);
    });
    input.addEventListener("blur", () => {
      state.recordingShortcut = null;
      input.classList.remove("recording");
    });
    row.append(input);
    els.shortcutList.append(row);
  }
}

function openShortcuts() {
  closeUsers();
  state.shortcuts = loadShortcuts();
  renderShortcutEditor();
  els.shortcutModal.classList.remove("hidden");
}

function resetShortcuts() {
  state.shortcuts = { ...DEFAULT_SHORTCUTS };
  saveShortcuts();
  updateShortcutLabels();
  syncCommandbar();
  renderShortcutEditor();
  toast("快捷键已恢复默认");
}

function focusDraft() {
  if (detail?.els?.draft && !detail.els.draft.disabled) {
    detail.els.draft.focus();
    const length = detail.els.draft.value.length;
    detail.els.draft.setSelectionRange(length, length);
  }
}

function nextTicket() {
  if (!state.tickets.length) return;
  const sorted = [...state.tickets].sort((a, b) => {
    const priority = (ticket) => (ticket.state === "queued" ? 0 : isActive(ticket) ? 1 : 2);
    return priority(a) - priority(b) || a.created - b.created;
  });
  const index = sorted.findIndex((ticket) => ticket.id === state.selectedId);
  const next = sorted[(index + 1) % sorted.length];
  state.selectedId = next.id;
  render();
}

function handleGlobalShortcut(event) {
  if (event.key === "Escape") {
    if (!els.shortcutModal.classList.contains("hidden")) {
      closeShortcuts();
      return;
    }
    if (!els.keysModal.classList.contains("hidden")) {
      closeKeys();
      return;
    }
    if (!els.usersModal.classList.contains("hidden")) {
      closeUsers();
      return;
    }
  }
  if (!els.shortcutModal.classList.contains("hidden") || event.repeat) return;
  const action = shortcutForEvent(event);
  if (!action) return;

  const target = event.target;
  const isDraft = detail?.els?.draft === target;
  const typing =
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  if (typing && !isDraft) return;
  if (isDraft && !["finish", "push"].includes(action)) return;
  if (["finish", "push", "claim", "release", "refuse", "cancel", "next"].includes(action) && !currentTicket()) {
    return;
  }

  event.preventDefault();
  if (action === "help") {
    openShortcuts();
    return;
  }
  if (action === "focus") {
    focusDraft();
    return;
  }
  if (action === "next") {
    nextTicket();
    return;
  }
  doAction(action);
}

/* ------------------------------ boot ------------------------------ */

function init() {
  state.shortcuts = loadShortcuts();
  updateShortcutLabels();
  els.autoclaim.checked = localStorage.getItem("ngzr.autoclaim") === "1";

  els.autoclaim.addEventListener("change", () => {
    localStorage.setItem("ngzr.autoclaim", els.autoclaim.checked ? "1" : "0");
  });
  els.queueSearch.addEventListener("input", () => {
    state.queueQuery = els.queueSearch.value;
    renderQueue();
  });
  els.queueFilters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.queueFilter = button.dataset.filter || "all";
    for (const chip of els.queueFilters.querySelectorAll(".chip")) {
      chip.classList.toggle("active", chip === button);
    }
    renderQueue();
  });
  els.logout.addEventListener("click", logout);
  els.usersClose.addEventListener("click", closeUsers);
  els.keysClose.addEventListener("click", closeKeys);
  els.keyCreateForm.addEventListener("submit", createKey);
  els.copyKeyBtn.addEventListener("click", copyNewKey);
  els.keysModal.addEventListener("click", (event) => {
    if (event.target === els.keysModal) closeKeys();
  });
  els.usersModal.addEventListener("click", (event) => {
    if (event.target === els.usersModal) closeUsers();
  });
  els.userCreateForm.addEventListener("submit", createUser);
  els.cmdClaim.addEventListener("click", () => doAction("claim"));
  els.cmdPush.addEventListener("click", () => doAction("push"));
  els.cmdFinish.addEventListener("click", () => doAction("finish"));
  els.cmdRelease.addEventListener("click", () => doAction("release"));
  els.cmdRefuse.addEventListener("click", () => doAction("refuse"));
  els.cmdCancel.addEventListener("click", () => doAction("cancel"));
  els.cmdShortcuts.addEventListener("click", openShortcuts);
  els.shortcutClose.addEventListener("click", closeShortcuts);
  els.shortcutReset.addEventListener("click", resetShortcuts);
  els.shortcutModal.addEventListener("click", (event) => {
    if (event.target === els.shortcutModal) closeShortcuts();
  });
  document.addEventListener("keydown", handleGlobalShortcut);
  syncCommandbar();

  loadSession();
}

init();
