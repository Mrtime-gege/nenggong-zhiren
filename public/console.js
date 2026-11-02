/* Human Provider — operator console (vanilla JS, no build step) */

const $ = (id) => document.getElementById(id);

const els = {
  userLabel: $("userLabel"),
  logout: $("logout"),
  queueToggle: $("queueToggle"),
  commandPaletteBtn: $("commandPaletteBtn"),
  usersModal: $("usersModal"),
  usersClose: $("usersClose"),
  userCreateForm: $("userCreateForm"),
  newUsername: $("newUsername"),
  newPassword: $("newPassword"),
  newRole: $("newRole"),
  userCreateBtn: $("userCreateBtn"),
  userList: $("userList"),
  usersError: $("usersError"),
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
  mobileViewTabs: $("mobileViewTabs"),
  mobileQueueCount: $("mobileQueueCount"),
  detail: $("detail"),
  autoclaim: $("autoclaim"),
  toast: $("toast"),
  commandTicket: $("commandTicket"),
  commandState: $("commandState"),
  cmdClaim: $("cmdClaim"),
  cmdNext: $("cmdNext"),
  cmdTemplates: $("cmdTemplates"),
  cmdTransfer: $("cmdTransfer"),
  cmdTakeover: $("cmdTakeover"),
  templateModal: $("templateModal"),
  templateClose: $("templateClose"),
  templateList: $("templateList"),
  templateForm: $("templateForm"),
  templateName: $("templateName"),
  templateContent: $("templateContent"),
  templateFormTitle: $("templateFormTitle"),
  templateReset: $("templateReset"),
  templateError: $("templateError"),
  templateVisibility: $("templateVisibility"),
  templateScope: $("templateScope"),
  transferModal: $("transferModal"),
  transferClose: $("transferClose"),
  transferTarget: $("transferTarget"),
  transferNote: $("transferNote"),
  transferConfirm: $("transferConfirm"),
  transferCancel: $("transferCancel"),
  transferError: $("transferError"),
  cmdThink: $("cmdThink"),
  cmdPush: $("cmdPush"),
  cmdFinish: $("cmdFinish"),
  cmdRelease: $("cmdRelease"),
  cmdRefuse: $("cmdRefuse"),
  cmdCancel: $("cmdCancel"),
  cmdShortcuts: $("cmdShortcuts"),
  cmdMore: $("cmdMore"),
  commandMenu: $("commandMenu"),
  subpageOverlay: $("subpageOverlay"),
  subpageFrames: $("subpageFrames"),
  subpageLoading: $("subpageLoading"),
  shortcutModal: $("shortcutModal"),
  shortcutList: $("shortcutList"),
  shortcutClose: $("shortcutClose"),
  shortcutReset: $("shortcutReset"),
  attachmentModal: $("attachmentModal"),
  attachmentTitle: $("attachmentTitle"),
  attachmentMeta: $("attachmentMeta"),
  attachmentBody: $("attachmentBody"),
  attachmentDownload: $("attachmentDownload"),
  attachmentWarning: $("attachmentWarning"),
  attachmentClose: $("attachmentClose"),
};

const state = {
  user: null,
  operator: "",
  role: "",
  csrfToken: "",
  connected: false,
  me: null,
  config: null,
  features: null,
  tickets: [],
  stats: null,
  selectedId: null,
  drafts: new Map(),
  toolDrafts: new Map(),
  aiRuns: new Map(),
  aiCards: new Map(),
  quickBarInfo: null,
  quickBarInfoAt: 0,
  quickBarInfoLoading: false,
  aiSelectedCards: new Map(),
  aiAutoCardsShown: new Map(),
  aiPrompts: new Map(),
  autoQueueSeen: null,
  autoClaimSeen: null,
  autoAttempted: new Set(),
  autoAiNotified: new Set(),
  autoAiErrorNotified: new Set(),
  busy: false,
  pollTimer: null,
  lastQueued: null,
  alertedTickets: new Set(),
  queueQuery: "",
  queueFilter: "all",
  mobileView: "queue",
  shortcuts: null,
  recordingShortcut: null,
  httpCache: new Map(),
  detailLoading: null,
  minimapMode: "overlay",
  minimapSlider: "always",
  minimapLayout: "auto",
};

const DRAFT_STORAGE_PREFIX = "ngzr.drafts.v1:";
const SELECTED_STORAGE_KEY = "ngzr.selectedTicket";
const INSPECTOR_TAB_KEY = "ngzr.inspectorTab";
const INSPECTOR_COLLAPSED_KEY = "ngzr.inspectorCollapsed";
const MINIMAP_MODE_KEY = "ngzr.minimapMode";
const MINIMAP_MODES = new Set(["overlay", "semantic"]);
const MINIMAP_SLIDER_KEY = "ngzr.minimapSlider";
const MINIMAP_SLIDER_MODES = new Set(["hover", "always"]);
const MINIMAP_LAYOUT_KEY = "ngzr.minimapLayout";
const MINIMAP_LAYOUTS = new Set(["auto", "fit", "scroll"]);
let draftSaveTimer = null;

function normalizeMinimapMode(value) {
  return MINIMAP_MODES.has(value) ? value : "overlay";
}

function loadMinimapMode() {
  try {
    return normalizeMinimapMode(localStorage.getItem(MINIMAP_MODE_KEY));
  } catch {
    return "overlay";
  }
}

function normalizeMinimapSlider(value) {
  return MINIMAP_SLIDER_MODES.has(value) ? value : "always";
}

function loadMinimapSlider() {
  try {
    return normalizeMinimapSlider(localStorage.getItem(MINIMAP_SLIDER_KEY));
  } catch {
    return "always";
  }
}

function setMinimapSlider(mode) {
  const next = normalizeMinimapSlider(mode);
  state.minimapSlider = next;
  if (detail?.els?.threadMinimap) detail.els.threadMinimap.dataset.minimapSlider = next;
  try { localStorage.setItem(MINIMAP_SLIDER_KEY, next); } catch { /* optional */ }
  return next;
}

function normalizeMinimapLayout(value) {
  return MINIMAP_LAYOUTS.has(value) ? value : "auto";
}

function loadMinimapLayout() {
  try {
    return normalizeMinimapLayout(localStorage.getItem(MINIMAP_LAYOUT_KEY));
  } catch {
    return "auto";
  }
}

function setMinimapLayout(layout) {
  const next = normalizeMinimapLayout(layout);
  state.minimapLayout = next;
  if (detail?.els?.threadMinimap) detail.els.threadMinimap.dataset.minimapLayoutPreference = next;
  try { localStorage.setItem(MINIMAP_LAYOUT_KEY, next); } catch { /* optional */ }
  scheduleThreadMinimapUpdate(detail);
  return next;
}

function setMinimapMode(mode) {
  const next = normalizeMinimapMode(mode);
  state.minimapMode = next;
  if (detail?.els?.threadMinimap) {
    detail.els.threadMinimap.dataset.minimapMode = next;
    const ticket = currentTicket();
    if (ticket) {
      detail.minimapSignature = "";
      renderThreadMinimap(ticket, detail);
    }
  }
  try { localStorage.setItem(MINIMAP_MODE_KEY, next); } catch { /* optional */ }
  return next;
}

function draftStorageKey() {
  return `${DRAFT_STORAGE_PREFIX}${state.operator || "anonymous"}`;
}

function loadDraftsForUser() {
  state.drafts = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(draftStorageKey()) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    for (const [ticketId, value] of Object.entries(raw).slice(-80)) {
      if (typeof value === "string" && value) state.drafts.set(ticketId, value.slice(0, 40_000));
    }
  } catch {
    /* drafts are a convenience; corrupt storage must not block work */
  }
}

function saveDraftsNow() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = null;
  try {
    const entries = [...state.drafts.entries()]
      .filter(([, value]) => typeof value === "string" && value.trim())
      .slice(-80);
    localStorage.setItem(draftStorageKey(), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* quota/hidden storage: keep the in-memory draft */
  }
}

function setDraft(ticketId, text) {
  if (!ticketId) return;
  if (text) state.drafts.set(ticketId, text.slice(0, 40_000));
  else state.drafts.delete(ticketId);
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraftsNow, 350);
}

function rememberSelectedTicket(ticketId) {
  try {
    if (ticketId) sessionStorage.setItem(SELECTED_STORAGE_KEY, ticketId);
    else sessionStorage.removeItem(SELECTED_STORAGE_KEY);
  } catch { /* storage is optional */ }
}

const SHORTCUT_DEFS = [
  { id: "think", label: "作为思考发送", desc: "把当前编辑区内容流式发送为 reasoning" },
  { id: "push", label: "作为正文推送", desc: "把当前编辑区内容立即发送为正文" },
  { id: "finish", label: "正文并完成", desc: "发送当前正文并结束票据" },
  { id: "claim", label: "认领票据", desc: "认领当前选中的待认领票据" },
  { id: "release", label: "放回队列", desc: "把未开始的票据放回队列" },
  { id: "refuse", label: "拒答", desc: "以 content_filter 结束" },
  { id: "cancel", label: "取消请求", desc: "中止当前请求" },
  { id: "focus", label: "聚焦回复框", desc: "把光标放到回复编辑器" },
  { id: "next", label: "下一张票据", desc: "在队列中切换选中票据" },
  { id: "help", label: "快捷键面板", desc: "打开这个设置窗口" },
];

const DEFAULT_SHORTCUTS = Object.freeze({
  think: "Mod+Enter",
  push: "Shift+Enter",
  finish: "Mod+Shift+Enter",
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

function contextSection(title, hint = "") {
  const section = el("section", "context-section");
  const head = el("div", "context-section-head");
  head.append(el("span", "context-section-title", title));
  if (hint) head.append(el("span", "context-section-hint", hint));
  const body = el("div", "context-section-body");
  section.append(head, body);
  return { section, body };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applySavedSplits(workspace, panes) {
  const inspectorWidth = Number(localStorage.getItem("ngzr.inspectorWidth"));
  if (Number.isFinite(inspectorWidth) && inspectorWidth >= 260) {
    workspace.style.setProperty("--inspector-width", `${inspectorWidth}px`);
  }
  const paneWidth = Number(localStorage.getItem("ngzr.paneWidth"));
  if (Number.isFinite(paneWidth) && paneWidth >= 260) {
    panes.style.setProperty("--pane-width", `${paneWidth}px`);
    requestAnimationFrame(() => {
      const total = panes.getBoundingClientRect().width;
      const max = Math.max(260, total - 260);
      if (paneWidth > max) panes.style.setProperty("--pane-width", `${Math.round(max)}px`);
    });
  }
}

function createSplitter(kind) {
  const inspectorSplit = kind === "inspector";
  const handle = el("div", `splitter splitter-${kind}`);
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.title = inspectorSplit
    ? "拖动调整工具区宽度，双击恢复默认"
    : "拖动调整对话/输出宽度，双击恢复默认";

  handle.addEventListener("dblclick", () => {
    if (inspectorSplit) {
      handle.parentElement.style.removeProperty("--inspector-width");
      localStorage.removeItem("ngzr.inspectorWidth");
    } else {
      handle.parentElement.style.removeProperty("--pane-width");
      localStorage.removeItem("ngzr.paneWidth");
    }
  });

  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    if (inspectorSplit) {
      const workspace = handle.parentElement;
      const inspector = workspace.lastElementChild;
      const next = clampNumber(inspector.getBoundingClientRect().width - direction * 20, 260, 720);
      workspace.style.setProperty("--inspector-width", `${Math.round(next)}px`);
      localStorage.setItem("ngzr.inspectorWidth", String(Math.round(next)));
    } else {
      const panes = handle.parentElement;
      const current = panes.firstElementChild.getBoundingClientRect().width;
      const total = panes.getBoundingClientRect().width;
      const next = clampNumber(current + direction * 24, 260, Math.max(260, total - 260));
      panes.style.setProperty("--pane-width", `${Math.round(next)}px`);
      localStorage.setItem("ngzr.paneWidth", String(Math.round(next)));
    }
  });

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    let move;
    let end;
    if (inspectorSplit) {
      const workspace = handle.parentElement;
      const inspector = workspace.lastElementChild;
      const startWidth = inspector.getBoundingClientRect().width;
      const maxWidth = Math.max(280, Math.min(720, workspace.getBoundingClientRect().width - 360));
      move = (moveEvent) => {
        const width = clampNumber(startWidth - (moveEvent.clientX - startX), 260, maxWidth);
        workspace.style.setProperty("--inspector-width", `${Math.round(width)}px`);
      };
      end = () => {
        const width = Math.round(inspector.getBoundingClientRect().width);
        localStorage.setItem("ngzr.inspectorWidth", String(width));
      };
    } else {
      const panes = handle.parentElement;
      const left = panes.firstElementChild.getBoundingClientRect().width;
      const total = panes.getBoundingClientRect().width;
      move = (moveEvent) => {
        const width = clampNumber(left + moveEvent.clientX - startX, 260, Math.max(260, total - 260));
        panes.style.setProperty("--pane-width", `${Math.round(width)}px`);
      };
      end = () => {
        const width = Math.round(panes.firstElementChild.getBoundingClientRect().width);
        localStorage.setItem("ngzr.paneWidth", String(width));
      };
    }
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      end();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });

  return handle;
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
  if (ticket.purpose && ticket.purpose.id) {
    return {
      id: ticket.purpose.id,
      queueLabel: ticket.purpose.label || ticket.purpose.queueLabel || "主请求",
      detailLabel: ticket.purpose.detail || ticket.purpose.detailLabel || "主请求",
      tone: ticket.purpose.tone || "mine",
      rank: Number(ticket.purpose.rank) || 0,
    };
  }
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
  const priority = (Number(b.priority) || 0) - (Number(a.priority) || 0);
  return priority || purposeOf(a).rank - purposeOf(b).rank || a.createdAt - b.createdAt;
}

function isContextMessage(message) {
  if (message.role === "system" || message.role === "developer") return true;
  if (message.role !== "user") return false;
  if (typeof message.content !== "string") return false;
  const text = message.content.trimStart();
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
  if (ticket.preview) return String(ticket.preview);
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


let audioUnlockInstalled = false;

function unlockAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  } catch {
    /* audio is a nice-to-have */
  }
}

function installAudioUnlock() {
  if (audioUnlockInstalled) return;
  audioUnlockInstalled = true;
  const unlock = () => unlockAudio();
  document.addEventListener("pointerdown", unlock, { passive: true });
  document.addEventListener("keydown", unlock);
}

function beep() {
  try {
    if (!state.connected) return;
    unlockAudio();
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

function browserNotify(title, body, tag) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, tag });
  }
}

function maybeBeep() {
  const queuedTickets = state.tickets.filter((ticket) => ticket.state === "queued");
  const queued = state.stats?.queued ?? queuedTickets.length;
  const preferences = state.preferences || {};
  const oldest = queuedTickets.sort((a, b) => a.createdAt - b.createdAt)[0];
  const waited = oldest ? Math.max(0, Math.round((Date.now() - oldest.createdAt) / 1000)) : 0;
  if (state.lastQueued !== null && queued > state.lastQueued) {
    if (preferences.notificationSound !== false) beep();
    if (preferences.browserNotifications !== false) {
      browserNotify("有新的请求等待接单", `队列 ${queued} 个，最早已等待 ${waited} 秒`, "ngzr-new-ticket");
    }
  }
  if (
    oldest &&
    preferences.browserNotifications !== false &&
    Number(preferences.queueAlertSeconds) > 0 &&
    waited >= Number(preferences.queueAlertSeconds) &&
    !state.alertedTickets.has(oldest.id)
  ) {
    state.alertedTickets.add(oldest.id);
    browserNotify("请求排队超时提醒", `已等待 ${waited} 秒，队列 ${queued} 个`, "ngzr-queue-alert");
  }
  if (!queued) state.alertedTickets.clear();
  document.title = queued > 0 ? `(${queued}) 新请求 · 能工智人` : "能工智人 · 网页工作台";
  state.lastQueued = queued;
}

/* ------------------------------ API ------------------------------ */

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD" && state.csrfToken) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }
  const cached = method === "GET" ? state.httpCache.get(path) : null;
  if (cached?.etag) headers["If-None-Match"] = cached.etag;

  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 304 && cached) return cached.data;
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
  if (method === "GET" && response.ok) {
    const etag = response.headers.get("etag");
    if (etag) state.httpCache.set(path, { etag, data });
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
    state.models = Array.isArray(me.models) ? me.models : [];
    loadDraftsForUser();
    state.csrfToken = me.csrfToken;
    state.config = me.config || null;
    state.features = me.features || null;
    state.preferences = me.preferences || null;
    state.aiAssist = me.aiAssist || null;
    state.connected = true;
    state.lastQueued = null;
    if (state.preferences?.autoClaimDefault && localStorage.getItem("ngzr.autoclaim") === null) {
      els.autoclaim.checked = true;
    }
    els.userLabel.textContent = `${me.user.username} · ${me.user.role === "admin" ? "管理员" : "人工回复员"}`;
    window.NGZRNAV?.render(me.user.role, me.features);
    if (me.user.role === "admin" && (location.hash === "#status" || new URLSearchParams(location.search).get("page") === "status")) {
      openSubpage("/console/status", "状态");
    }
    setStatus("ok", `${me.user.username} 已登录`);
    refreshQuickBarInfo(true);
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
  window.NGZRPasswordStrength?.hide(els.newPassword);
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
    window.NGZRPasswordStrength?.hide(els.newPassword);
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
  const password = window.prompt(`为 ${username} 设置新密码（至少 8 位）：`);
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
    let data = await api("/op/api/tickets?compact=1");
    mergeTicketList(Array.isArray(data.tickets) ? data.tickets : []);
    state.stats = data.stats || null;

    if (els.autoclaim.checked && !state.busy) {
      const claimed = await maybeAutoClaim();
      if (claimed) {
        data = await api("/op/api/tickets?compact=1");
        mergeTicketList(Array.isArray(data.tickets) ? data.tickets : []);
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
    if (state.connected) {
      const delay = document.hidden ? 5_000 : state.tickets.some(isActive) ? 1_200 : 2_500;
      state.pollTimer = setTimeout(pollOnce, delay);
    }
  }
}

async function refreshOnce() {
  if (!state.connected) return;
  const data = await api("/op/api/tickets?compact=1");
  mergeTicketList(Array.isArray(data.tickets) ? data.tickets : []);
  state.stats = data.stats || null;
  render();
}

async function maybeAutoClaim() {
  if (state.tickets.some((ticket) => isActive(ticket) && ticket.claimedBy === state.operator)) return false;
  const busySessions = new Set(state.tickets
    .filter((ticket) => ticket.sessionId && isActive(ticket) && ticket.state !== "queued")
    .map((ticket) => ticket.sessionId));
  const next = state.tickets
    .filter((ticket) => ticket.state === "queued" && !(ticket.sessionId && busySessions.has(ticket.sessionId)))
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
  if (!state.selectedId) {
    try {
      const remembered = sessionStorage.getItem(SELECTED_STORAGE_KEY);
      if (remembered && state.tickets.some((ticket) => ticket.id === remembered)) {
        state.selectedId = remembered;
      }
    } catch { /* optional */ }
  }
  if (state.selectedId) return;

  const mine = state.tickets.find((ticket) => isActive(ticket) && ticket.claimedBy === state.operator);
  const queued = state.tickets
    .filter((ticket) => ticket.state === "queued")
    .sort(queuePriority)[0];
  const active = state.tickets.filter((ticket) => isActive(ticket)).sort(queuePriority)[0];
  const chosen = mine || queued || active || state.tickets[0];
  state.selectedId = chosen ? chosen.id : null;
  rememberSelectedTicket(state.selectedId);
  if (state.selectedId && !state.drafts.has(state.selectedId)) state.drafts.set(state.selectedId, "");
}

function mergeTicketList(next) {
  const previous = new Map(state.tickets.map((ticket) => [ticket.id, ticket]));
  state.tickets = next.map((ticket) => {
    const old = previous.get(ticket.id);
    if (!old || !Array.isArray(old.messages)) return ticket;
    return {
      ...ticket,
      messages: old.messages,
      attachments: old.attachments,
      tools: old.tools,
      toolChoice: old.toolChoice,
      responseFormat: old.responseFormat,
      toolCalls: old.toolCalls,
    };
  });
}

async function loadTicketDetail(ticketId) {
  if (state.detailLoading === ticketId) return;
  state.detailLoading = ticketId;
  try {
    const data = await api(`/op/api/tickets/${encodeURIComponent(ticketId)}`);
    const full = data.ticket;
    if (!full) return;
    const index = state.tickets.findIndex((ticket) => ticket.id === ticketId);
    if (index >= 0) state.tickets[index] = { ...state.tickets[index], ...full };
    if (state.selectedId === ticketId) render();
  } catch (error) {
    toast(`加载票据详情失败：${error.message}`);
  } finally {
    state.detailLoading = null;
  }
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
  notifyAutoAiState(ticket);
  updateDetail(ticket);
  applyPendingAiHelp(ticket);
  if (!Array.isArray(ticket.messages)) loadTicketDetail(ticket.id);
  else if (ticket.aiPending?.status === "ready" && !Object.hasOwn(ticket.aiPending, "content")) {
    // compact list carries only aiPending status; fetch the full proposal once
    // so a result that arrived after claim can still be auto-filled.
    loadTicketDetail(ticket.id);
  }
}


function notifyAutoAiState(ticket) {
  if (!ticket || ticket.claimedBy !== state.operator) return;
  if (isAutoAiRunning(ticket)) {
    if (!state.autoAiNotified.has(ticket.id)) {
      state.autoAiNotified.add(ticket.id);
      toast("AI 辅助正在自动生成，结果会显示在 AI 子页");
    }
    return;
  }
  if (ticket.aiPending?.status === "error" && isAutoAiPending(ticket)) {
    if (!state.autoAiErrorNotified.has(ticket.id)) {
      state.autoAiErrorNotified.add(ticket.id);
      toast("自动 AI 辅助失败，可稍后手动生成");
    }
  }
}

function applyPendingAiHelp(ticket) {
  if (!state.aiAssist?.enabled || !state.aiAssist?.allowed) return;
  const pending = ticket?.aiPending;
  if (!pending || !isAutoAiPending(ticket)) return;
  if (ticket.claimedBy !== state.operator || !isTicketEditable(ticket)) return;
  if (!detail || detail.id !== ticket.id) return;
  if (pending.status === "running") {
    if (detail.aiAutoLoadingAt !== pending.createdAt) {
      detail.aiAutoLoadingAt = pending.createdAt;
      showAiLoading(detail, pending.createdAt);
    }
    return;
  }
  if (pending.status === "error") {
    if (detail.aiAutoErrorAt === pending.createdAt) return;
    detail.aiAutoErrorAt = pending.createdAt;
    detail.aiRunDismissed = false;
    const run = {
      status: "error",
      task: "reply",
      relay: true,
      error: pending.error || "自动 AI 辅助失败。",
      startedAt: pending.createdAt,
    };
    state.aiRuns.set(ticket.id, run);
    renderAiRun(ticket, detail, run);
    return;
  }
  if (pending.status !== "ready") return;
  // Compact queue records carry only aiPending.status. Do not render an empty
  // result; wait for the full proposal that includes content/toolCalls.
  if (!Object.hasOwn(pending, "content") && !Object.hasOwn(pending, "toolCalls")) {
    loadTicketDetail(ticket.id);
    return;
  }
  if (detail.aiAutoShownAt === pending.createdAt) return;
  if (state.aiAutoCardsShown.get(ticket.id) === pending.createdAt) return;
  detail.aiAutoShownAt = pending.createdAt;
  state.aiAutoCardsShown.set(ticket.id, pending.createdAt);
  state.aiRuns.set(ticket.id, {
    status: "done",
    task: "reply",
    relay: true,
    startedAt: pending.createdAt,
    autoPendingAt: pending.createdAt,
  });
  detail.els.aiPanel.classList.add("hidden");
  addAiCard(ticket, detail, {
    reasoning: pending.reasoning || "",
    content: pending.content || "",
    toolCalls: pending.toolCalls,
    source: pending.source || "auto",
    finishReason: pending.finishReason || "",
    usage: pending.usage || null,
    createdAt: pending.createdAt,
  });
  updateComposer(ticket, detail);
  toast("AI 结果已加入 AI 子页，请选择后填入或追加");
}

function showEmpty() {
  detail?.minimapObserver?.disconnect();
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

function setMobileView(view) {
  state.mobileView = view === "detail" ? "detail" : "queue";
  document.body.dataset.mobileView = state.mobileView;
  for (const button of els.mobileViewTabs?.querySelectorAll("[data-mobile-view]") || []) {
    const active = button.dataset.mobileView === state.mobileView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
}

function updateMobileQueueCount() {
  if (!els.mobileQueueCount) return;
  const queued = state.tickets.filter((ticket) => ticket.state === "queued").length;
  els.mobileQueueCount.textContent = queued ? `(${queued})` : "";
}

function renderStats() {
  const stats = state.stats || {};
  const active = (stats.claimed || 0) + (stats.streaming || 0) + (stats.finishing || 0);
  const signature = [stats.queued, active, stats.avgClaimMs, stats.completed, stats.failed, stats.cancelled].join(":");
  if (els.stats.dataset.signature === signature) return;
  els.stats.dataset.signature = signature;
  els.stats.replaceChildren(
    statChip("待认领", stats.queued ?? 0, "amber"),
    statChip("进行中", active, "teal"),
    statChip("平均等待", stats.avgClaimMs ? fmtMs(stats.avgClaimMs) : "—", ""),
    statChip("已完成", stats.completed ?? 0, ""),
  );
}

function queueItem(ticket, group = null) {
  const active = isActive(ticket);
  const selected = group ? group.tickets.some((item) => item.id === state.selectedId) : ticket.id === state.selectedId;
  const button = el("button", `qitem${selected ? " selected" : ""}${active ? " is-live" : " recent"}`);
  button.type = "button";
  button.dataset.state = ticket.state;
  button.addEventListener("click", () => {
    state.selectedId = ticket.id;
    rememberSelectedTicket(ticket.id);
    render();
    if (window.matchMedia("(max-width: 780px)").matches) setMobileView("detail");
  });

  const top = el("div", "qitem-top");
  const model = el("span", "qitem-model", ticket.model);
  model.title = ticket.model;
  top.append(model);
  top.append(badge(STATE_LABELS[ticket.state] || ticket.state, stateTone(ticket.state)));
  top.append(el("span", "qitem-mode", ticket.stream ? "SSE" : "JSON"));
  if (ticket.sessionId) {
    const count = group?.tickets?.length || 1;
    const sessionChip = el("span", "qitem-session", count > 1 ? `会话 ${count} 轮` : `#${ticket.sessionTurn || 1}`);
    sessionChip.title = `会话 ${ticket.sessionId}`;
    top.append(sessionChip);
  }
  if (group?.queuedCount > 1) {
    top.append(el("span", "qitem-session", `${group.queuedCount} 轮待处理`));
  }
  if (Number(ticket.priority) >= 2) {
    const priority = el("span", "qitem-priority", Number(ticket.priority) === 3 ? "紧急" : "高");
    priority.dataset.priority = String(ticket.priority);
    top.append(priority);
  }
  for (const tag of (ticket.tags || []).slice(0, 3)) {
    top.append(el("span", "qitem-tag", tag));
  }
  if ((ticket.noteCount || 0) > 0) {
    top.append(el("span", "qitem-note-count", `备注 ${ticket.noteCount}`));
  }

  const rawPreview = previewOf(ticket).replace(/\s+/g, " ").trim() || "(空)";
  const preview = el("div", "qitem-preview", rawPreview.slice(0, 240));
  preview.title = rawPreview;

  const purpose = purposeOf(ticket);
  const foot = el("div", "qitem-foot");
  const caller = el("span", "qitem-caller", ticket.caller || "caller");
  caller.title = ticket.caller || "caller";
  foot.append(caller);
  const ownerName = ticket.claimedBy || ticket.preferredOperator;
  if (ownerName) {
    foot.append(el("span", "qitem-dot"));
    const owner = el("span", `qitem-owner${ticket.claimedBy ? "" : " preferred"}`, `@${ownerName}`);
    owner.title = ticket.claimedBy ? `当前回复员：${ownerName}` : `首选回复员：${ownerName}`;
    foot.append(owner);
  }
  foot.append(el("span", "qitem-dot"));
  const purposeLabel = el("span", "qitem-purpose", purpose.queueLabel);
  purposeLabel.title = purpose.detailLabel;
  purposeLabel.dataset.tone = purpose.tone;
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
    const haystack = ticket.searchText || [
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
  if (state.queueFilter === "mine") return ticket.claimedBy === state.operator;
  return true;
}

function buildConversationGroups(tickets) {
  const groups = new Map();
  for (const ticket of tickets) {
    const key = ticket.sessionId ? `session:${ticket.sessionId}` : `ticket:${ticket.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, sessionId: ticket.sessionId || null, tickets: [], active: [], queued: [], done: [] };
      groups.set(key, group);
    }
    group.tickets.push(ticket);
    if (ticket.state === "queued") group.queued.push(ticket);
    else if (isActive(ticket)) group.active.push(ticket);
    else group.done.push(ticket);
  }
  for (const group of groups.values()) {
    group.tickets.sort((a, b) => a.createdAt - b.createdAt);
    group.active.sort(queuePriority);
    group.queued.sort(queuePriority);
    group.done.sort((a, b) => b.createdAt - a.createdAt);
    group.representative = group.active[0] || group.queued[0] || group.done[0] || group.tickets[0];
    group.queuedCount = group.queued.length;
    group.activeNonQueued = group.active.length > 0;
  }
  return [...groups.values()];
}

function groupMatches(group) {
  const query = state.queueQuery.trim().toLowerCase();
  if (query && !group.tickets.some((ticket) => queueMatches(ticket))) return false;
  if (state.queueFilter === "queued") return group.queued.length > 0;
  if (state.queueFilter === "active") return group.activeNonQueued;
  if (state.queueFilter === "recent") return group.tickets.some((ticket) => !isActive(ticket));
  if (state.queueFilter === "mine") return group.tickets.some((ticket) => ticket.claimedBy === state.operator);
  return true;
}

function renderQueue() {
  updateMobileQueueCount();
  const signature = JSON.stringify({
    selected: state.selectedId,
    query: state.queueQuery,
    filter: state.queueFilter,
    tickets: state.tickets.map((ticket) => [
      ticket.id, ticket.state, ticket.sessionId, ticket.sessionTurn, ticket.claimedBy,
      ticket.preferredOperator, ticket.priority, ticket.noteCount, ticket.queueWaitMs,
      ticket.tags || [], ticket.preview || "",
    ]),
  });
  if (els.queue.dataset.signature === signature) return;
  const groups = buildConversationGroups(state.tickets).filter(groupMatches);
  if (!groups.length) {
    const empty = el("div", "queue-group");
    const head = el("div", "queue-group-head");
    head.append(el("span", "", state.tickets.length ? "没有匹配" : "队列为空"));
    empty.append(head);
    empty.append(el("div", "qitem-preview", state.tickets.length ? "换一个搜索词或筛选条件。" : "等待调用方请求…"));
    els.queue.replaceChildren(empty);
    return;
  }

  const buckets = [
    {
      label: "待认领",
      items: groups.filter((group) => group.queued.length && !group.activeNonQueued)
        .sort((a, b) => queuePriority(a.representative, b.representative)),
    },
    {
      label: "进行中",
      items: groups.filter((group) => group.activeNonQueued)
        .sort((a, b) => queuePriority(a.representative, b.representative)),
    },
    {
      label: "最近结束",
      items: groups.filter((group) => !group.queued.length && !group.activeNonQueued)
        .sort((a, b) => b.representative.createdAt - a.representative.createdAt)
        .slice(0, 12),
    },
  ];

  const scrollTop = els.queue.scrollTop;
  const fragment = document.createDocumentFragment();
  for (const bucket of buckets) {
    if (!bucket.items.length) continue;
    const wrap = el("div", "queue-group");
    const head = el("div", "queue-group-head");
    head.append(el("span", "", bucket.label));
    head.append(el("span", "", String(bucket.items.length).padStart(2, "0")));
    wrap.append(head);
    for (const group of bucket.items) wrap.append(queueItem(group.representative, group));
    fragment.append(wrap);
  }
  els.queue.replaceChildren(fragment);
  els.queue.scrollTop = scrollTop;
  els.queue.dataset.signature = JSON.stringify({
    selected: state.selectedId,
    query: state.queueQuery,
    filter: state.queueFilter,
    tickets: state.tickets.map((ticket) => [
      ticket.id, ticket.state, ticket.sessionId, ticket.sessionTurn, ticket.claimedBy,
      ticket.preferredOperator, ticket.priority, ticket.noteCount, ticket.queueWaitMs,
      ticket.tags || [], ticket.preview || "",
    ]),
  });
}

function syncDraftMeta(d) {
  if (!d?.els?.draft) return;
  const value = d.els.draft.value || "";
  d.els.draftCount.textContent = `${value.length.toLocaleString("zh-CN")} 字`;
  d.els.draft.style.removeProperty("height");
}

function setupEditorSplitter(splitter, wrap, composer) {
  let startY = 0;
  let startHeight = 0;
  const apply = (height, persist = false) => {
    const max = Math.max(220, wrap.getBoundingClientRect().height - 190);
    const next = Math.max(220, Math.min(max, Math.round(height)));
    wrap.style.setProperty("--editor-height", `${next}px`);
    if (persist) {
      try { localStorage.setItem("ngzr.editorHeight", String(next)); } catch { /* optional */ }
    }
  };
  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    startY = event.clientY;
    startHeight = composer.getBoundingClientRect().height;
    splitter.setPointerCapture?.(event.pointerId);
    splitter.classList.add("dragging");
    const move = (moveEvent) => apply(startHeight - (moveEvent.clientY - startY));
    const end = () => {
      splitter.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const current = Math.round(composer.getBoundingClientRect().height);
      try { localStorage.setItem("ngzr.editorHeight", String(current)); } catch { /* optional */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
  splitter.addEventListener("dblclick", () => apply(300, true));
  splitter.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const current = composer.getBoundingClientRect().height;
    apply(current + (event.key === "ArrowUp" ? 24 : -24), true);
  });
}

function reflowContextWidth() {
  const workspace = detail?.els?.workspace;
  const inspector = detail?.els?.inspector;
  if (!workspace || !inspector || detail.inspectorCollapsed) return;
  const total = workspace.getBoundingClientRect().width;
  if (!total) return;
  const max = Math.max(300, Math.floor(total - 340));
  const configured = Number.parseFloat(workspace.style.getPropertyValue("--context-width"));
  const current = Number.isFinite(configured) ? configured : inspector.getBoundingClientRect().width;
  if (current <= max + 0.5) return;
  workspace.style.setProperty("--context-width", `${max}px`);
  try { localStorage.setItem("ngzr.contextWidth", String(max)); } catch { /* optional */ }
}

function setupContextSplitter(splitter, workspace, inspector) {
  const storageKey = "ngzr.contextWidth";
  const clamp = (width) => {
    const total = workspace.getBoundingClientRect().width || 1200;
    return Math.max(260, Math.min(Math.max(280, total - 340), Math.round(width)));
  };
  let initial = 360;
  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(saved) && saved >= 260) initial = saved;
  } catch { /* optional */ }
  workspace.style.setProperty("--context-width", `${clamp(initial)}px`);
  const apply = (width, persist = false) => {
    const next = clamp(width);
    workspace.style.setProperty("--context-width", `${next}px`);
    if (persist) {
      try { localStorage.setItem(storageKey, String(next)); } catch { /* optional */ }
    }
  };
  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspector.getBoundingClientRect().width;
    splitter.setPointerCapture?.(event.pointerId);
    splitter.classList.add("dragging");
    const move = (moveEvent) => apply(startWidth - (moveEvent.clientX - startX));
    const end = () => {
      splitter.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      try { localStorage.setItem(storageKey, String(Math.round(inspector.getBoundingClientRect().width))); } catch { /* optional */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
  splitter.addEventListener("dblclick", () => apply(360, true));
  splitter.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = inspector.getBoundingClientRect().width;
    apply(current + (event.key === "ArrowLeft" ? 20 : -20), true);
  });
}

function buildDetail(ticket) {
  clearDetailTimers(detail);
  detail?.minimapObserver?.disconnect();
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
  const commandPaletteBtn = el("button", "btn ghost command-palette-btn", "命令 ");
  commandPaletteBtn.type = "button";
  commandPaletteBtn.setAttribute("aria-haspopup", "dialog");
  commandPaletteBtn.setAttribute("aria-controls", "commandPalette");
  commandPaletteBtn.append(el("kbd", "", "⌘K"));
  commandPaletteBtn.addEventListener("click", openCommandPalette);
  const queueToggle = el("button", "btn ghost queue-toggle", document.body.classList.contains("queue-collapsed") ? "展开队列" : "收起队列");
  queueToggle.type = "button";
  queueToggle.addEventListener("click", toggleQueue);
  const inspectorToggle = el("button", "btn ghost inspector-toggle", "隐藏上下文");
  inspectorToggle.type = "button";
  const detailButtons = el("div", "detail-head-buttons");
  detailButtons.append(commandPaletteBtn, queueToggle, inspectorToggle);
  const headActions = el("div", "detail-head-actions");
  headActions.append(detailButtons, badges);
  head.append(titleWrap, headActions);

  const meta = el("div", "meta");
  const purposeHint = el("div", "purpose-hint hidden");
  const sessionBar = el("div", "session-bar hidden");

  const threadPane = el("section", "pane thread-pane");
  const threadHead = el("div", "pane-head thread-head");
  const threadTitle = el("span", "pane-title", "会话");
  const msgCount = el("span", "pane-note", "");
  threadHead.append(threadTitle, msgCount);
  const threadBody = el("div", "thread-body");
  threadBody.id = `thread-body-${ticket.id}`;
  const messages = el("div", "messages");
  const tools = el("div", "tools");
  tools.style.display = "none";
  const threadOutputHead = el("div", "thread-output-head");
  const outputTitle = el("span", "thread-output-title", "已发送");
  const charCount = el("span", "pane-note", "");
  threadOutputHead.append(outputTitle, charCount);
  const transcript = el("div", "transcript placeholder", "还没有发送任何内容。");
  const reasoningBox = el("details", "reasoning-box hidden");
  reasoningBox.open = true;
  const reasoningSummary = el("summary", "reasoning-summary", "已发送思考");
  const reasoningCount = el("span", "reasoning-count", "");
  reasoningSummary.append(reasoningCount);
  const reasoningText = el("pre", "reasoning-text", "");
  reasoningBox.append(reasoningSummary, reasoningText);
  const sentTools = el("div", "sent-toolcalls hidden");
  threadBody.append(messages, tools, threadOutputHead, reasoningBox, transcript, sentTools);
  const threadMinimap = el("div", "thread-minimap hidden");
  threadMinimap.dataset.minimapMode = state.minimapMode;
  threadMinimap.dataset.minimapSlider = state.minimapSlider;
  threadMinimap.dataset.minimapLayoutPreference = state.minimapLayout;
  threadMinimap.setAttribute("aria-label", "会话微缩总览与滚动位置");
  threadMinimap.setAttribute("aria-controls", threadBody.id);
  threadMinimap.setAttribute("role", "scrollbar");
  threadMinimap.setAttribute("aria-orientation", "vertical");
  threadMinimap.setAttribute("aria-valuemin", "0");
  threadMinimap.setAttribute("aria-valuemax", "100");
  threadMinimap.setAttribute("aria-valuenow", "0");
  threadMinimap.tabIndex = 0;
  const minimapClip = el("div", "minimap-clip");
  const minimapContent = el("div", "minimap-content");
  const minimapCanvas = el("canvas", "minimap-canvas hidden");
  minimapCanvas.setAttribute("aria-hidden", "true");
  const minimapViewport = el("div", "minimap-viewport");
  const minimapUnloaded = el("button", "minimap-unloaded hidden");
  minimapUnloaded.type = "button";
  const minimapLatest = el("button", "minimap-latest hidden", "回到最新");
  minimapLatest.type = "button";
  minimapLatest.title = "跳到最新消息";
  const minimapSlider = el("div", "minimap-slider");
  minimapSlider.append(minimapViewport);
  minimapClip.append(minimapContent, minimapCanvas);
  threadMinimap.append(minimapClip, minimapSlider, minimapUnloaded, minimapLatest);
  setupThreadMinimap(threadBody, threadMinimap, minimapClip, minimapContent, minimapViewport, minimapUnloaded, minimapLatest);
  threadPane.append(threadHead, threadBody, threadMinimap);

  const composer = el("div", "composer");
  const label = el("label", "composer-title", "回复草稿");
  const draft = el("textarea");
  draft.placeholder = "在这里写回复…";
  draft.spellcheck = false;
  const draftStatus = el("span", "draft-status", "");
  const draftCount = el("span", "composer-count", "0 字");

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
  const toolCancelEdit = el("button", "btn ghost hidden", "取消修改");
  toolCancelEdit.type = "button";
  const toolTemplate = el("button", "btn ghost", "填充参数模板");
  toolTemplate.type = "button";
  const toolFormat = el("button", "btn ghost", "格式化 JSON");
  toolFormat.type = "button";
  const toolSend = el("button", "btn primary", "发送工具调用并完成");
  toolSend.type = "button";
  toolSend.title = "将当前工具调用作为响应发回调用方；不会在本机执行工具。";
  toolButtons.append(toolAdd, toolCancelEdit, toolTemplate, toolFormat, toolSend);
  const toolHint = el("div", "tool-hint", "工具调用只会返回给调用方，不会在本机执行。Ctrl+Enter 可添加或保存。");
  const toolPending = el("div", "toolcall-pending");
  toolPanel.append(toolTitle, toolSub, toolFilter, toolSelect, toolDesc, toolArgs, toolError, toolButtons, toolHint, toolPending);

  const note = el("div", "composer-note hidden");

  const inspector = el("aside", "inspector context-pane");
  const inspectorHead = el("div", "inspector-head");
  inspectorHead.append(el("span", "", "上下文"));
  inspectorHead.append(el("span", "inspector-hint", "资料 / 当前发送 / 工具 / AI / 更多"));
  const inspectorTabs = el("div", "inspector-tabs");
  const tabButtons = {};
  let aiTabDot = null;
  let aiTabCount = null;
  for (const [key, tabLabel] of [["info", "资料"], ["sent", "当前发送"], ["tools", "工具"], ["ai", "AI"], ["more", "更多"]]) {
    const button = el("button", "inspector-tab");
    button.type = "button";
    button.dataset.tab = key;
    button.append(el("span", "inspector-tab-label", tabLabel));
    if (key === "ai") {
      aiTabDot = el("span", "ai-tab-dot hidden");
      aiTabCount = el("span", "ai-tab-count hidden");
      aiTabDot.setAttribute("aria-hidden", "true");
      aiTabCount.setAttribute("aria-hidden", "true");
      button.append(aiTabDot, aiTabCount);
    }
    button.addEventListener("click", () => activateInspectorTab(current, key));
    tabButtons[key] = button;
    inspectorTabs.append(button);
  }
  const inspectorBody = el("div", "inspector-body context-body");
  const infoSection = el("div", "inspector-tab-panel context-info");
  const infoOverview = contextSection("票据概览", "当前请求");
  infoOverview.body.append(meta, purposeHint);
  const infoDetails = contextSection("请求详情", "协议 / 限制 / 客户端");
  const infoExtra = el("div", "info-extra");
  infoDetails.body.append(infoExtra);
  const infoSession = contextSection("相关会话", "同会话轮次");
  infoSession.body.append(sessionBar);
  infoSection.append(infoOverview.section, infoDetails.section, infoSession.section);
  const sentSection = el("div", "inspector-tab-panel context-sent");
  const sentHead = el("div", "sent-panel-head");
  sentHead.append(el("span", "sent-panel-title", "当前发送"));
  sentHead.append(el("span", "sent-panel-hint", "已发送给调用方"));
  const sentReasoningBlock = el("section", "sent-block sent-reasoning-block");
  const sentReasoningHead = el("div", "sent-block-head");
  const sentReasoningTitle = el("span", "sent-block-title", "思考");
  const sentReasoningCount = el("span", "sent-block-count", "0 字");
  const sentReasoningCopy = el("button", "sent-copy", "复制");
  sentReasoningCopy.type = "button";
  sentReasoningHead.append(sentReasoningTitle, sentReasoningCount, sentReasoningCopy);
  const sentReasoning = el("pre", "sent-content sent-reasoning-content");
  const sentReasoningEmpty = el("div", "sent-empty sent-reasoning-empty", "还没有发送思考");
  sentReasoningBlock.append(sentReasoningHead, sentReasoning, sentReasoningEmpty);
  const sentTextBlock = el("section", "sent-block sent-text-block");
  const sentTextHead = el("div", "sent-block-head");
  const sentTextTitle = el("span", "sent-block-title", "正文");
  const sentTextCount = el("span", "sent-block-count", "0 字");
  const sentTextCopy = el("button", "sent-copy", "复制");
  sentTextCopy.type = "button";
  sentTextHead.append(sentTextTitle, sentTextCount, sentTextCopy);
  const sentText = el("pre", "sent-content sent-text-content");
  const sentTextEmpty = el("div", "sent-empty sent-text-empty", "还没有发送正文");
  sentTextBlock.append(sentTextHead, sentText, sentTextEmpty);
  sentSection.append(sentHead, sentReasoningBlock, sentTextBlock);
  sentReasoningCopy.addEventListener("click", () => copyMessageText(sentReasoning.textContent));
  sentTextCopy.addEventListener("click", () => copyMessageText(sentText.textContent));
  const toolsSection = el("div", "inspector-tab-panel");
  const aiSection = el("div", "inspector-tab-panel");
  const notesSection = el("div", "inspector-tab-panel");
  const toolEmpty = el("div", "inspector-empty", "");
  toolsSection.append(toolPanel, toolEmpty);
  const routingPanel = el("section", "ticket-extra routing-panel");
  const notesPanel = el("section", "ticket-extra notes-panel");
  const moreActions = el("div", "more-action-grid");
  const moreRefresh = el("button", "btn ghost", "刷新票据");
  moreRefresh.type = "button";
  moreRefresh.addEventListener("click", async () => {
    try { await loadTicketDetail(ticket.id); toast("票据已刷新"); }
    catch (error) { toast(error.message || "刷新失败"); }
  });
  const moreCopyId = el("button", "btn ghost", "复制 ID");
  moreCopyId.type = "button";
  moreCopyId.addEventListener("click", () => copyMessageText(ticket.id));
  const moreCopyReply = el("button", "btn ghost", "复制回复");
  moreCopyReply.type = "button";
  moreCopyReply.addEventListener("click", () => {
    const current = currentTicket();
    const value = current?.text || current?.refusal || "";
    if (!value) { toast("当前没有已发送正文"); return; }
    copyMessageText(value);
  });
  const moreHistory = el("button", "btn ghost", "查看历史");
  moreHistory.type = "button";
  moreHistory.addEventListener("click", () => openSubpage(`/console/history?ticket=${encodeURIComponent(ticket.id)}`, "历史"));
  moreActions.append(moreRefresh, moreCopyId, moreCopyReply, moreHistory);
  const quickTemplate = el("button", "btn ghost", "快捷回复");
  quickTemplate.type = "button";
  quickTemplate.addEventListener("click", openTemplateModal);
  const quickTransfer = el("button", "btn ghost", "转交");
  quickTransfer.type = "button";
  quickTransfer.addEventListener("click", openTransfer);
  moreActions.append(quickTemplate, quickTransfer);
  let quickTakeover = null;
  if (state.role === "admin") {
    quickTakeover = el("button", "btn ghost editor-takeover", "管理员接管");
    quickTakeover.type = "button";
    quickTakeover.addEventListener("click", takeoverTicket);
    moreActions.append(quickTakeover);
  }
  const moreActionsSection = contextSection("操作", "刷新 / 复制 / 模板 / 转交");
  moreActionsSection.body.append(moreActions);
  routingPanel.classList.add("context-section");
  notesPanel.classList.add("context-section");
  notesSection.append(moreActionsSection.section, routingPanel, notesPanel);
  inspectorBody.append(infoSection, sentSection, toolsSection, aiSection, notesSection);
  inspector.append(inspectorHead, inspectorTabs, inspectorBody);

  const aiTools = el("div", "ai-tools hidden");
  const aiTrigger = el("button", "btn ghost ai-menu-trigger", "AI 生成");
  aiTrigger.type = "button";
  aiTrigger.title = "生成结果会显示在 AI 子页；不会自动填入草稿或工具";
  aiTrigger.addEventListener("click", () => runAiTask("reply", detail, state.aiPrompts.get(ticket.id) || ""));
  const aiPromptTrigger = el("button", "btn ghost ai-prompt-trigger", "AI 引导");
  aiPromptTrigger.type = "button";
  aiPromptTrigger.title = "给本次/再次生成附加一段方向提示";
  aiPromptTrigger.setAttribute("aria-expanded", "false");
  const aiPromptPopover = el("div", "ai-prompt-popover hidden");
  const aiPromptLabel = el("label", "ai-prompt-label", "生成引导（可选）");
  const aiPromptInput = el("textarea", "ai-prompt-input");
  aiPromptInput.maxLength = 500;
  aiPromptInput.placeholder = "例如：更简短、先确认订单号、用英文回复…";
  aiPromptInput.value = state.aiPrompts.get(ticket.id) || "";
  aiPromptInput.addEventListener("input", () => {
    const value = aiPromptInput.value.trim();
    if (value) state.aiPrompts.set(ticket.id, value);
    else state.aiPrompts.delete(ticket.id);
    updateAiPromptTrigger(detail);
  });
  const aiPromptActions = el("div", "ai-prompt-actions");
  const aiPromptGenerate = el("button", "btn primary", "带引导生成");
  aiPromptGenerate.type = "button";
  const aiPromptClear = el("button", "btn ghost", "清空");
  aiPromptClear.type = "button";
  aiPromptClear.addEventListener("click", () => {
    aiPromptInput.value = "";
    state.aiPrompts.delete(ticket.id);
    updateAiPromptTrigger(detail);
    aiPromptInput.focus();
  });
  aiPromptGenerate.addEventListener("click", () => {
    const instruction = aiPromptInput.value.trim();
    aiPromptPopover.classList.add("hidden");
    aiPromptTrigger.setAttribute("aria-expanded", "false");
    runAiTask("reply", detail, instruction);
  });
  aiPromptActions.append(aiPromptGenerate, aiPromptClear);
  aiPromptInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      aiPromptGenerate.click();
    }
  });
  aiPromptPopover.append(aiPromptLabel, aiPromptInput, aiPromptActions);
  aiPromptTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const hidden = aiPromptPopover.classList.toggle("hidden");
    aiPromptTrigger.setAttribute("aria-expanded", hidden ? "false" : "true");
    if (!hidden) aiPromptInput.focus();
  });
  aiTools.append(aiTrigger, aiPromptTrigger, aiPromptPopover);
  const quickBar = el("div", "quick-bar hidden");
  const aiButtons = { reply: aiTrigger };
  const aiPanel = el("section", "ai-panel hidden");
  const aiPanelHead = el("div", "ai-panel-head");
  const aiPanelTitle = el("span", "", "AI 建议");
  const aiPanelHint = el("span", "ai-panel-hint", "不会自动发送");
  aiPanelHead.append(aiPanelTitle, aiPanelHint);
  const aiPanelBody = el("pre", "ai-panel-body", "");
  const aiPanelActions = el("div", "ai-panel-actions");
  const aiInsert = el("button", "btn primary hidden", "插入草稿");
  aiInsert.type = "button";
  const aiApply = el("button", "btn primary hidden", "应用建议");
  aiApply.type = "button";
  const aiCopy = el("button", "btn ghost", "复制");
  aiCopy.type = "button";
  const aiExpand = el("button", "btn ghost", "展开全文");
  aiExpand.type = "button";
  const aiClose = el("button", "btn ghost", "关闭");
  aiClose.type = "button";
  aiPanelActions.append(aiExpand, aiCopy, aiClose);
  aiPanel.append(aiPanelHead, aiPanelBody, aiPanelActions);
  const aiCardToolbar = el("div", "ai-card-toolbar hidden");
  const aiCardSelection = el("span", "ai-card-selection", "未选择结果");
  const aiReplace = el("button", "btn primary ai-card-replace", "填入");
  aiReplace.type = "button";
  aiReplace.title = "用选中的 AI 结果替换当前草稿和全部工具调用";
  const aiAppend = el("button", "btn ghost ai-card-append", "追加");
  aiAppend.type = "button";
  aiAppend.title = "把选中的 AI 结果追加到当前草稿和工具调用之后";
  aiCardToolbar.append(aiTools, aiCardSelection, aiReplace, aiAppend);
  aiReplace.addEventListener("click", () => applySelectedAiCard("replace"));
  aiAppend.addEventListener("click", () => applySelectedAiCard("append"));
  const aiCardList = el("div", "ai-card-list hidden");
  const aiStatus = el("div", "ai-compact-status hidden");
  const aiEmpty = el("div", "ai-empty", "还没有 AI 结果。使用上方「AI 生成」创建结果卡片。");
  aiSection.append(aiCardToolbar, aiCardList, aiStatus, aiEmpty);

  const clearButton = el("button", "btn ghost editor-clear", "清空");
  clearButton.type = "button";
  clearButton.title = "清空当前草稿和待发送工具调用";
  clearButton.addEventListener("click", clearEditorContent);
  const composerHead = el("div", "composer-head");
  composerHead.append(label, draftStatus, draftCount, quickBar, clearButton);
  const composerMain = el("div", "composer-main");
  composerMain.append(composerHead, draft, note);
  composer.append(composerMain);
  const editorSplitter = el("div", "editor-height-splitter");
  editorSplitter.tabIndex = 0;
  editorSplitter.setAttribute("role", "separator");
  editorSplitter.setAttribute("aria-orientation", "horizontal");
  editorSplitter.title = "拖动调整回复编辑区高度，双击恢复默认";
  const editorHeight = Math.max(180, Math.min(520, Number(localStorage.getItem("ngzr.editorHeight")) || 220));
  wrap.style.setProperty("--editor-height", `${editorHeight}px`);
  setupEditorSplitter(editorSplitter, wrap, composer);

  const contextSplitter = el("div", "context-width-splitter");
  contextSplitter.tabIndex = 0;
  contextSplitter.setAttribute("role", "separator");
  contextSplitter.setAttribute("aria-orientation", "vertical");
  contextSplitter.title = "拖动调整会话与上下文宽度，双击恢复默认";
  const workspace = el("div", "workspace conversation-workspace");
  workspace.append(threadPane, contextSplitter, inspector);
  setupContextSplitter(contextSplitter, workspace, inspector);
  wrap.append(head, workspace, editorSplitter, composer);
  els.detail.append(wrap);

  const current = { id: ticket.id, els: {} };
  current.inspectorTab = loadInspectorTab();
  let savedCollapsed = null;
  try { savedCollapsed = localStorage.getItem(INSPECTOR_COLLAPSED_KEY); } catch { /* optional */ }
  current.inspectorCollapsed = savedCollapsed === null
    ? window.matchMedia("(max-width: 1080px)").matches
    : loadInspectorCollapsed();
  current.els = {
    model,
    id,
    badges,
    meta,
    purposeHint,
    sessionBar,
    messages,
    tools,
    msgCount,
    transcript,
    charCount,
    reasoningBox,
    reasoningCount,
    reasoningText,
    sentTools,
    draft,
    draftStatus,
    draftCount,
    composer,
    composerMain,
    aiTools,
    aiTrigger,
    quickBar,
    aiButtons,
    aiPromptTrigger,
    aiPromptPopover,
    aiPromptInput,
    aiPromptGenerate,
    aiPromptClear,
    aiPanel,
    aiEmpty,
    aiCardToolbar,
    aiCardSelection,
    aiReplace,
    aiAppend,
    aiCardList,
    aiStatus,
    aiPanelTitle,
    aiPanelHint,
    aiPanelBody,
    aiInsert,
    aiApply,
    aiExpand,
    aiCopy,
    aiClose,
    workspace,
    threadPane,
    threadBody,
    threadOutputHead,
    threadMinimap,
    minimapClip,
    minimapContent,
    minimapCanvas,
    minimapSlider,
    minimapViewport,
    minimapUnloaded,
    minimapLatest,
    contextSplitter,
    inspector,
    inspectorHead,
    inspectorTabs,
    inspectorBody,
    infoSection,
    infoExtra,
    infoSession: infoSession.section,
    sentSection,
    sentReasoning,
    sentReasoningCount,
    sentReasoningEmpty,
    sentReasoningCopy,
    sentText,
    sentTextCount,
    sentTextEmpty,
    sentTextCopy,
    toolsSection,
    aiSection,
    notesSection,
    moreActions,
    moreRefresh,
    moreCopyReply,
    clearButton,
    quickTakeover,
    tabButtons,
    aiTabDot,
    aiTabCount,
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
    toolCancelEdit,
    toolTemplate,
    toolFormat,
    toolSend,
    toolPending,
    routingPanel,
    notesPanel,
    note,
    inspectorToggle,
    claim: els.cmdClaim,
    push: els.cmdPush,
    finish: els.cmdFinish,
    release: els.cmdRelease,
    refuse: els.cmdRefuse,
    cancel: els.cmdCancel,
  };

  const restoredDraft = state.drafts.get(ticket.id) || "";
  draft.value = restoredDraft;
  if (restoredDraft) draftStatus.textContent = "已恢复未发送草稿";
  syncDraftMeta(current);
  draft.addEventListener("input", () => {
    if (!detail) return;
    setDraft(detail.id, draft.value);
    draftStatus.textContent = draft.value.trim() ? "草稿已自动保存" : "";
    syncDraftMeta(detail);
    syncClearButton(currentTicket(), detail);
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
  toolArgs.addEventListener("input", () => {
    detail.toolArgsDirty = true;
    setToolError(detail, "");
    syncClearButton(currentTicket(), detail);
  });
  toolArgs.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      addToolCallFromUI();
    }
  });
  toolAdd.addEventListener("click", addToolCallFromUI);
  toolCancelEdit.addEventListener("click", cancelToolEdit);
  toolTemplate.addEventListener("click", fillToolTemplate);
  toolFormat.addEventListener("click", formatToolArgs);
  toolArgs.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      addToolCallFromUI();
    }
  });
  toolSend.addEventListener("click", sendToolCalls);
  current.toolEditing = null;
  current.messagesLimit = 30;

  inspectorToggle.addEventListener("click", () => {
    current.inspectorCollapsed = !current.inspectorCollapsed;
    try { localStorage.setItem(INSPECTOR_COLLAPSED_KEY, current.inspectorCollapsed ? "1" : "0"); } catch { /* optional */ }
    applyInspectorState(current);
  });
  detail = current;
  threadBody.addEventListener("scroll", () => scheduleThreadMinimapUpdate(current), { passive: true });
  threadBody.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || current.minimapHoverReady) return;
    current.minimapHoverReady = true;
    threadMinimap.classList.add("hover-ready");
  }, { passive: true });
  threadBody.addEventListener("wheel", () => {
    if (!current.minimapHoverReady) {
      current.minimapHoverReady = true;
      threadMinimap.classList.add("hover-ready");
    }
    revealThreadMinimap(current);
  }, { passive: true });
  threadBody.addEventListener("touchstart", () => revealThreadMinimap(current), { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    current.minimapObserver = new ResizeObserver(() => scheduleThreadMinimapUpdate(current));
    current.minimapObserver.observe(threadBody);
  }
  requestAnimationFrame(() => updateThreadMinimap(current));
  applyInspectorState(current);
  activateInspectorTab(current, current.inspectorTab);
  return current;
}

function loadInspectorTab() {
  try {
    const value = localStorage.getItem(INSPECTOR_TAB_KEY);
    if (value === "tools") return "tools";
    if (value === "ai") return "ai";
    if (value === "sent") return "sent";
    if (value === "more" || ["notes", "routing", "other"].includes(value)) return "more";
  } catch { /* storage is optional */ }
  return "info";
}

function loadInspectorCollapsed() {
  try { return localStorage.getItem(INSPECTOR_COLLAPSED_KEY) === "1"; } catch { return false; }
}

function applyInspectorState(d) {
  if (!d?.els?.workspace) return;
  d.els.workspace.classList.toggle("inspector-collapsed", Boolean(d.inspectorCollapsed));
  if (d.els.inspectorToggle) {
    d.els.inspectorToggle.textContent = d.inspectorCollapsed ? "显示上下文" : "隐藏上下文";
    d.els.inspectorToggle.setAttribute("aria-expanded", d.inspectorCollapsed ? "false" : "true");
  }
  if (!d.inspectorCollapsed) requestAnimationFrame(reflowContextWidth);
}

function activateInspectorTab(d, tab) {
  if (!d?.els?.inspectorTabs) return;
  const next = ["info", "sent", "tools", "ai", "more"].includes(tab)
    ? tab
    : tab === "tools" ? "tools" : ["more", "notes", "routing", "other"].includes(tab) ? "more" : "info";
  d.inspectorTab = next;
  try { localStorage.setItem(INSPECTOR_TAB_KEY, next); } catch { /* storage is optional */ }
  for (const [key, button] of Object.entries(d.els.tabButtons)) {
    button.classList.toggle("active", key === next);
    button.setAttribute("aria-selected", key === next ? "true" : "false");
  }
  d.els.infoSection.classList.toggle("hidden", next !== "info");
  d.els.sentSection.classList.toggle("hidden", next !== "sent");
  d.els.toolsSection.classList.toggle("hidden", next !== "tools");
  d.els.aiSection.classList.toggle("hidden", next !== "ai");
  d.els.notesSection.classList.toggle("hidden", next !== "more");
  if (next === "tools") {
    const ticket = currentTicket();
    if (ticket) renderToolPanel(ticket, d);
  }
}

function renderInfoExtra(ticket, d) {
  if (!d?.els?.infoExtra) return;
  const date = (value) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
  const toolChoice = typeof ticket.toolChoice === "string"
    ? ticket.toolChoice
    : ticket.toolChoice?.name ? `指定 ${ticket.toolChoice.name}` : "auto";
  const rows = [
    ["票据 ID", ticket.id],
    ["协议", ticket.protocol === "anthropic-messages" ? "Anthropic Messages" : "OpenAI Chat"],
    ["模型", ticket.model || "—"],
    ["请求模式", ticket.stream ? "流式" : "非流式"],
    ["当前状态", STATE_LABELS[ticket.state] || ticket.state],
    ["会话", ticket.sessionId ? `${ticket.sessionId} · 第 ${ticket.sessionTurn || 1} 轮` : "独立请求"],
    ["首选回复员", ticket.preferredOperator ? `@${ticket.preferredOperator}` : "未指定"],
    ["创建时间", date(ticket.createdAt)],
    ["认领时间", date(ticket.claimedAt)],
    ["完成时间", date(ticket.finishedAt)],
    ["排队耗时", fmtMs(ticket.queueWaitMs)],
    ["处理耗时", fmtMs(ticket.handleMs)],
    ["总耗时", fmtMs(ticket.elapsedMs)],
    ["工具", `${(ticket.tools || []).length} 个 · ${toolChoice}${ticket.parallelToolCalls === false ? " · 禁止并行" : ""}`],
    ["输出格式", ticket.responseFormat?.type || "文本"],
    ["附件", `${(ticket.attachments || []).length} 个`],
    ["输出上限", ticket.maxTokens ? `${ticket.maxTokens} tokens` : "模型默认"],
    ["停止词", `${(ticket.stops || []).length} 个`],
    ["usage", ticket.includeUsage ? "返回给调用方" : "不返回"],
    ["客户端", ticket.clientGone ? "已断开" : "在线"],
  ];
  const fragment = document.createDocumentFragment();
  for (const [label, value] of rows) {
    const row = el("div", "info-extra-row");
    row.append(el("span", "info-extra-label", label));
    row.append(el("span", "info-extra-value", String(value ?? "—")));
    fragment.append(row);
  }
  d.els.infoExtra.replaceChildren(fragment);
}

function renderSentPanel(ticket, d) {
  if (!d?.els?.sentSection) return;
  const reasoning = typeof ticket.reasoning === "string" ? ticket.reasoning : "";
  const text = typeof ticket.text === "string" ? ticket.text : "";
  d.els.sentReasoning.textContent = reasoning;
  d.els.sentText.textContent = text;
  d.els.sentReasoning.classList.toggle("hidden", !reasoning);
  d.els.sentText.classList.toggle("hidden", !text);
  d.els.sentReasoningEmpty.classList.toggle("hidden", Boolean(reasoning));
  d.els.sentTextEmpty.classList.toggle("hidden", Boolean(text));
  d.els.sentReasoningCount.textContent = `${reasoning.length} 字`;
  d.els.sentTextCount.textContent = `${text.length} 字`;
  d.els.sentReasoningCopy.disabled = !reasoning;
  d.els.sentTextCopy.disabled = !text;
}

function updateDetail(ticket) {
  if (!detail || detail.id !== ticket.id) buildDetail(ticket);
  const d = detail;

  d.els.model.textContent = ticket.model;
  d.els.id.textContent = shortId(ticket.id);
  renderBadges(ticket, d.els.badges);
  renderMeta(ticket, d.els.meta);
  renderPurposeHint(ticket, d);
  renderSessionBar(ticket, d);
  renderInfoExtra(ticket, d);
  renderSentPanel(ticket, d);
  renderMessages(ticket, d);
  renderTranscript(ticket, d);
  renderSentToolCalls(ticket, d);
  renderThreadMinimap(ticket, d);
  renderToolPanel(ticket, d);
  renderTicketExtras(ticket, d);
  updateComposer(ticket, d);
  syncAiTools(ticket, d);
  restoreAiRun(ticket, d);

  const counts = messageBuckets(ticket);
  d.els.msgCount.textContent = `${counts.conversation.length} 条对话 · ${counts.context.length} 条上下文`;
  d.els.charCount.textContent = `${ticket.text.length} 字符`;
}

function renderTicketExtras(ticket, d) {
  const routing = d.els.routingPanel;
  if (!routing) return;
  const extrasSignature = JSON.stringify({
    tags: ticket.tags || [],
    priority: ticket.priority,
    notes: ticket.notes || [],
  });
  // Polling runs about once per second. Rebuilding these fields on every poll
  // destroyed focus/caret and wiped unsaved internal notes. Only rebuild when
  // the underlying routing/notes data changed; while the operator has a dirty
  // draft, leave the editor alone.
  if (d.extrasSignature === extrasSignature) return;
  if ((d.routingDirty || d.noteDirty) && d.extrasSignature !== undefined) return;
  d.extrasSignature = extrasSignature;
  routing.replaceChildren();
  const routeHead = el("div", "ticket-extra-head");
  routeHead.append(el("span", "", "路由"));
  routeHead.append(el("span", "ticket-extra-hint", "标签 / 优先级"));
  const routeBody = el("div", "ticket-extra-body");
  const tagLabel = el("label", "field compact-field");
  tagLabel.append(el("span", "field-label", "标签（逗号分隔）"));
  const tags = el("input");
  tags.type = "text";
  tags.maxLength = 200;
  tags.value = (ticket.tags || []).join(", ");
  tags.placeholder = "例如：退款, VIP, 中文";
  tags.addEventListener("input", () => { d.routingDirty = true; });
  tagLabel.append(tags);
  const priorityLabel = el("label", "field compact-field");
  priorityLabel.append(el("span", "field-label", "优先级"));
  const priority = el("select");
  for (const [value, label] of [["3", "紧急"], ["2", "高"], ["1", "普通"], ["0", "低"]]) {
    priority.append(new Option(label, value, false, String(ticket.priority ?? 1) === value));
  }
  priority.addEventListener("change", () => { d.routingDirty = true; });
  priorityLabel.append(priority);
  const routeSave = el("button", "btn", "保存路由");
  routeSave.type = "button";
  const routeError = el("div", "form-error");
  routeSave.addEventListener("click", async () => {
    routeError.textContent = "";
    routeSave.disabled = true;
    try {
      const data = await api(`/op/api/tickets/${encodeURIComponent(ticket.id)}/meta`, {
        method: "PATCH",
        body: {
          tags: tags.value.split(",").map((item) => item.trim()).filter(Boolean),
          priority: Number(priority.value),
        },
      });
      const index = state.tickets.findIndex((item) => item.id === ticket.id);
      if (index >= 0) state.tickets[index] = { ...state.tickets[index], ...data.ticket };
      d.routingDirty = false;
      d.extrasSignature = "";
      render();
    } catch (error) {
      routeError.textContent = error.message;
    } finally {
      routeSave.disabled = false;
    }
  });
  routeBody.append(tagLabel, priorityLabel, routeSave, routeError);
  routing.append(routeHead, routeBody);

  const notes = d.els.notesPanel;
  notes.replaceChildren();
  const noteHead = el("div", "ticket-extra-head");
  noteHead.append(el("span", "", "内部备注"));
  noteHead.append(el("span", "ticket-extra-hint", "不会发送给调用方"));
  const noteList = el("div", "internal-notes");
  const entries = Array.isArray(ticket.notes) ? ticket.notes : [];
  if (!entries.length) noteList.append(el("div", "inspector-empty", "还没有内部备注。"));
  for (const entry of entries.slice(-20)) {
    const item = el("div", "internal-note");
    const head = el("div", "internal-note-head");
    head.append(el("span", "", `${entry.kind === "handoff" ? "交接" : "备注"} · @${entry.author || "system"}`));
    head.append(el("time", "", new Date(entry.createdAt || Date.now()).toLocaleString("zh-CN", { hour12: false })));
    item.append(head, el("div", "internal-note-text", entry.text || ""));
    noteList.append(item);
  }
  const noteInput = el("textarea", "internal-note-input");
  noteInput.rows = 2;
  noteInput.maxLength = 2000;
  noteInput.placeholder = "记一条只给回复员看的备注…";
  noteInput.addEventListener("input", () => { d.noteDirty = true; });
  const noteSave = el("button", "btn", "添加备注");
  noteSave.type = "button";
  const noteError = el("div", "form-error");
  noteSave.addEventListener("click", async () => {
    const text = noteInput.value.trim();
    if (!text) return;
    noteError.textContent = "";
    noteSave.disabled = true;
    try {
      await api(`/op/api/tickets/${encodeURIComponent(ticket.id)}/notes`, {
        method: "POST",
        body: { text },
      });
      d.noteDirty = false;
      d.extrasSignature = "";
      await pollOnce();
    } catch (error) {
      noteError.textContent = error.message;
    } finally {
      noteSave.disabled = false;
    }
  });
  notes.append(noteHead, noteList, noteInput, noteSave, noteError);
}

function closeAiMenus() {
  for (const menu of document.querySelectorAll(".ai-menu")) menu.classList.add("hidden");
  for (const popover of document.querySelectorAll(".ai-prompt-popover")) popover.classList.add("hidden");
  for (const trigger of document.querySelectorAll(".ai-menu-trigger, .ai-prompt-trigger")) trigger.setAttribute("aria-expanded", "false");
}

function collapseAiPreview(d = detail) {
  if (!d?.els?.aiPanel) return;
  d.els.aiPanel.classList.remove("expanded");
  if (d.els.aiExpand) {
    d.els.aiExpand.textContent = "展开全文";
    d.els.aiExpand.setAttribute("aria-expanded", "false");
  }
}

const QUICK_BAR_ACTION_SPECS = {
  aiGenerate: { label: "AI 生成" },
  aiPrompt: { label: "AI 引导" },
  templates: { label: "快捷回复" },
  transfer: { label: "转交" },
  routing: { label: "打开路由" },
  tools: { label: "打开工具" },
  more: { label: "打开更多" },
  claim: { label: "认领票据" },
  next: { label: "下一张票据" },
  history: { label: "查看历史" },
  settings: { label: "打开设置" },
  status: { label: "打开状态页", adminOnly: true },
  users: { label: "打开用户管理", adminOnly: true },
  models: { label: "打开模型管理", adminOnly: true },
  keys: { label: "打开 API 密钥", adminOnly: true },
  usage: { label: "打开用量", adminOnly: true },
  audit: { label: "打开审计", adminOnly: true },
};
const QUICK_BAR_LINK_SPECS = {
  "/console/status": { label: "状态页", adminOnly: true },
  "/console/users": { label: "用户管理", adminOnly: true },
  "/console/models": { label: "模型管理", adminOnly: true },
  "/console/keys": { label: "API 密钥", adminOnly: true },
  "/console/usage": { label: "用量", adminOnly: true },
  "/console/audit": { label: "审计", adminOnly: true },
  "/console/history": { label: "历史" },
  "/console/settings": { label: "设置" },
};
const QUICK_BAR_INFO_SPECS = {
  memory: { label: "内存占用" },
  uptime: { label: "运行时长" },
  queue: { label: "队列数量" },
  aiCards: { label: "AI 结果数" },
};
const LEGACY_QUICK_BAR = {
  ai: { kind: "action", value: "aiGenerate", label: "AI 生成" },
  aiPrompt: { kind: "action", value: "aiPrompt", label: "AI 引导" },
  templates: { kind: "action", value: "templates", label: "快捷回复" },
  transfer: { kind: "action", value: "transfer", label: "转交" },
};
const DEFAULT_QUICK_BAR = [
  { id: "default-ai", kind: "action", value: "aiGenerate", label: "AI 生成", roles: ["admin", "operator"] },
  { id: "default-ai-prompt", kind: "action", value: "aiPrompt", label: "AI 引导", roles: ["admin", "operator"] },
];

function quickBarSpec(item) {
  if (item.kind === "action") return { ...(QUICK_BAR_ACTION_SPECS[item.value] || {}), kind: "action" };
  if (item.kind === "link") return { ...(QUICK_BAR_LINK_SPECS[item.value] || {}), kind: "link" };
  if (item.kind === "info") return { ...(QUICK_BAR_INFO_SPECS[item.value] || {}), kind: "info" };
  return null;
}

function normalizeQuickBarItem(raw, index) {
  const source = typeof raw === "string" ? LEGACY_QUICK_BAR[raw] : raw;
  if (!source || typeof source !== "object") return null;
  const kind = ["action", "link", "info"].includes(source.kind) ? source.kind : "action";
  const options = kind === "action" ? QUICK_BAR_ACTION_SPECS : kind === "link" ? QUICK_BAR_LINK_SPECS : QUICK_BAR_INFO_SPECS;
  const value = Object.prototype.hasOwnProperty.call(options, source.value) ? source.value : "";
  if (!value) return null;
  const spec = quickBarSpec({ kind, value });
  let roles = Array.isArray(source.roles) ? source.roles.filter((entry) => entry === "admin" || entry === "operator") : [];
  roles = [...new Set(roles)];
  if (!roles.length) roles = ["admin", "operator"];
  if (spec?.adminOnly) roles = ["admin"];
  return {
    id: String(source.id || `quick_${index}`),
    kind,
    value,
    label: String(source.label || "").trim().slice(0, 40) || spec?.label || value,
    roles,
  };
}

function quickBarItems() {
  const raw = state.preferences?.quickBar;
  if (!Array.isArray(raw)) return DEFAULT_QUICK_BAR.map((item) => ({ ...item, roles: [...item.roles] }));
  return raw.map((item, index) => normalizeQuickBarItem(item, index)).filter(Boolean);
}

function quickBarItemAllowed(item) {
  const spec = quickBarSpec(item);
  if (!spec) return false;
  if (spec.adminOnly && state.role !== "admin") return false;
  return item.roles.includes(state.role);
}

function quickBarAiAttempted(ticket) {
  const run = state.aiRuns.get(ticket.id);
  const pending = ticket.aiPending;
  return aiCardsFor(ticket.id).length > 0 || run?.status === "done" || run?.status === "error" ||
    (isAutoAiPending(ticket) && ["ready", "error"].includes(pending?.status));
}

function quickBarAiRunning(ticket) {
  const run = state.aiRuns.get(ticket.id);
  const pending = ticket.aiPending;
  return run?.status === "running" || (isAutoAiPending(ticket) && pending?.status === "running");
}

function quickBarDisplayLabel(item, ticket) {
  if (item.kind === "action" && item.value === "aiGenerate" && ["AI 生成", "再次生成"].includes(item.label)) {
    return quickBarAiAttempted(ticket) ? "再次生成" : "AI 生成";
  }
  return item.label;
}

function quickBarInfoValue(item, ticket) {
  const info = state.quickBarInfo;
  if (item.value === "memory") return info?.memoryMb !== undefined ? `${info.memoryMb} MB` : "—";
  if (item.value === "uptime") return info?.uptimeSec !== undefined ? formatDurationShort(info.uptimeSec) : "—";
  if (item.value === "queue") {
    const queued = state.tickets.filter((ticketItem) => ticketItem.state === "queued").length;
    const active = state.tickets.filter((ticketItem) => ["claimed", "streaming", "finishing"].includes(ticketItem.state)).length;
    return `${queued} 待 / ${active} 中`;
  }
  if (item.value === "aiCards") return String(aiCardsFor(ticket.id).length);
  return "—";
}

function formatDurationShort(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m`;
  if (total < 86_400) return `${Math.floor(total / 3600)}h`;
  return `${Math.floor(total / 86_400)}d`;
}

async function refreshQuickBarInfo(force = false) {
  const now = Date.now();
  if (!force && now - (state.quickBarInfoAt || 0) < 30_000) return;
  if (state.quickBarInfoLoading) return;
  state.quickBarInfoLoading = true;
  try {
    const data = await fetch("/op/api/quickbar/info", { headers: { Accept: "application/json" } }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    state.quickBarInfo = data;
    state.quickBarInfoAt = Date.now();
    if (detail) syncQuickBar(currentTicket(), detail);
  } catch {
    /* info is optional */
  } finally {
    state.quickBarInfoLoading = false;
  }
}

function quickBarDisabled(item, ticket) {
  if (!ticket || state.busy) return true;
  const editable = isTicketEditable(ticket);
  if (item.kind === "info") return false;
  if (item.kind === "link") return false;
  if (["routing", "tools", "more", "history", "settings", "status", "users", "models", "keys", "usage", "audit"].includes(item.value)) return false;
  if (item.value === "aiGenerate" || item.value === "aiPrompt") {
    return !editable || quickBarAiRunning(ticket) ||
      !(state.aiAssist?.enabled && state.aiAssist?.configured && state.aiAssist?.allowed);
  }
  if (item.value === "templates") return !editable;
  if (item.value === "transfer") return ticket.state !== "claimed" || !(ticket.claimedBy === state.operator || state.role === "admin");
  if (item.value === "claim") return ticket.state !== "queued";
  if (item.value === "next") return state.tickets.length === 0;
  return false;
}

function runQuickBarItem(item) {
  const ticket = currentTicket();
  if (!ticket || !detail) return;
  if (item.kind === "info") return;
  if (item.kind === "link") {
    openSubpage(item.value, item.label);
    return;
  }
  switch (item.value) {
    case "aiGenerate":
      runAiTask("reply", detail, state.aiPrompts.get(ticket.id) || "");
      break;
    case "aiPrompt":
      detail.inspectorCollapsed = false;
      applyInspectorState(detail);
      activateInspectorTab(detail, "ai");
      detail.els.aiPromptTrigger.click();
      break;
    case "templates":
      openTemplateModal();
      break;
    case "transfer":
      openTransfer();
      break;
    case "routing":
      detail.inspectorCollapsed = false;
      applyInspectorState(detail);
      activateInspectorTab(detail, "more");
      requestAnimationFrame(() => detail.els.routingPanel?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
      break;
    case "tools":
      detail.inspectorCollapsed = false;
      applyInspectorState(detail);
      activateInspectorTab(detail, "tools");
      break;
    case "more":
      detail.inspectorCollapsed = false;
      applyInspectorState(detail);
      activateInspectorTab(detail, "more");
      break;
    case "claim":
      doAction("claim");
      break;
    case "next":
      nextTicket();
      break;
    case "history":
      openSubpage(`/console/history?ticket=${encodeURIComponent(ticket.id)}`, "历史");
      break;
    case "settings":
      openSubpage("/console/settings", "设置");
      break;
    case "status":
    case "users":
    case "models":
    case "keys":
    case "usage":
    case "audit":
      openSubpage(`/console/${item.value}`, quickBarSpec(item)?.label || item.label);
      break;
  }
}

function syncQuickBar(ticket, d) {
  if (!d?.els?.quickBar || !ticket) return;
  const items = quickBarItems().filter(quickBarItemAllowed);
  d.els.quickBar.replaceChildren();
  d.els.quickBar.classList.toggle("hidden", items.length === 0);
  if (!items.length) return;
  for (const item of items) {
    const spec = quickBarSpec(item);
    if (!spec) continue;
    if (item.kind === "info") {
      const chip = el("span", "quickbar-info");
      chip.append(el("span", "quickbar-info-label", item.label));
      chip.append(el("strong", "quickbar-info-value", quickBarInfoValue(item, ticket)));
      chip.title = item.value === "memory" && state.quickBarInfo
        ? `RSS ${state.quickBarInfo.memoryMb} MB · heap ${state.quickBarInfo.heapUsedMb || 0} MB`
        : item.label;
      d.els.quickBar.append(chip);
      continue;
    }
    const button = el("button", "btn ghost quickbar-action", quickBarDisplayLabel(item, ticket));
    button.type = "button";
    button.title = item.kind === "link" ? item.label : (spec.label || item.label);
    button.disabled = quickBarDisabled(item, ticket);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      runQuickBarItem(item);
    });
    d.els.quickBar.append(button);
  }
}

function syncAiTabIndicator(ticket) {
  const dot = detail?.els?.aiTabDot;
  const countEl = detail?.els?.aiTabCount;
  const button = detail?.els?.tabButtons?.ai;
  if (!dot || !countEl || !button || !ticket) return;
  const count = aiCardsFor(ticket.id).length;
  const run = state.aiRuns.get(ticket.id);
  const pending = ticket.aiPending;
  const auto = isAutoAiPending(ticket);
  const running = run?.status === "running" || (auto && pending?.status === "running");
  const failed = !running && (run?.status === "error" || (auto && pending?.status === "error"));
  const done = !running && !failed && (count > 0 || run?.status === "done" || (auto && pending?.status === "ready"));
  dot.classList.toggle("hidden", !running && !failed && !done);
  dot.classList.toggle("running", Boolean(running));
  dot.classList.toggle("error", Boolean(failed));
  dot.classList.toggle("done", Boolean(done));
  countEl.textContent = count ? String(count) : "";
  countEl.classList.toggle("hidden", count === 0);
  button.title = running
    ? `AI 生成中 · 已有 ${count} 个结果`
    : failed
      ? `AI 生成失败 · 已有 ${count} 个结果`
      : done
        ? `AI 已完成 · ${count} 个结果`
        : "AI 辅助";
}

function syncAiTools(ticket, d) {
  syncAiTabIndicator(ticket);
  const available = Boolean(state.aiAssist?.enabled && state.aiAssist?.configured && state.aiAssist?.allowed);
  d.els.aiTools.classList.toggle("hidden", !available);
  d.els.aiCardToolbar.classList.toggle("hidden", !available);
  if (!available) {
    d.els.aiEmpty.classList.add("hidden");
    d.els.aiStatus.classList.add("hidden");
    return;
  }
  d.els.aiTrigger.classList.remove("hidden");
  d.els.aiPromptTrigger.classList.remove("hidden");
  const editable = isTicketEditable(ticket) && !d.els.draft.disabled;
  const run = state.aiRuns.get(ticket.id);
  const pending = ticket.aiPending;
  const auto = isAutoAiPending(ticket);
  const aiRunning = run?.status === "running" || (auto && pending?.status === "running");
  const aiAttempted = aiCardsFor(ticket.id).length > 0 || run?.status === "done" || run?.status === "error" ||
    (auto && ["ready", "error"].includes(pending?.status));
  for (const button of Object.values(d.els.aiButtons)) {
    button.disabled = Boolean(aiRunning) || !editable;
    button.textContent = aiRunning ? "AI 生成中…" : aiAttempted ? "再次生成" : "AI 生成";
  }
  if (d.els.aiPromptTrigger) {
    d.els.aiPromptTrigger.disabled = Boolean(aiRunning) || !editable;
    updateAiPromptTrigger(d);
  }
  syncAiCardActions(ticket, d);
}

function updateAiPromptTrigger(d = detail) {
  if (!d?.els?.aiPromptTrigger) return;
  const hasPrompt = Boolean(state.aiPrompts.get(d.id));
  d.els.aiPromptTrigger.classList.toggle("has-prompt", hasPrompt);
  d.els.aiPromptTrigger.textContent = hasPrompt ? "AI 引导 ·" : "AI 引导";
  d.els.aiPromptTrigger.title = hasPrompt
    ? `本次生成会附加引导：${state.aiPrompts.get(d.id).slice(0, 120)}`
    : "给本次/再次生成附加一段方向提示";
}

function aiShowPanel(ticket, d, title, text, { insertable = true, selection = null, applyLabel = "", onApply = null } = {}) {
  d.inspectorCollapsed = false;
  applyInspectorState(d);
  activateInspectorTab(d, "ai");
  d.els.aiPanel.classList.remove("hidden", "expanded");
  d.els.aiPanelTitle.textContent = title;
  d.els.aiPanelBody.textContent = text;
  d.els.aiPanelHint.textContent = `${String(text || "").length} 字 · 不会自动发送`;
  const expandable = String(text || "").length > 160;
  d.els.aiExpand.classList.toggle("hidden", !expandable);
  d.els.aiExpand.textContent = "展开全文";
  d.els.aiExpand.setAttribute("aria-expanded", "false");
  d.els.aiExpand.onclick = expandable ? () => {
    const expanded = d.els.aiPanel.classList.toggle("expanded");
    d.els.aiExpand.textContent = expanded ? "收起全文" : "展开全文";
    d.els.aiExpand.setAttribute("aria-expanded", expanded ? "true" : "false");
  } : null;
  d.els.aiInsert.classList.toggle("hidden", !insertable);
  d.els.aiApply.classList.toggle("hidden", !onApply);
  d.els.aiApply.textContent = applyLabel || "应用建议";
  d.els.aiApply.onclick = onApply ? async () => {
    d.els.aiApply.disabled = true;
    try { await onApply(); } finally { d.els.aiApply.disabled = false; }
  } : null;
  const draft = d.els.draft;
  const start = selection?.start ?? draft.selectionStart ?? draft.value.length;
  const end = selection?.end ?? draft.selectionEnd ?? start;
  d.els.aiInsert.onclick = () => {
    if (!insertable || draft.disabled) return;
    draft.setRangeText(text, start, end, "end");
    draft.dispatchEvent(new Event("input", { bubbles: true }));
    draft.focus();
    d.els.aiPanel.classList.add("hidden");
  };
  d.els.aiCopy.onclick = () => copyMessageText(text).catch(() => toast("复制失败"));
  d.els.aiClose.onclick = () => {
    d.els.aiPanel.classList.add("hidden");
    d.aiRunDismissed = true;
  };
  d.els.aiPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function elapsedText(startedAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(startedAt || Date.now())) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}

function clearAiLoadingTimer(d = detail) {
  if (d?.aiLoadingTimer) clearInterval(d.aiLoadingTimer);
  if (d) d.aiLoadingTimer = null;
}

function clearAutoAiTimer(d = detail) {
  if (d?.autoAiTimer) clearInterval(d.autoAiTimer);
  if (d) d.autoAiTimer = null;
}

function clearDetailTimers(d = detail) {
  if (!d) return;
  clearAiLoadingTimer(d);
  clearAutoAiTimer(d);
}

function updateAiLoadingHint(d = detail) {
  if (!d?.els?.aiPanelHint) return;
  d.els.aiPanelHint.textContent = `已用时 ${elapsedText(d.aiLoadingStartedAt)} · 不会自动发送`;
}

function showAiLoading(d, startedAt = Date.now()) {
  d.aiLoadingStartedAt = Number(startedAt) || Date.now();
  clearAiLoadingTimer(d);
  updateAiLoadingHint(d);
  d.aiLoadingTimer = setInterval(() => updateAiLoadingHint(d), 1000);
  d.els.aiCardToolbar.classList.remove("hidden");
  d.els.aiEmpty.classList.add("hidden");
  d.els.aiStatus.classList.add("hidden");
  d.els.aiPanel.classList.remove("hidden");
  d.els.aiPanelTitle.textContent = "AI 生成中…";
  d.els.aiPanelBody.textContent = "正在请求 AI 辅助，请稍候…";
  d.els.aiPanel.classList.remove("expanded");
  d.els.aiInsert.classList.add("hidden");
  d.els.aiApply.classList.add("hidden");
  d.els.aiExpand.classList.add("hidden");
}

function fillReplyAndTools(ticket, d, reply) {
  const current = currentTicket();
  if (!current || current.id !== ticket.id || !isTicketEditable(current)) {
    throw new Error("票据状态已变化，无法填入；请再次生成。");
  }
  setDraft(ticket.id, reply.text || "");
  d.els.draft.value = reply.text || "";
  d.els.draft.dispatchEvent(new Event("input", { bubbles: true }));
  d.els.draftStatus.textContent = reply.text ? "已填入 AI 回复" : "";
  syncDraftMeta(d);
  if (reply.toolCalls?.length) {
    if (current.toolChoice && typeof current.toolChoice === "object" &&
        reply.toolCalls.some((call) => call.name !== current.toolChoice.name)) {
      throw new Error(`此请求指定使用工具 ${current.toolChoice.name}`);
    }
    if (current.parallelToolCalls === false && reply.toolCalls.length > 1) {
      throw new Error("此请求只允许一个工具调用。");
    }
    state.toolDrafts.set(current.id, reply.toolCalls.map((call) => ({
      name: call.name,
      arguments: JSON.stringify(call.arguments || {}),
    })));
    setToolEditMode(d, null);
    d.inspectorCollapsed = false;
    applyInspectorState(d);
    activateInspectorTab(d, "tools");
    renderToolPanel(current, d);
  }
  updateComposer(current, d);
  return true;
}

function renderAiRun(ticket, d, run) {
  if (run.status === "running") {
    showAiLoading(d, run.startedAt);
    d.aiRunLoadingShown = run;
    return;
  }
  if (run.status === "error") {
    clearAiLoadingTimer(d);
    d.els.aiPanel.classList.add("hidden");
    d.els.aiStatus.textContent = run.error || "AI 生成失败。";
    d.els.aiStatus.classList.remove("hidden");
    d.els.aiEmpty.classList.add("hidden");
    d.aiRenderedRun = run;
    return;
  }
  clearAiLoadingTimer(d);
  d.els.aiPanel.classList.add("hidden");
  d.els.aiPanel.classList.remove("expanded");
  d.els.aiPanelBody.textContent = "";
  d.els.aiStatus.classList.add("hidden");
  d.aiRenderedRun = run;
  renderAiCards(ticket, d, true);
}

function restoreAiRun(ticket, d) {
  const run = state.aiRuns.get(ticket.id);
  if (!run) {
    renderAiCards(ticket, d);
    return;
  }
  if (run.status === "running") {
    if (d.aiRunLoadingShown !== run) renderAiRun(ticket, d, run);
    return;
  }
  if (run.status === "error") {
    if (d.aiRunDismissed) { renderAiCards(ticket, d); return; }
    if (d.aiRenderedRun !== run) renderAiRun(ticket, d, run);
    else renderAiCards(ticket, d);
    return;
  }
  d.els.aiPanel.classList.add("hidden");
  renderAiCards(ticket, d);
}

function normalizeAiToolCalls(calls) {
  return (Array.isArray(calls) ? calls : [])
    .map((call) => {
      let args = call?.arguments ?? call?.parsedArguments ?? {};
      if (typeof args === "string") {
        try { args = JSON.parse(args || "{}"); } catch { args = args; }
      }
      const name = String(call?.name || call?.function?.name || "").trim();
      if (!name) return null;
      return {
        id: String(call?.id || ""),
        name,
        arguments: args,
      };
    })
    .filter(Boolean);
}

let aiCardSequence = 0;

function aiCardsFor(ticketId) {
  if (!state.aiCards) state.aiCards = new Map();
  let cards = state.aiCards.get(ticketId);
  if (!cards) {
    cards = [];
    state.aiCards.set(ticketId, cards);
  }
  return cards;
}

function selectedAiCard(ticketId) {
  const cards = aiCardsFor(ticketId);
  const id = state.aiSelectedCards?.get(ticketId);
  return cards.find((card) => card.id === id) || null;
}

function cardSourceLabel(source) {
  if (source === "auto_receive") return "自动生成";
  if (source === "auto_claim") return "认领生成";
  if (source === "manual") return "手动生成";
  return source ? String(source) : "AI 结果";
}

function addAiCard(ticket, d, { reasoning = "", content = "", toolCalls = [], source = "manual", finishReason = "", usage = null, createdAt = Date.now() } = {}) {
  const cards = aiCardsFor(ticket.id);
  const card = {
    id: `ai_${Date.now()}_${++aiCardSequence}`,
    reasoning: typeof reasoning === "string" ? reasoning : "",
    content: typeof content === "string" ? content : "",
    toolCalls: normalizeAiToolCalls(toolCalls),
    source,
    finishReason,
    usage,
    createdAt,
  };
  cards.push(card);
  state.aiSelectedCards.set(ticket.id, card.id);
  if (d) d.aiCardsSignature = "";
  renderAiCards(ticket, d, true);
  return card;
}

function cardToolDraftCalls(calls) {
  return normalizeAiToolCalls(calls).map((call) => ({
    name: call.name,
    arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {}),
  }));
}

function validateCardToolDrafts(ticket, calls) {
  if (calls.length > 16) throw new Error("最多 16 个工具调用。");
  if (ticket.toolChoice && typeof ticket.toolChoice === "object") {
    const invalid = calls.find((call) => call.name !== ticket.toolChoice.name);
    if (invalid) throw new Error(`此请求指定使用工具 ${ticket.toolChoice.name}。`);
  }
  if (ticket.parallelToolCalls === false && calls.length > 1) {
    throw new Error("此请求只允许一个工具调用。");
  }
  return calls;
}

function syncAiCardActions(ticket, d) {
  if (!d?.els?.aiReplace) return;
  const cards = aiCardsFor(ticket.id);
  const selected = selectedAiCard(ticket.id);
  const editable = isTicketEditable(ticket);
  d.els.aiCardSelection.textContent = selected
    ? `已选 ${cards.findIndex((card) => card.id === selected.id) + 1} / ${cards.length}`
    : cards.length ? "未选择结果" : "暂无结果";
  const disabled = state.busy || !selected || !editable;
  d.els.aiReplace.disabled = disabled;
  d.els.aiAppend.disabled = disabled;
}

function selectAiCard(ticket, d, cardId) {
  const cards = aiCardsFor(ticket.id);
  if (!cards.some((card) => card.id === cardId)) return;
  state.aiSelectedCards.set(ticket.id, cardId);
  d.aiCardsSignature = "";
  renderAiCards(ticket, d, true);
}

function toolCallArgsText(call) {
  try {
    return JSON.stringify(call.arguments ?? {}, null, 2);
  } catch {
    return String(call.arguments ?? "");
  }
}

function renderAiCards(ticket, d, force = false) {
  if (!d?.els?.aiCardList) return;
  const cards = aiCardsFor(ticket.id);
  let selected = selectedAiCard(ticket.id);
  if (!selected && cards.length) {
    selected = cards[cards.length - 1];
    state.aiSelectedCards.set(ticket.id, selected.id);
  }
  if (!selected && !cards.length) state.aiSelectedCards.delete(ticket.id);
  const panelVisible = !d.els.aiPanel.classList.contains("hidden");
  const signature = JSON.stringify({
    cards: cards.map((card) => [card.id, card.reasoning, card.content, card.toolCalls, card.source, card.createdAt]),
    selected: selected?.id || "",
    editable: isTicketEditable(ticket),
    panelVisible,
  });
  if (!force && d.aiCardsSignature === signature) {
    syncAiCardActions(ticket, d);
    return;
  }
  d.aiCardsSignature = signature;
  const list = d.els.aiCardList;
  list.replaceChildren();
  cards.forEach((card, index) => {
    const node = el("article", `ai-card${selected?.id === card.id ? " selected" : ""}`);
    node.dataset.cardId = card.id;
    node.tabIndex = 0;
    node.setAttribute("role", "radio");
    node.setAttribute("aria-checked", selected?.id === card.id ? "true" : "false");
    node.addEventListener("click", () => selectAiCard(ticket, d, card.id));
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectAiCard(ticket, d, card.id);
    });

    const head = el("div", "ai-card-head");
    const radio = el("span", "ai-card-radio");
    radio.setAttribute("aria-hidden", "true");
    const title = el("span", "ai-card-title", `AI 结果 ${index + 1}`);
    head.append(radio, title);
    const meta = el("span", "ai-card-meta");
    meta.textContent = `${cardSourceLabel(card.source)} · ${fmtTime(card.createdAt)}`;
    head.append(meta);
    node.append(head);

    const reasoningBlock = el("section", "ai-card-section");
    const reasoningHead = el("div", "ai-card-section-title", "思考");
    const reasoningBody = el("pre", "ai-card-text ai-card-reasoning", card.reasoning || "（无思考文本）");
    reasoningBody.classList.toggle("is-empty", !card.reasoning);
    reasoningBlock.append(reasoningHead, reasoningBody);
    node.append(reasoningBlock);

    const textBlock = el("section", "ai-card-section");
    const textHead = el("div", "ai-card-section-title", "正文");
    const textBody = el("pre", "ai-card-text ai-card-content", card.content || "（无正文）");
    textBody.classList.toggle("is-empty", !card.content);
    textBlock.append(textHead, textBody);
    node.append(textBlock);

    const toolsBlock = el("section", "ai-card-section");
    const toolsHead = el("div", "ai-card-section-title", `工具调用 · ${card.toolCalls.length}`);
    toolsBlock.append(toolsHead);
    if (card.toolCalls.length) {
      const tools = el("div", "ai-card-tools");
      for (const call of card.toolCalls) {
        const tool = el("div", "ai-card-tool");
        tool.append(el("div", "ai-card-tool-name", call.name));
        tool.append(el("pre", "ai-card-tool-args", toolCallArgsText(call)));
        tools.append(tool);
      }
      toolsBlock.append(tools);
    } else {
      toolsBlock.append(el("div", "ai-card-empty-line", "（无工具调用）"));
    }
    node.append(toolsBlock);
    list.append(node);
  });

  const hasCards = cards.length > 0;
  list.classList.toggle("hidden", !hasCards);
  d.els.aiEmpty.classList.toggle("hidden", hasCards || panelVisible);
  syncAiCardActions(ticket, d);
}

function applySelectedAiCard(mode) {
  const ticket = currentTicket();
  const d = detail;
  if (!ticket || !d || d.id !== ticket.id) return;
  if (!isTicketEditable(ticket)) {
    toast("票据当前不可编辑。");
    return;
  }
  const card = selectedAiCard(ticket.id);
  if (!card) {
    toast("先选择一条 AI 结果。");
    return;
  }
  try {
    const cardTools = cardToolDraftCalls(card.toolCalls);
    const existingTools = state.toolDrafts.get(ticket.id) || [];
    const tools = mode === "append" ? validateCardToolDrafts(ticket, [...existingTools, ...cardTools]) : validateCardToolDrafts(ticket, cardTools);
    const current = d.els.draft.value;
    const nextText = mode === "append"
      ? `${current}${current && card.content ? "\n\n" : ""}${card.content}`
      : card.content;
    setDraft(ticket.id, nextText);
    d.els.draft.value = nextText;
    d.els.draft.dispatchEvent(new Event("input", { bubbles: true }));
    if (tools.length) state.toolDrafts.set(ticket.id, tools);
    else state.toolDrafts.delete(ticket.id);
    if (mode === "replace") {
      setToolEditMode(d, null);
      d.els.toolArgs.value = "";
      d.toolArgsDirty = false;
      d.els.draftStatus.textContent = "已填入 AI 结果";
    }
    syncDraftMeta(d);
    renderToolPanel(ticket, d);
    updateComposer(ticket, d);
    toast(mode === "replace" ? "已用 AI 结果替换草稿和工具调用" : "已追加 AI 结果到草稿和工具调用");
  } catch (error) {
    toast(error.message);
  }
}

function stripAiToolAnnotations(value) {
  return String(value || "")
    .replace(/\[tool use:\s*[^\]]+\]/giu, "")
    .replace(/^\s*已调用工具\s*$/gimu, "")
    .replace(/^\s*工具调用\s*$/gimu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function runAiTask(task, d, instruction = "") {
  const ticket = currentTicket();
  if (!ticket || !d || d.id !== ticket.id || task !== "reply") return;
  if (state.aiRuns.get(ticket.id)?.status === "running") return;
  if (!isTicketEditable(ticket)) {
    toast("先认领票据，再请求 AI 回复。");
    return;
  }
  d.inspectorCollapsed = false;
  applyInspectorState(d);
  activateInspectorTab(d, "ai");
  const run = { status: "running", task: "reply", relay: true, startedAt: Date.now() };
  state.aiRuns.set(ticket.id, run);
  d.aiRunDismissed = false;
  syncAiTools(ticket, d);
  showAiLoading(d, run.startedAt);
  try {
    const result = await api(`/op/api/tickets/${encodeURIComponent(ticket.id)}/ai/relay`, {
      method: "POST",
      body: instruction ? { instruction } : {},
    });
    run.status = "done";
    state.aiRuns.set(ticket.id, run);
    d.aiRunDismissed = false;
    clearAiLoadingTimer(d);
    d.els.aiPanel.classList.add("hidden");
    addAiCard(ticket, d, {
      reasoning: result.reasoning || "",
      content: stripAiToolAnnotations(result.content || ""),
      toolCalls: result.toolCalls,
      source: "manual",
      finishReason: result.finishReason || "",
      usage: result.usage || null,
    });
    updateComposer(ticket, d);
    toast("AI 结果已加入 AI 子页，请选择后填入或追加");
  } catch (error) {
    run.status = "error";
    run.error = error.message;
    clearAiLoadingTimer(d);
    renderAiRun(ticket, d, run);
  } finally {
    syncAiTools(ticket, d);
  }
}

function renderBadges(ticket, container) {
  const items = [];
  const purpose = purposeOf(ticket);
  items.push(badge(STATE_LABELS[ticket.state] || ticket.state, stateTone(ticket.state)));
  items.push(badge(ticket.stream ? "stream" : "non-stream", ""));
  if (ticket.effort) items.push(badge(`effort:${ticket.effort}`, "warn"));
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
  }
  d.els.purposeHint.classList.toggle("hidden", !text);
  d.els.purposeHint.textContent = text;
}

function renderSessionBar(ticket, d) {
  const bar = d.els.sessionBar;
  if (!bar) return;
  const related = ticket.sessionId
    ? state.tickets.filter((item) => item.sessionId === ticket.sessionId).sort((a, b) => a.createdAt - b.createdAt)
    : [ticket];
  bar.classList.toggle("hidden", !ticket.sessionId);
  d.els.infoSession?.classList.toggle("hidden", !ticket.sessionId);
  if (!ticket.sessionId) return;
  bar.replaceChildren();

  const label = el("div", "session-label");
  const title = el("span", "session-title", `会话 ${shortId(ticket.sessionId)} · 第 ${ticket.sessionTurn || 1} 轮${related.length > 1 ? ` · 共 ${related.length} 轮` : ""}`);
  title.title = ticket.sessionId;
  label.append(title);
  const preferred = ticket.preferredOperator || related.find((item) => item.claimedBy)?.claimedBy;
  if (preferred) label.append(el("span", "session-owner", `首选 @${preferred}`));
  bar.append(label);

  const list = el("div", "session-tickets");
  for (const item of related.slice(-8)) {
    const chip = el("button", `session-ticket${item.id === ticket.id ? " active" : ""}`);
    chip.type = "button";
    chip.textContent = `#${item.sessionTurn || 1} ${STATE_LABELS[item.state] || item.state}`;
    chip.title = `${item.model} · ${item.caller || "caller"} · ${shortId(item.id)}`;
    chip.addEventListener("click", () => {
      if (state.selectedId === item.id) return;
      state.selectedId = item.id;
      render();
    });
    list.append(chip);
  }
  bar.append(list);

  const hasActiveTurn = related.some((item) => isActive(item) && item.state !== "queued");
  const next = hasActiveTurn ? null : related.find((item) => item.state === "queued");
  if (next) {
    const continueButton = el("button", "btn ghost session-continue", "继续接待");
    continueButton.type = "button";
    continueButton.title = `认领同会话的下一张票据 #${next.sessionTurn || 1}`;
    continueButton.addEventListener("click", async () => {
      state.selectedId = next.id;
      render();
      await doAction("claim");
    });
    bar.append(continueButton);
  }
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
  row.dataset.messageIndex = String(index);
  row.dataset.messageRole = message.role || "unknown";
  row.dataset.context = isContext ? "1" : "0";
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
  const messageActions = el("div", "msg-actions");
  const copyButton = el("button", "msg-action", "复制");
  copyButton.type = "button";
  copyButton.title = "复制这条消息";
  copyButton.addEventListener("click", () => copyMessageText(content).catch(() => toast("复制失败")));
  messageActions.append(copyButton);
  if (!isContext && message.role !== "tool") {
    const quoteButton = el("button", "msg-action", "引用");
    quoteButton.type = "button";
    quoteButton.title = "把摘要插入回复草稿";
    quoteButton.addEventListener("click", () => quoteMessage(ticket, content));
    messageActions.append(quoteButton);
  }
  head.append(messageActions);
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

  const images = (ticket.attachments || []).filter((attachment) => attachment.messageIndex === index && attachment.type !== "file" && attachment.url);
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

  const files = (ticket.attachments || []).filter((attachment) => attachment.messageIndex === index && attachment.type === "file" && attachment.fileId);
  if (files.length) {
    const strip = el("div", "file-attachments");
    for (const attachment of files) {
      const card = el("button", "file-attachment");
      card.type = "button";
      const glyph = el("span", `file-glyph ${attachment.kind || "file"}`, attachment.kind === "image" ? "▧" : attachment.kind === "pdf" ? "PDF" : "TXT");
      const text = el("span", "file-text");
      text.append(el("span", "file-name", attachment.name || "attachment"));
      text.append(el("span", "file-meta", `${attachment.kind || "file"} · ${fmtBytes(attachment.bytes)}${attachment.pages ? ` · ${attachment.pages} 页` : ""}`));
      card.append(glyph, text);
      card.title = "打开安全预览";
      card.addEventListener("click", () => openAttachmentPreview(ticket, attachment).catch((error) => toast(error.message, 5000)));
      strip.append(card);
    }
    row.append(strip);
  }
  return row;
}

function fmtBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function openAttachmentPreview(ticket, attachment) {
  els.attachmentTitle.textContent = attachment.name || "附件预览";
  els.attachmentMeta.textContent = `${attachment.mime || "file"} · ${fmtBytes(attachment.bytes)}${attachment.pages ? ` · ${attachment.pages} 页` : ""}`;
  els.attachmentWarning.textContent = "";
  els.attachmentBody.replaceChildren(el("div", "attachment-loading", "正在读取安全预览…"));
  const base = `/op/api/tickets/${encodeURIComponent(ticket.id)}/attachments/${encodeURIComponent(attachment.fileId)}`;
  els.attachmentDownload.href = `${base}/raw`;
  els.attachmentDownload.setAttribute("download", attachment.name || "attachment");
  els.attachmentModal.classList.remove("hidden");
  els.attachmentClose.focus?.();
  if (attachment.kind === "image") {
    const image = el("img", "attachment-preview-image");
    image.src = `${base}/image`;
    image.alt = attachment.name || "附件图片";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    els.attachmentBody.replaceChildren(image);
    return;
  }
  const response = await fetch(`${base}/meta`, { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "附件预览加载失败");
  const preview = data.preview || {};
  els.attachmentBody.replaceChildren();
  const pdfPages = Math.min(200, Number(attachment.pages || preview.pages || 0));
  if (attachment.kind === "pdf" && pdfPages > 0) {
    const viewer = el("div", "attachment-pdf-viewer");
    const image = el("img", "attachment-preview-image");
    image.alt = `${attachment.name || "PDF"} 第 1 页`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    const controls = el("div", "attachment-pdf-controls");
    const previous = el("button", "btn ghost", "上一页");
    previous.type = "button";
    const next = el("button", "btn ghost", "下一页");
    next.type = "button";
    const pageLabel = el("span", "admin-hint", "");
    let page = 1;
    const showPage = (number) => {
      page = Math.max(1, Math.min(pdfPages, number));
      image.src = `${base}/pdf-page?page=${page}`;
      image.alt = `${attachment.name || "PDF"} 第 ${page} 页`;
      pageLabel.textContent = `第 ${page} / ${pdfPages} 页`;
      previous.disabled = page <= 1;
      next.disabled = page >= pdfPages;
    };
    previous.addEventListener("click", () => showPage(page - 1));
    next.addEventListener("click", () => showPage(page + 1));
    image.addEventListener("error", () => {
      viewer.remove();
      els.attachmentWarning.textContent = "PDF 页图不可用，可查看下方文字预览或下载原文件。";
    }, { once: true });
    controls.append(previous, pageLabel, next);
    viewer.append(image, controls);
    els.attachmentBody.append(viewer);
    showPage(1);
  }
  if (preview.table && preview.table.columns?.length) {
    const wrap = el("div", "attachment-table-wrap");
    const table = el("table", "attachment-table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const column of preview.table.columns) {
      const th = document.createElement("th");
      th.textContent = column;
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);
    const tbody = document.createElement("tbody");
    for (const cells of preview.table.rows || []) {
      const tr = document.createElement("tr");
      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    els.attachmentBody.append(wrap);
    if (preview.truncated) els.attachmentWarning.textContent = "预览已截断，完整内容请下载原文件。";
    return;
  }
  const pre = el("pre", "attachment-pre", preview.text || "");
  els.attachmentBody.append(pre);
  if (!preview.text) els.attachmentWarning.textContent = (data.warnings || []).join(" ") || "没有可显示的文本预览，请下载原文件。";
  else if (preview.truncated) els.attachmentWarning.textContent = "预览已截断，完整内容请下载原文件。";
}

function setupThreadMinimap(body, minimap, clip, content, viewport, unloaded, latest) {
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const scrollToPointer = (event) => {
    const rect = minimap.getBoundingClientRect();
    if (!rect.height) return;
    const thumbHeight = viewport.getBoundingClientRect().height || 24;
    const usable = Math.max(1, rect.height - thumbHeight);
    const y = Math.max(0, Math.min(usable, event.clientY - rect.top - thumbHeight / 2));
    const max = Math.max(0, body.scrollHeight - body.clientHeight);
    body.scrollTop = (y / usable) * max;
    revealThreadMinimap(detail);
    scheduleThreadMinimapUpdate(detail);
  };
  minimap.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".minimap-unloaded, .minimap-latest")) return;
    event.preventDefault();
    minimap.setPointerCapture?.(event.pointerId);
    minimap.classList.add("dragging");
    revealThreadMinimap(detail);
    const rect = minimap.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const thumbHeight = viewportRect.height || 24;
    const usable = Math.max(1, rect.height - thumbHeight);
    const max = Math.max(0, body.scrollHeight - body.clientHeight);
    const onThumb = event.clientY >= viewportRect.top && event.clientY <= viewportRect.bottom;
    const startY = event.clientY;
    const startScroll = body.scrollTop;
    if (!onThumb) scrollToPointer(event);
    const move = (moveEvent) => {
      revealThreadMinimap(detail);
      if (onThumb) {
        const delta = moveEvent.clientY - startY;
        body.scrollTop = startScroll + (delta / usable) * max;
        scheduleThreadMinimapUpdate(detail);
      } else {
        scrollToPointer(moveEvent);
      }
    };
    const end = () => {
      minimap.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      revealThreadMinimap(detail);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
  minimap.addEventListener("focus", () => revealThreadMinimap(detail));
  minimap.addEventListener("blur", () => {
    if (!minimap.matches(":hover")) minimap.classList.remove("visible");
  });
  minimap.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const behavior = reducedMotion() ? "auto" : "smooth";
    if (event.key === "Home" || event.key === "End") {
      body.scrollTo({ top: event.key === "Home" ? 0 : body.scrollHeight, behavior });
    } else {
      const page = event.key === "PageDown" || event.key === "PageUp";
      body.scrollBy({
        top: (event.key === "ArrowDown" || event.key === "PageDown" ? 1 : -1) * (page ? body.clientHeight * 0.8 : 80),
        behavior,
      });
    }
    revealThreadMinimap(detail);
    scheduleThreadMinimapUpdate(detail);
  });
  latest.addEventListener("pointerdown", (event) => event.stopPropagation());
  latest.addEventListener("click", (event) => {
    event.stopPropagation();
    body.scrollTo({ top: body.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    revealThreadMinimap(detail);
    scheduleThreadMinimapUpdate(detail);
  });
}

function scheduleThreadMinimapUpdate(d = detail) {
  if (!d) return;
  if (d.minimapRaf) return;
  d.minimapRaf = requestAnimationFrame(() => {
    d.minimapRaf = 0;
    updateThreadMinimap(d);
  });
}

function revealThreadMinimap(d = detail) {
  const minimap = d?.els?.threadMinimap;
  if (!minimap) return;
  minimap.classList.add("visible");
  clearTimeout(d.minimapHideTimer);
  d.minimapHideTimer = setTimeout(() => {
    if (!minimap.classList.contains("dragging")) minimap.classList.remove("visible");
  }, 1100);
}

function drawMinimapCanvas(d, { contentTop = 0, offset = 0, fits = false, scale = 1 } = {}) {
  const canvas = d?.els?.minimapCanvas;
  const clip = d?.els?.minimapClip;
  if (!canvas || !clip) return;
  const width = Math.max(1, clip.clientWidth);
  const height = Math.max(1, clip.clientHeight);
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const backingWidth = Math.max(1, Math.round(width * dpr));
  const backingHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const colors = {
    user: "rgba(138, 164, 248, 0.72)",
    assistant: "rgba(196, 207, 223, 0.62)",
    tool: "rgba(216, 178, 106, 0.72)",
    output: "rgba(131, 199, 164, 0.82)",
    reasoning: "rgba(160, 143, 204, 0.72)",
    system: "rgba(135, 149, 163, 0.45)",
  };
  const lines = d.minimapLines || [];
  const step = Math.max(0.5, 4 * scale);
  const startIndex = fits ? 0 : Math.max(0, Math.floor(contentTop / step) - 1);
  const endIndex = fits ? lines.length : Math.min(lines.length, Math.ceil((contentTop + height) / step) + 1);
  for (let index = startIndex; index < endIndex; index += 1) {
    const line = lines[index];
    const y = (fits ? offset : 0) + index * step - contentTop;
    const lineHeight = Math.max(1, (line.tall ? 3 : 2) * scale);
    if (y + lineHeight < 0 || y > height) continue;
    context.fillStyle = colors[line.role] || colors.system;
    context.fillRect(0, y, Math.max(2, width * (line.width / 100)), lineHeight);
  }
}

function updateThreadMinimap(d = detail) {
  if (!d?.els?.threadBody || !d.els.threadMinimap) return;
  const body = d.els.threadBody;
  const minimap = d.els.threadMinimap;
  const clip = d.els.minimapClip;
  const content = d.els.minimapContent;
  const slider = d.els.minimapSlider;
  const viewport = d.els.minimapViewport;
  const latest = d.els.minimapLatest;
  const max = Math.max(0, body.scrollHeight - body.clientHeight);
  const shouldHide = max < 8;
  minimap.classList.toggle("hidden", shouldHide);
  if (shouldHide) {
    latest?.classList.add("hidden");
    return;
  }
  if (latest) latest.classList.toggle("hidden", max - body.scrollTop <= 20);
  const railHeight = slider?.clientHeight || minimap.clientHeight;
  if (railHeight < 16) {
    minimap.classList.add("hidden");
    return;
  }
  const visibleRatio = Math.max(0.015, Math.min(1, body.clientHeight / Math.max(1, body.scrollHeight)));
  const maxThumb = Math.max(12, railHeight - 2);
  const thumbHeight = Math.max(Math.min(24, maxThumb), Math.min(maxThumb, Math.round(railHeight * visibleRatio)));
  const maxTop = Math.max(0, railHeight - thumbHeight);
  const top = max > 0 ? Math.round((body.scrollTop / max) * maxTop) : 0;
  viewport.style.height = `${thumbHeight}px`;
  viewport.style.top = `${top}px`;
  const positionPercent = max > 0 ? Math.round((body.scrollTop / max) * 100) : 0;
  minimap.setAttribute("aria-valuenow", String(positionPercent));
  minimap.setAttribute("aria-valuetext", `会话位置 ${positionPercent}%`);
  const lines = d.minimapLines || [];
  const useCanvas = d.minimapRenderMode === "canvas" && lines.length > 0;
  const contentHeight = useCanvas ? Math.max(2, lines.length * 4 - 2) : content.scrollHeight;
  const clipHeight = clip.clientHeight;
  if (contentHeight < 2) {
    minimap.classList.add("hidden");
    latest?.classList.add("hidden");
    return;
  }
  const layoutPreference = state.minimapLayout || "auto";
  const forcedFit = layoutPreference === "fit";
  const fits = forcedFit || (layoutPreference === "auto" && contentHeight <= clipHeight);
  const scale = forcedFit && contentHeight > clipHeight ? clipHeight / contentHeight : 1;
  const visualHeight = contentHeight * scale;
  minimap.dataset.minimapLayout = fits ? "fit" : "scroll";
  const fitOffset = fits ? Math.max(0, Math.floor((clipHeight - visualHeight) / 2)) : 0;
  const contentOverflow = Math.max(0, visualHeight - clipHeight);
  const contentTop = !fits && max > 0 ? Math.round((body.scrollTop / max) * contentOverflow) : 0;
  if (useCanvas) {
    drawMinimapCanvas(d, { contentTop, offset: fitOffset, fits, scale });
  } else {
    content.style.transform = `translateY(${fits ? fitOffset : -contentTop}px) scaleY(${scale})`;
  }
}

function loadMoreThreadHistory(d = detail) {
  const ticket = currentTicket();
  if (!ticket || !d) return;
  const { conversation } = messageBuckets(ticket);
  const visible = d.els.messages.querySelectorAll('.msg[data-context="0"]').length;
  if (visible >= conversation.length) return;
  d.messagesLimit = Math.min(conversation.length, (Number(d.messagesLimit) || 30) + 60);
  d.msgSignature = "";
  renderMessages(ticket, d);
  renderThreadMinimap(ticket, d);
  requestAnimationFrame(() => {
    d.els.threadBody.scrollTop = 0;
    scheduleThreadMinimapUpdate(d);
  });
}

function minimapMessageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

/**
 * Conversation-aware minimap model. Consecutive tool messages (and
 * tool-only assistant messages) collapse into one tool group, while user and
 * assistant turns remain separate. This keeps tool-heavy runs from drowning
 * out the actual conversation.
 */
function buildMinimapTurns(ticket) {
  const { conversation } = messageBuckets(ticket);
  const turns = [];
  let toolGroup = null;
  for (const entry of conversation) {
    const message = entry.message || {};
    const role = message.role || "unknown";
    const text = minimapMessageText(message);
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.length : 0;
    const toolOnlyAssistant = role === "assistant" && !text.trim() && toolCalls > 0;
    if (role === "tool" || toolOnlyAssistant) {
      if (!toolGroup) {
        toolGroup = {
          kind: "tool",
          role: "tool",
          count: 0,
          chars: 0,
          messageCount: 0,
          firstIndex: entry.index,
        };
        turns.push(toolGroup);
      }
      toolGroup.messageCount += 1;
      toolGroup.count += role === "tool" ? 1 : Math.max(1, toolCalls);
      toolGroup.chars += text.length + toolCalls * 180;
      continue;
    }
    toolGroup = null;
    turns.push({
      kind: role === "user" ? "user" : role === "assistant" ? "assistant" : "system",
      role,
      count: 1,
      chars: text.length,
      messageCount: 1,
      firstIndex: entry.index,
    });
  }
  return turns;
}

function renderThreadMinimap(ticket, d) {
  if (!d?.els?.minimapContent || !d.els.threadMinimap) return;
  const rows = [...d.els.messages.querySelectorAll('.msg[data-context="0"]')];
  const { conversation } = messageBuckets(ticket);
  const hidden = Math.max(0, conversation.length - rows.length);
  const minimap = d.els.threadMinimap;
  const unloaded = d.els.minimapUnloaded;
  const semantic = state.minimapMode === "semantic";
  const source = semantic ? buildMinimapTurns(ticket) : conversation;
  const signature = [
    state.minimapMode,
    conversation.length,
    source.length,
    ticket.text?.length || 0,
    ticket.reasoning?.length || 0,
    ticket.toolCalls?.length || 0,
    minimap.clientHeight,
  ].join(":");
  if (unloaded) {
    unloaded.classList.toggle("hidden", hidden === 0);
    unloaded.textContent = hidden ? `更早 ${hidden} 条` : "";
    unloaded.onpointerdown = (event) => event.stopPropagation();
    unloaded.onclick = (event) => {
      event.stopPropagation();
      loadMoreThreadHistory(d);
    };
    minimap.classList.toggle("has-unloaded", hidden > 0);
  }
  if (d.minimapSignature === signature) {
    scheduleThreadMinimapUpdate(d);
    return;
  }
  d.minimapSignature = signature;
  const maxLines = 360;
  const stride = Math.max(1, Math.ceil(source.length / maxLines));
  const sampled = source.filter((entry, index) => index % stride === 0 || index === source.length - 1);
  const lines = [];
  const pushLine = (role, width, tall = false, title = "") => {
    lines.push({ role, width: Math.max(14, Math.min(96, width)), tall, title });
  };
  for (const item of sampled) {
    if (semantic) {
      const chars = Number(item.chars) || 0;
      const width = item.kind === "tool"
        ? 26 + Math.min(62, Math.round(Math.log2((item.count || 1) + 1) * 14))
        : 18 + Math.min(76, Math.round(chars / 4));
      const tall = item.kind === "tool" && (item.count || 0) >= 3;
      const title = item.kind === "tool"
        ? `工具组 · ${item.count} 项`
        : item.kind === "user" ? "用户消息" : item.kind === "assistant" ? "助手消息" : "系统消息";
      pushLine(item.kind, width, tall, title);
    } else {
      const role = item.message.role === "user" ? "user"
        : item.message.role === "tool" ? "tool"
          : item.message.role === "assistant" ? "assistant" : "system";
      const text = typeof item.message.content === "string" ? item.message.content : "";
      const width = 18 + Math.min(76, Math.round(text.length / 4));
      pushLine(role, width, false);
      if (text.length > 360 && sampled.length < 240) pushLine(role, Math.min(88, width + 8));
    }
  }
  const output = ticket.text || "";
  if (output) {
    pushLine("output", 46 + Math.min(42, Math.round(output.length / 10)));
    if (output.length > 180) pushLine("output", 38 + Math.min(48, Math.round(output.length / 18)));
  }
  (ticket.toolCalls || []).slice(0, 8).forEach(() => pushLine("tool", 34));
  if ((ticket.reasoning || "").length) pushLine("reasoning", 54);
  d.minimapLines = lines;
  const canvas = d.els.minimapCanvas;
  let useCanvas = lines.length >= 300 && Boolean(canvas);
  if (useCanvas) {
    try { useCanvas = Boolean(canvas.getContext("2d")); } catch { useCanvas = false; }
  }
  d.minimapRenderMode = useCanvas ? "canvas" : "dom";
  d.els.minimapContent.classList.toggle("hidden", useCanvas);
  canvas?.classList.toggle("hidden", !useCanvas);
  if (useCanvas) {
    d.els.minimapContent.replaceChildren();
  } else {
    const fragment = document.createDocumentFragment();
    for (const item of lines) {
      const line = document.createElement("span");
      line.className = `minimap-line ${item.role}${item.tall ? " tall" : ""}`;
      line.style.width = `${item.width}%`;
      if (item.title) line.title = item.title;
      fragment.append(line);
    }
    d.els.minimapContent.replaceChildren(fragment);
  }
  scheduleThreadMinimapUpdate(d);
}

function renderMessages(ticket, d) {
  const limit = Number(d.messagesLimit) || 30;
  const signature = [
    (ticket.messages || []).length,
    ticket.attachments?.length || 0,
    ticket.tools?.length || 0,
    Boolean(ticket.responseFormat),
    limit,
  ].join(":");
  if (d.msgSignature === signature) return;
  d.msgSignature = signature;

  const { conversation, context } = messageBuckets(ticket);
  const box = d.els.messages;
  const scrollHost = box.closest(".thread-body") || box;
  const previousTop = scrollHost.scrollTop;
  const previousHeight = scrollHost.scrollHeight;
  const previousClient = scrollHost.clientHeight;
  const sameTicket = box.dataset.ticketId === ticket.id;
  const wasNearBottom = !sameTicket || previousTop + previousClient >= previousHeight - 24;
  box.replaceChildren();

  const hidden = Math.max(0, conversation.length - limit);
  const visible = hidden ? conversation.slice(-limit) : conversation;
  const summary = el("div", "messages-summary");
  summary.append(el("span", "messages-summary-main", hidden
    ? `对话历史 · 共 ${conversation.length} 条，显示最近 ${limit} 条`
    : `对话历史 · ${conversation.length} 条`));
  if (context.length) {
    summary.append(el("span", "", `系统/上下文 ${context.length} 条已折叠`));
  }
  d.els.messages.append(summary);

  if (hidden) {
    const more = el("button", "messages-load-earlier", `加载更早 ${Math.min(30, hidden)} 条（剩余 ${hidden} 条）`);
    more.type = "button";
    more.addEventListener("click", () => {
      d.messagesLimit = limit + 30;
      d.msgSignature = "";
      renderMessages(ticket, d);
    });
    d.els.messages.append(more);
  }

  if (conversation.length === 0) {
    d.els.messages.append(el("div", "messages-empty", "本次请求没有用户/助手对话消息。"));
  } else {
    for (const entry of visible) {
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

  box.dataset.ticketId = ticket.id;
  if (wasNearBottom) {
    requestAnimationFrame(() => {
      if (scrollHost.isConnected) scrollHost.scrollTop = scrollHost.scrollHeight;
    });
  } else {
    scrollHost.scrollTop = previousTop;
  }
}

async function copyMessageText(text) {
  const value = String(text || "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast("已复制");
    return;
  } catch {
    /* clipboard API can be unavailable on plain HTTP or denied */
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  toast(copied ? "已复制" : "复制失败");
  if (!copied) throw new Error("copy failed");
}

function quoteMessage(ticket, text) {
  if (!detail || detail.id !== ticket.id || detail.els.draft.disabled) {
    toast("认领票据后才能引用到回复框。");
    return;
  }
  const excerpt = String(text || "")
    .split("\n")
    .slice(0, 8)
    .map((line) => `> ${line}`)
    .join("\n");
  if (!excerpt.trim() || excerpt === "> ") return;
  const current = detail.els.draft.value.trimEnd();
  detail.els.draft.value = `${current ? `${current}\n\n` : ""}${excerpt}\n\n`;
  setDraft(ticket.id, detail.els.draft.value);
  detail.els.draftStatus.textContent = "草稿已自动保存";
  detail.els.draft.focus();
  detail.els.draft.setSelectionRange(detail.els.draft.value.length, detail.els.draft.value.length);
}

function renderTranscript(ticket, d) {
  const text = ticket.text || "";
  const shown = ticket.refusal ? `拒答：${ticket.refusal}` : text;
  const signature = `${shown.length}:${ticket.state}:${ticket.claimedBy}:${shown.slice(-12)}`;
  if (d.transcriptSignature === signature) return;

  const box = d.els.transcript;
  const scrollHost = box.closest(".thread-body") || box;
  const nearBottom = scrollHost.scrollHeight - scrollHost.scrollTop - scrollHost.clientHeight < 48;

  box.classList.toggle("placeholder", !shown);
  box.textContent = shown || "还没有发送任何内容。";
  if (ticket.refusal) box.classList.add("refusal-text");
  else box.classList.remove("refusal-text");
  const editable =
    isActive(ticket) && ticket.state !== "finishing" && ticket.claimedBy === state.operator;
  if (editable && !ticket.refusal) box.append(el("span", "caret"));

  if (shown && nearBottom) scrollHost.scrollTop = scrollHost.scrollHeight;
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

function isAutoAiPending(ticket) {
  return Boolean(ticket?.aiPending && ["auto_receive", "auto_claim"].includes(ticket.aiPending.source));
}

function isAutoAiRunning(ticket) {
  return isAutoAiPending(ticket) && ticket.aiPending.status === "running";
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
  d.els.toolSend.textContent = d.els.draft.value.trim()
    ? "发送回复与工具并完成"
    : "发送工具调用并完成";

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
    d.els.toolSend.disabled = true;
    d.els.toolPending.append(el("div", "tool-pending-empty", "尚未添加工具调用"));
    return;
  }

  const editable = isTicketEditable(ticket);
  d.els.toolSend.disabled = !editable || !calls.length;
  d.els.toolPending.append(el("div", "tool-pending-head", `待发送 ${calls.length} 个工具调用`));
  calls.forEach((call, index) => {
    const row = el("div", "toolcall-item");
    const info = el("div", "toolcall-info");
    info.append(el("div", "toolcall-name", call.name));
    const args = el("pre", "toolcall-args", prettyArgs(call.arguments));
    info.append(args);
    row.append(info);

    if (editable) {
      const edit = el("button", "toolcall-edit", "编辑");
      edit.type = "button";
      edit.addEventListener("click", () => beginToolEdit(ticket, d, index));
      const remove = el("button", "toolcall-remove", "移除");
      remove.type = "button";
      remove.addEventListener("click", () => {
        const next = [...(state.toolDrafts.get(ticket.id) || [])];
        next.splice(index, 1);
        state.toolDrafts.set(ticket.id, next);
        if (d.toolEditing === index) setToolEditMode(d, null);
        else if (Number.isInteger(d.toolEditing) && d.toolEditing > index) setToolEditMode(d, d.toolEditing - 1);
        renderPendingToolCalls(ticket, d);
        updateComposer(ticket, d);
      });
      row.append(edit, remove);
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
  head.append(el("span", "sent-tools-title", "已返回工具调用 · 工具未在本机执行"));
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

function formatToolArgs() {
  const ticket = currentTicket();
  if (!ticket || !detail) return;
  const raw = detail.els.toolArgs.value.trim();
  if (!raw) return;
  try {
    detail.els.toolArgs.value = JSON.stringify(JSON.parse(raw), null, 2);
    setToolError(detail, "");
  } catch {
    setToolError(detail, "参数不是合法 JSON，无法格式化。");
  }
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

function setToolEditMode(d, index) {
  d.toolEditing = Number.isInteger(index) ? index : null;
  d.els.toolAdd.textContent = d.toolEditing === null ? "添加工具调用" : "保存工具修改";
  d.els.toolCancelEdit.classList.toggle("hidden", d.toolEditing === null);
}

function beginToolEdit(ticket, d, index) {
  const calls = state.toolDrafts.get(ticket.id) || [];
  const call = calls[index];
  if (!call) return;
  d.inspectorCollapsed = false;
  applyInspectorState(d);
  activateInspectorTab(d, "tools");
  d.toolEditing = index;
  d.els.toolSelect.value = call.name;
  let args = call.arguments;
  try { args = JSON.stringify(JSON.parse(call.arguments || "{}"), null, 2); } catch { /* keep raw */ }
  d.els.toolArgs.value = args;
  setToolEditMode(d, index);
  d.els.toolArgs.focus();
  d.els.toolArgs.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function cancelToolEdit() {
  const ticket = currentTicket();
  if (!ticket || !detail) return;
  setToolEditMode(detail, null);
  const selected = (ticket.tools || []).find((item) => item.function.name === detail.els.toolSelect.value);
  detail.els.toolArgs.value = selected ? templateFromSchema(selected.function.parameters) : "";
  renderToolPanel(ticket, detail);
}

function toolArgIssues(value, schema, path = "参数") {
  if (!schema || typeof schema !== "object") return [];
  const issues = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const matches = (type) => {
    if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
    if (type === "array") return Array.isArray(value);
    if (type === "integer") return Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    if (type === "string") return typeof value === "string";
    if (type === "boolean") return typeof value === "boolean";
    if (type === "null") return value === null;
    return true;
  };
  if (types.length && !types.some(matches)) {
    issues.push(`${path} 类型应为 ${types.join(" / ")}`);
    return issues;
  }
  if (value === null || value === undefined) return issues;
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    issues.push(`${path} 必须是 ${schema.enum.map((item) => JSON.stringify(item)).join(" / ")}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push(`${path} 至少 ${schema.minLength} 个字符`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(`${path} 最多 ${schema.maxLength} 个字符`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${path} 不能小于 ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(`${path} 不能大于 ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => issues.push(...toolArgIssues(item, schema.items, `${path}[${index}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        issues.push(`${path}.${key} 必填`);
      } else if (value[key] === "" || value[key] === null || value[key] === undefined) {
        issues.push(`${path}.${key} 不能为空`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (childSchema) issues.push(...toolArgIssues(child, childSchema, `${path}.${key}`));
      else if (schema.additionalProperties === false) issues.push(`${path}.${key} 不是允许的参数`);
    }
  }
  return issues;
}

function selectedToolFor(ticket, name) {
  return (ticket.tools || []).find((item) => item.function.name === name) || null;
}

function validateDraftToolCall(ticket, call) {
  const tool = selectedToolFor(ticket, call.name);
  if (!tool) return `未找到工具 ${call.name}`;
  let args;
  try { args = JSON.parse(call.arguments || "{}"); } catch { return `${call.name} 的参数不是 JSON`; }
  const issues = toolArgIssues(args, tool.function.parameters || {});
  return issues.length ? `${call.name}: ${issues.slice(0, 4).join("；")}` : "";
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
  const selected = selectedToolFor(ticket, name);
  const issues = selected ? toolArgIssues(args, selected.function.parameters || {}) : [];
  if (issues.length) {
    setToolError(detail, issues.slice(0, 4).join("；"));
    detail.els.toolArgs.focus();
    return;
  }
  setToolError(detail, "");

  const calls = [...(state.toolDrafts.get(ticket.id) || [])];
  const editing = Number.isInteger(detail.toolEditing) ? detail.toolEditing : null;
  if (editing !== null && !calls[editing]) {
    setToolEditMode(detail, null);
    toast("待修改的工具调用已不存在。");
    return;
  }
  if (editing === null && calls.length >= 16) {
    toast("最多 16 个工具调用");
    return;
  }
  if (editing === null && ticket.parallelToolCalls === false && calls.length >= 1) {
    toast("此请求只允许一个工具调用");
    return;
  }

  if (editing !== null) {
    calls[editing] = { name, arguments: JSON.stringify(args) };
    state.toolDrafts.set(ticket.id, calls);
    setToolEditMode(detail, null);
    toast(`工具修改已保存：${name}`);
  } else {
    calls.push({ name, arguments: JSON.stringify(args) });
    state.toolDrafts.set(ticket.id, calls);
    toast(`已添加工具调用：${name}`);
  }
  detail.els.toolArgs.value = "";
  const selectedTool = (ticket.tools || []).find((item) => item.function.name === name);
  if (selectedTool) detail.els.toolArgs.value = templateFromSchema(selectedTool.function.parameters);
  renderPendingToolCalls(ticket, detail);
  updateComposer(ticket, detail);
}

function syncAutoAiTimer(ticket, d, running) {
  if (!running) {
    clearAutoAiTimer(d);
    d.autoAiStartedAt = null;
    return;
  }
  const startedAt = Number(ticket.aiPending?.createdAt) || Date.now();
  if (d.autoAiStartedAt !== startedAt) {
    clearAutoAiTimer(d);
    d.autoAiStartedAt = startedAt;
  }
  if (!d.autoAiTimer) {
    d.autoAiTimer = setInterval(() => {
      const current = currentTicket();
      if (!current || current.id !== d.id || !isAutoAiRunning(current)) {
        clearAutoAiTimer(d);
        return;
      }
      if (d.els?.note) {
        d.els.note.classList.remove("hidden");
        d.els.note.textContent = `AI 辅助正在自动生成，已用时 ${elapsedText(d.autoAiStartedAt)}；结果会显示在 AI 子页，输入框可继续编辑。`;
      }
    }, 1000);
  }
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

  const autoAiRunning = isAutoAiRunning(ticket);
  const autoAiError = isAutoAiPending(ticket) && ticket.aiPending?.status === "error";
  const reasoning = ticket.reasoning || "";
  d.els.reasoningBox.classList.toggle("hidden", !reasoning);
  d.els.reasoningText.textContent = reasoning;
  d.els.reasoningCount.textContent = reasoning ? `${reasoning.length} 字` : "";
  d.els.draft.disabled = !editable;
  note.classList.add("hidden");
  if (autoAiRunning) {
    note.classList.remove("hidden");
    note.textContent = `AI 辅助正在自动生成，已用时 ${elapsedText(ticket.aiPending?.createdAt)}；结果会显示在 AI 子页，输入框可继续编辑。`;
  } else if (autoAiError) {
    note.classList.remove("hidden");
    note.textContent = ticket.aiPending?.error || "自动 AI 辅助失败，可稍后手动生成。";
  } else if (!isActive(ticket)) {
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
          : state.role === "admin"
            ? `由 ${ticket.claimedBy || "其他回复员"} 接待中。可点击下方「接管」继续处理。`
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
  else d.els.draft.placeholder = "在这里写回复…";
  syncDraftMeta(d);
  syncAutoAiTimer(ticket, d, autoAiRunning);
  if (d.els.moreRefresh) d.els.moreRefresh.disabled = state.busy;
  if (d.els.moreCopyReply) d.els.moreCopyReply.disabled = !(ticket.text || ticket.refusal);
  syncClearButton(ticket, d);
  syncQuickBar(ticket, d);
  syncCommandbar();
}

/* ------------------------------ actions ------------------------------ */

function syncClearButton(ticket, d) {
  if (!ticket || !d?.els?.clearButton) return;
  const editable = isTicketEditable(ticket);
  const hasDraft = Boolean(String(d.els.draft?.value || "").trim());
  const hasTools = Boolean((state.toolDrafts.get(ticket.id) || []).length);
  const hasArgs = Boolean(d.toolArgsDirty && String(d.els.toolArgs?.value || "").trim());
  const hasAiPanel = !d.els.aiPanel?.classList.contains("hidden");
  d.els.clearButton.disabled = !editable || !(hasDraft || hasTools || hasArgs || hasAiPanel);
}

async function clearEditorContent() {
  const ticket = currentTicket();
  if (!ticket || !detail || detail.id !== ticket.id) return;
  const hasDraft = Boolean(detail.els.draft.value.trim());
  const hasTools = Boolean((state.toolDrafts.get(ticket.id) || []).length);
  const hasArgs = Boolean(detail.els.toolArgs.value.trim());
  const hasAi = !detail.els.aiPanel.classList.contains("hidden");
  if (!hasDraft && !hasTools && !hasArgs && !hasAi) {
    toast("当前没有可清空的内容。");
    return;
  }
  if (!window.confirm("清空当前草稿、AI 建议和待发送工具调用？")) return;

  detail.els.draft.value = "";
  setDraft(ticket.id, "");
  detail.els.draft.dispatchEvent(new Event("input", { bubbles: true }));
  detail.els.draftStatus.textContent = "";
  syncDraftMeta(detail);

  state.toolDrafts.delete(ticket.id);
  detail.toolEditing = null;
  setToolEditMode(detail, null);
  detail.els.toolArgs.value = "";
  detail.toolArgsDirty = false;
  setToolError(detail, "");
  renderPendingToolCalls(ticket, detail);
  renderToolPanel(ticket, detail);

  detail.els.aiPanel.classList.add("hidden");
  detail.els.aiPanelBody.textContent = "";
  detail.els.aiPanel.classList.remove("expanded");
  state.aiPrompts.delete(ticket.id);
  detail.els.aiPromptInput.value = "";
  updateAiPromptTrigger(detail);

  updateComposer(ticket, detail);
  toast("已清空草稿、AI 建议和待发送工具。");
}

async function doAction(name) {
  closeCommandMenu();
  const ticket = state.tickets.find((item) => item.id === state.selectedId);
  if (!ticket || state.busy) return;
  if (name === "think" && ticket.protocol === "anthropic-messages") {
    toast("Anthropic 路径暂不支持流式 thinking。");
    return;
  }

  const draft = detail && detail.id === ticket.id ? detail.els.draft.value : "";
  if ((name === "push" || name === "think") && !draft.trim()) {
    toast(name === "think" ? "先输入内容，再作为思考发送。" : "先输入正文，再推送片段。");
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
    if (name === "push" || name === "think" || name === "finish") body.text = draft;
    if (name === "finish") {
      body.finishReason = "stop";
      if (ticket.responseFormat) body.replaceText = true;
      const toolCalls = state.toolDrafts.get(ticket.id) || [];
      if (toolCalls.length) body.toolCalls = toolCalls;
    }
    if (name === "refuse") {
      body.refusal = draft.trim() || "无法协助这个请求。";
    }

    const endpoint =
      name === "think" ? "reasoning" : name === "push" ? "chunk" : name === "refuse" ? "finish" : name;
    await api(`/op/api/tickets/${encodeURIComponent(ticket.id)}/${endpoint}`, { method: "POST", body });

    if (name === "think" || name === "push" || name === "finish" || name === "refuse") {
      setDraft(ticket.id, "");
      if (detail && detail.id === ticket.id) {
        detail.els.draft.value = "";
        detail.els.draftStatus.textContent = "";
      }
    }
    if (name === "finish" || name === "refuse") {
      state.toolDrafts.delete(ticket.id);
      if (detail && detail.id === ticket.id) {
        detail.els.toolArgs.value = "";
        renderPendingToolCalls(ticket, detail);
      }
    }
    if (name === "claim") {
      state.selectedId = ticket.id;
      rememberSelectedTicket(ticket.id);
    }
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
  const canTakeover = Boolean(
    state.role === "admin" &&
    ticket &&
    isActive(ticket) &&
    ticket.state === "claimed" &&
    ticket.claimedBy &&
    ticket.claimedBy !== state.operator,
  );
  if (els.cmdTakeover) {
    els.cmdTakeover.classList.toggle("hidden", !canTakeover);
    els.cmdTakeover.disabled = state.busy || !canTakeover;
  }
  if (detail?.els?.quickTakeover) {
    detail.els.quickTakeover.classList.toggle("hidden", !canTakeover);
    detail.els.quickTakeover.disabled = state.busy || !canTakeover;
  }
  els.commandState.textContent = ticket
    ? STATE_LABELS[ticket.state] || ticket.state
    : state.connected
      ? "等待队列"
      : "连接中";
  els.cmdClaim.disabled = state.busy || !ticket || ticket.state !== "queued";
  els.cmdNext.disabled = state.busy || state.tickets.length === 0;
  els.cmdTemplates.disabled = state.busy || !ticket || !detail || detail.els.draft.disabled;
  els.cmdTransfer.disabled =
    state.busy || !ticket || ticket.state !== "claimed" || !(mine || state.role === "admin");
  els.cmdThink.disabled = state.busy || !editable || !ticket || ticket.protocol === "anthropic-messages";
  els.cmdThink.title =
    ticket?.protocol === "anthropic-messages" ? "Anthropic 路径暂不支持流式 thinking" : "";
  els.cmdPush.disabled = state.busy || !editable;
  els.cmdFinish.disabled = state.busy || !editable || (toolRequired && pending.length === 0);
  els.cmdFinish.title =
    toolRequired && pending.length === 0 ? "此请求要求先添加工具调用" : "";
  els.cmdRelease.disabled =
    state.busy || !(editable && ticket.state === "claimed" && !ticket.stream && !ticket.text);
  els.cmdRefuse.disabled = state.busy || !editable;
  els.cmdCancel.disabled =
    state.busy ||
    !active ||
    !(mine || ticket.state === "queued" || (state.role === "admin"));
  els.cmdMore.disabled = state.busy;
  if (els.cmdMore.disabled) closeCommandMenu();
  updateShortcutLabels();
}

function setButtonsDisabled(flag) {
  for (const button of [els.cmdClaim, els.cmdNext, els.cmdTemplates, els.cmdTransfer, els.cmdTakeover, els.cmdThink, els.cmdPush, els.cmdFinish, els.cmdRelease, els.cmdRefuse, els.cmdCancel, els.cmdMore]) {
    button.disabled = flag;
  }
  if (detail?.els) {
    detail.els.toolAdd.disabled = flag;
    detail.els.toolTemplate.disabled = flag;
    detail.els.toolSend.disabled = flag || !(state.toolDrafts.get(detail.id) || []).length;
  }
  if (!flag) {
    const ticket = currentTicket();
    if (ticket && detail) updateComposer(ticket, detail);
    else syncCommandbar();
  }
}

/* --------------------------- commandbar more menu --------------------------- */

function positionCommandMenu() {
  if (!els.commandMenu || els.commandMenu.classList.contains("hidden")) return;
  const trigger = els.cmdMore.getBoundingClientRect();
  const width = Math.max(160, els.commandMenu.offsetWidth || 160);
  const left = Math.min(Math.max(8, trigger.left), Math.max(8, window.innerWidth - width - 8));
  els.commandMenu.style.left = `${Math.round(left)}px`;
  els.commandMenu.style.bottom = `${Math.round(window.innerHeight - trigger.top + 6)}px`;
}

function openCommandMenu() {
  if (!els.commandMenu || els.cmdMore.disabled) return;
  els.commandMenu.classList.remove("hidden");
  els.cmdMore.setAttribute("aria-expanded", "true");
  positionCommandMenu();
  els.commandMenu.querySelector("button:not(:disabled)")?.focus();
}

function closeCommandMenu() {
  if (!els.commandMenu || els.commandMenu.classList.contains("hidden")) return;
  els.commandMenu.classList.add("hidden");
  els.cmdMore.setAttribute("aria-expanded", "false");
}

function toggleCommandMenu() {
  if (els.commandMenu.classList.contains("hidden")) openCommandMenu();
  else closeCommandMenu();
}

/* --------------------------- quick replies --------------------------- */

const TEMPLATE_KEY = "ngzr.templates";
const TEMPLATE_MIGRATION_KEY = "ngzr.templates.migrated.v1";
let templates = [];
let editingTemplate = null;
let templatesLoaded = false;

function templateVariables(ticket) {
  const now = new Date();
  return {
    caller: ticket?.caller || "调用方",
    model: ticket?.model || "human-1",
    ticket: ticket ? shortId(ticket.id) : "",
    operator: state.operator || "",
    date: now.toLocaleDateString("zh-CN"),
    time: now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
  };
}

function renderTemplateText(text, ticket) {
  const vars = templateVariables(ticket);
  return String(text).replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key) => vars[key] ?? match);
}

function canManageTemplate(template) {
  if (state.role === "admin") return true;
  return template.visibility !== "shared" && template.owner === state.operator;
}

async function migrateLocalTemplates() {
  try {
    if (localStorage.getItem(TEMPLATE_MIGRATION_KEY)) return;
    localStorage.setItem(TEMPLATE_MIGRATION_KEY, "1");
    const stored = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || "null");
    if (!Array.isArray(stored) || !stored.length) return;
    for (const item of stored.slice(0, 50)) {
      const name = String(item?.name || "").trim().slice(0, 64);
      const content = String(item?.content || "").trim().slice(0, 4000);
      if (!name || !content) continue;
      await api("/op/api/templates", {
        method: "POST",
        body: { name, content, visibility: "personal", scope: "" },
      }).catch(() => null);
    }
  } catch { /* migration is best effort */ }
}

async function loadTemplatesFromServer() {
  const data = await api("/op/api/templates");
  templates = Array.isArray(data.templates) ? data.templates : [];
  if (!templates.length) {
    await migrateLocalTemplates();
    if (localStorage.getItem(TEMPLATE_MIGRATION_KEY)) {
      const again = await api("/op/api/templates");
      templates = Array.isArray(again.templates) ? again.templates : [];
    }
  }
  templatesLoaded = true;
}

function populateTemplateScopes() {
  const current = els.templateScope.value;
  els.templateScope.replaceChildren(new Option("全部模型", ""));
  for (const model of state.models || []) {
    els.templateScope.append(new Option(model, model));
  }
  els.templateScope.value = [...els.templateScope.options].some((option) => option.value === current) ? current : "";
}

function renderTemplateList() {
  els.templateList.replaceChildren();
  if (!templates.length) {
    els.templateList.append(el("div", "admin-empty", templatesLoaded ? "还没有模板，先在右侧保存一个。" : "正在加载模板…"));
    return;
  }
  for (const template of templates) {
    const row = el("div", "template-item");
    const copy = el("div", "template-copy");
    const title = el("strong", "", template.name);
    copy.append(title);
    copy.append(el(
      "div",
      "template-owner",
      `${template.visibility === "shared" ? "共享" : `个人 @${template.owner}`}${template.scope ? ` · ${template.scope}` : ""}${template.uses ? ` · 用过 ${template.uses} 次` : ""}`,
    ));
    const preview = el("div", "template-preview", template.content);
    copy.append(preview);
    const actions = el("div", "template-actions");
    const insert = el("button", "btn primary", "插入");
    insert.type = "button";
    insert.addEventListener("click", () => insertTemplate(template));
    actions.append(insert);
    if (canManageTemplate(template)) {
      const edit = el("button", "btn ghost", "编辑");
      edit.type = "button";
      edit.addEventListener("click", () => beginEditTemplate(template));
      const remove = el("button", "btn danger", "删除");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        if (!window.confirm(`删除模板「${template.name}」？`)) return;
        try {
          await api(`/op/api/templates/${encodeURIComponent(template.id)}`, { method: "DELETE", body: {} });
          templates = templates.filter((item) => item.id !== template.id);
          renderTemplateList();
          resetTemplateForm();
        } catch (error) {
          toast(`删除模板失败：${error.message}`);
        }
      });
      actions.append(edit, remove);
    }
    row.append(copy, actions);
    els.templateList.append(row);
  }
}

function insertTemplate(template) {
  const ticket = currentTicket();
  if (!ticket || !detail || detail.id !== ticket.id || detail.els.draft.disabled) {
    toast("当前票据没有可编辑的回复草稿。");
    return;
  }
  const draft = detail.els.draft;
  const start = draft.selectionStart ?? draft.value.length;
  const end = draft.selectionEnd ?? start;
  const text = renderTemplateText(template.content, ticket);
  draft.setRangeText(text, start, end, "end");
  draft.dispatchEvent(new Event("input", { bubbles: true }));
  draft.focus();
  closeTemplateModal();
  api(`/op/api/templates/${encodeURIComponent(template.id)}/use`, { method: "POST", body: {} }).catch(() => {});
}

function beginEditTemplate(template) {
  editingTemplate = template;
  els.templateName.value = template.name;
  els.templateContent.value = template.content;
  els.templateVisibility.value = template.visibility;
  populateTemplateScopes();
  els.templateScope.value = template.scope || "";
  els.templateFormTitle.textContent = "编辑模板";
  els.templateError.textContent = "";
  els.templateName.focus();
}

function resetTemplateForm() {
  editingTemplate = null;
  els.templateForm.reset();
  populateTemplateScopes();
  els.templateVisibility.value = "personal";
  els.templateFormTitle.textContent = "新建模板";
  els.templateError.textContent = "";
}

async function saveTemplate(event) {
  event.preventDefault();
  const name = els.templateName.value.trim();
  const content = els.templateContent.value.trim();
  const visibility = els.templateVisibility.value === "shared" ? "shared" : "personal";
  if (!name || !content) {
    els.templateError.textContent = "名称和内容都不能为空。";
    return;
  }
  const body = { name, content, visibility, scope: els.templateScope.value };
  const wasEditing = Boolean(editingTemplate);
  els.templateError.textContent = "";
  try {
    const data = wasEditing
      ? await api(`/op/api/templates/${encodeURIComponent(editingTemplate.id)}`, { method: "PATCH", body })
      : await api("/op/api/templates", { method: "POST", body });
    if (editingTemplate) {
      const index = templates.findIndex((item) => item.id === editingTemplate.id);
      if (index >= 0) templates[index] = data.template;
      else templates.unshift(data.template);
    } else {
      templates.unshift(data.template);
    }
    renderTemplateList();
    resetTemplateForm();
    toast(wasEditing ? "模板已更新" : "模板已保存");
  } catch (error) {
    els.templateError.textContent = error.message;
  }
}

async function openTemplateModal() {
  els.templateModal.classList.remove("hidden");
  resetTemplateForm();
  els.templateVisibility.querySelector('option[value="shared"]').disabled = state.role !== "admin";
  els.templateList.replaceChildren(el("div", "admin-empty", "正在加载模板…"));
  try {
    await loadTemplatesFromServer();
    renderTemplateList();
  } catch (error) {
    templatesLoaded = false;
    els.templateList.replaceChildren(el("div", "admin-empty", `加载模板失败：${error.message}`));
  }
  window.setTimeout(() => els.templateName.focus(), 30);
}

function closeTemplateModal() {
  els.templateModal.classList.add("hidden");
}

/* ------------------------------ transfer ------------------------------ */

async function openTransfer() {
  const ticket = currentTicket();
  if (!ticket) return;
  els.transferError.textContent = "";
  els.transferNote.value = "";
  els.transferTarget.replaceChildren();
  els.transferTarget.disabled = true;
  els.transferModal.classList.remove("hidden");
  try {
    const data = await api(`/op/api/operators?ticket=${encodeURIComponent(ticket.id)}`);
    const choices = (data.operators || []).filter((item) => item.username !== state.operator);
    if (!choices.length) {
      els.transferError.textContent = "没有其他可转交的用户。";
      return;
    }
    for (const item of choices) {
      const option = document.createElement("option");
      option.value = item.username;
      option.textContent = `${item.username} · ${item.role === "admin" ? "管理员" : "人工回复员"}${item.online ? " · 在线" : " · 离线"}`;
      els.transferTarget.append(option);
    }
    els.transferTarget.disabled = false;
  } catch (error) {
    els.transferError.textContent = error.message;
  }
}

function closeTransfer() {
  els.transferModal.classList.add("hidden");
}

async function confirmTransfer() {
  const ticket = currentTicket();
  const to = els.transferTarget.value;
  if (!ticket || !to) return;
  els.transferConfirm.disabled = true;
  els.transferError.textContent = "";
  try {
    await api(`/op/api/tickets/${encodeURIComponent(ticket.id)}/transfer`, {
      method: "POST",
      body: { to, note: els.transferNote.value.trim() },
    });
    closeTransfer();
    toast(`票据已转交给 ${to}`);
    await pollOnce();
  } catch (error) {
    els.transferError.textContent = error.message;
  } finally {
    els.transferConfirm.disabled = false;
  }
}

async function sendToolCalls() {
  const ticket = currentTicket();
  if (!ticket || !detail || detail.id !== ticket.id) return;
  const calls = state.toolDrafts.get(ticket.id) || [];
  if (!calls.length) {
    toast("先添加至少一个工具调用。");
    return;
  }
  for (const call of calls) {
    const issue = validateDraftToolCall(ticket, call);
    if (issue) {
      activateInspectorTab(detail, "tools");
      setToolError(detail, issue);
      toast("工具参数仍有问题，请先修正。");
      return;
    }
  }
  await doAction("finish");
}

async function takeoverTicket() {
  const ticket = currentTicket();
  if (!ticket || state.role !== "admin") return;
  if (ticket.claimedBy === state.operator) {
    toast("这张票据已经由你处理，无需接管。");
    return;
  }
  if (ticket.state !== "claimed" || !ticket.claimedBy) {
    toast("只有其他回复员已认领、尚未开始流式的票据可以接管。");
    return;
  }
  if (!window.confirm(`接管这张票据？\n\n当前接待人 @${ticket.claimedBy || "-"} 将失去发送权限，你可以继续编辑并回复。`)) return;
  state.busy = true;
  setButtonsDisabled(true);
  try {
    await api(`/op/api/tickets/${encodeURIComponent(ticket.id)}/takeover`, { method: "POST", body: {} });
    toast(`已接管 ${shortId(ticket.id)}，原接待人 @${ticket.claimedBy || "-"}`);
    await pollOnce();
  } catch (error) {
    toast(error.message);
  } finally {
    state.busy = false;
    setButtonsDisabled(false);
  }
}

/* ---------------------------- subpages ---------------------------- */

const subpageCache = new Map();

function installSubpageStyles(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc) return;
    let style = doc.getElementById("ngzr-embed-style");
    if (!style) {
      style = doc.createElement("style");
      style.id = "ngzr-embed-style";
      doc.head.append(style);
    }
    style.textContent = `
      .topbar, .guide-actions, .guide-hero-actions, .guide-footer { display: none !important; }
      .admin-main, .guide-main { padding-top: 18px !important; }
      body { min-height: 100vh; }
    `;
    doc.documentElement.classList.add("ngzr-embedded");
  } catch {
    /* same-origin pages should always be reachable; ignore transient document swaps */
  }
}

function setTopnavActive(href) {
  for (const link of document.querySelectorAll("#topnav a.topnav-item")) {
    link.classList.toggle("active", link.getAttribute("href") === href);
  }
}

function syncTopbarOffset() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  document.documentElement.style.setProperty(
    "--topbar-height",
    `${Math.ceil(topbar.getBoundingClientRect().height)}px`,
  );
}

function openSubpage(href, title) {
  if (!href || href === "/console") {
    closeSubpage();
    return;
  }
  const wasOpen = !els.subpageOverlay.classList.contains("hidden");
  els.subpageOverlay.classList.remove("hidden");
  document.body.classList.add("subpage-open");
  syncTopbarOffset();
  setTopnavActive(href);

  for (const frame of subpageCache.values()) frame.hidden = true;
  let frame = subpageCache.get(href);
  if (!frame) {
    frame = document.createElement("iframe");
    frame.className = "subpage-frame";
    frame.title = title || "子页面";
    frame.src = `${href}${href.includes("?") ? "&" : "?"}embed=1`;
    frame.addEventListener("load", () => {
      installSubpageStyles(frame);
      frame.dataset.loaded = "1";
      if (!frame.hidden) els.subpageLoading.hidden = true;
    });
    subpageCache.set(href, frame);
    els.subpageFrames.append(frame);
  }
  frame.hidden = false;
  if (frame.dataset.loaded === "1") els.subpageLoading.hidden = true;
  else els.subpageLoading.hidden = false;

  const current = `${location.pathname}${location.search}`;
  if (current !== href) {
    if (wasOpen) history.replaceState({ ngzrSubpage: href }, "", href);
    else history.pushState({ ngzrSubpage: href }, "", href);
  }
}

function closeSubpage({ fromHistory = false } = {}) {
  if (els.subpageOverlay.classList.contains("hidden")) return;
  els.subpageOverlay.classList.add("hidden");
  document.body.classList.remove("subpage-open");
  els.subpageLoading.hidden = true;
  setTopnavActive("/console");
  if (!fromHistory && location.pathname !== "/console") {
    history.replaceState({}, "", "/console");
  }
}

function initSubpages() {
  syncTopbarOffset();
  window.addEventListener("resize", syncTopbarOffset);
  document.getElementById("topnav")?.addEventListener("click", (event) => {
    const link = event.target.closest("a.topnav-item");
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("/console")) return;
    event.preventDefault();
    if (href === "/console") closeSubpage();
    else openSubpage(href, link.textContent.trim());
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || els.subpageOverlay.classList.contains("hidden")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSubpage();
    },
    true,
  );
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === "ngzr-preferences-changed") {
      state.preferences = event.data.preferences || state.preferences;
      const ticket = currentTicket();
      if (ticket && detail) {
        syncQuickBar(ticket, detail);
        syncAiTools(ticket, detail);
      }
      refreshQuickBarInfo(true);
      return;
    }
    if (event.data?.type === "ngzr-ai-changed") {
      api("/auth/me").then((me) => {
        state.aiAssist = me.aiAssist || state.aiAssist;
        maybeAutoAi();
      }).catch(() => {});
      return;
    }
    if (event.data?.type !== "ngzr-models-changed") return;
    for (const href of ["/console/keys", "/console/users"]) {
      const frame = subpageCache.get(href);
      if (!frame) continue;
      frame.dataset.loaded = "";
      frame.src = `${href}${href.includes("?") ? "&" : "?"}embed=1`;
    }
  });
  window.addEventListener("popstate", () => {
    if (!els.subpageOverlay.classList.contains("hidden")) closeSubpage({ fromHistory: true });
  });
}

/* ------------------------------ shortcuts ------------------------------ */

const SHORTCUTS_VERSION = 2;

function loadShortcuts() {
  const loaded = {};
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem("ngzr.shortcuts") || "{}") || {};
  } catch {
    /* corrupt localStorage: use defaults */
  }
  // Before v2, Ctrl+Enter was finish and Ctrl+Shift+Enter was push. Migrate
  // those known defaults once, while preserving deliberately customized keys.
  if (stored.__version !== SHORTCUTS_VERSION) {
    if (stored.finish === "Mod+Enter" && stored.push === "Mod+Shift+Enter") {
      delete stored.finish;
      delete stored.push;
    }
    stored.__version = SHORTCUTS_VERSION;
    try {
      localStorage.setItem("ngzr.shortcuts", JSON.stringify(stored));
    } catch {
      /* private mode: keep defaults in memory */
    }
  }
  for (const [key, value] of Object.entries(stored)) {
    if (key === "__version") continue;
    if (typeof value === "string" && /^(Mod|Shift|Alt|Control|Meta)(\+[A-Za-z0-9/\[\]=,.;'`-]+)+$/.test(value)) {
      loaded[key] = value;
    }
  }
  return { ...DEFAULT_SHORTCUTS, ...loaded };
}

function saveShortcuts() {
  try {
    localStorage.setItem("ngzr.shortcuts", JSON.stringify({ ...state.shortcuts, __version: SHORTCUTS_VERSION }));
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
  const shift = event.shiftKey;
  // Shift+Enter is a first-class send shortcut. Allow Shift-only for
  // non-letter keys so typing an uppercase letter isn't captured globally.
  if (!mod && !alt && !(shift && ["Enter", "Tab", "Escape"].includes(event.key))) return null;
  const parts = [];
  if (mod) parts.push("Mod");
  if (shift) parts.push("Shift");
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
  rememberSelectedTicket(next.id);
  render();
}

let commandPaletteState = null;
let commandPaletteItems = [];
let commandPaletteIndex = 0;

function ensureCommandPalette() {
  if (commandPaletteState?.root?.isConnected) return commandPaletteState;
  const root = el("div", "command-palette-backdrop hidden");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "命令面板");
  const panel = el("section", "command-palette");
  const top = el("div", "command-palette-top");
  top.append(el("span", "command-palette-key", "⌘K"));
  const input = el("input", "command-palette-input");
  input.placeholder = "搜索票据或执行操作…";
  input.autocomplete = "off";
  input.spellcheck = false;
  top.append(input);
  const list = el("div", "command-palette-list");
  const foot = el("div", "command-palette-foot", "↑↓ 选择 · Enter 执行 · Esc 关闭");
  panel.append(top, list, foot);
  root.append(panel);
  document.body.append(root);
  commandPaletteState = { root, input, list };
  root.addEventListener("click", (event) => {
    if (event.target === root) closeCommandPalette();
  });
  input.addEventListener("input", () => {
    commandPaletteIndex = 0;
    renderCommandPalette();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      commandPaletteIndex = commandPaletteItems.length ? (commandPaletteIndex + 1) % commandPaletteItems.length : 0;
      renderCommandPalette();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      commandPaletteIndex = commandPaletteItems.length ? (commandPaletteIndex - 1 + commandPaletteItems.length) % commandPaletteItems.length : 0;
      renderCommandPalette();
    } else if (event.key === "Enter") {
      event.preventDefault();
      executeCommandPalette();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeCommandPalette();
    }
  });
  return commandPaletteState;
}

function commandPaletteActions() {
  const ticket = currentTicket();
  const actions = [];
  const add = (group, label, hint, run, badge = "") => actions.push({ group, label, hint, run, badge });
  if (ticket) {
    if (ticket.state === "queued") add("当前票据", "认领票据", "取得当前票据的编辑权", () => doAction("claim"), "Enter");
    if (isTicketEditable(ticket)) {
      add("当前票据", "AI 生成", "将当前会话交给 AI 辅助", () => runAiTask("reply", detail, state.aiPrompts.get(ticket.id) || ""), "AI");
      add("当前票据", "AI 引导", "附加方向提示后生成", () => detail?.els?.aiPromptTrigger?.click());
      add("当前票据", "工具调用", "打开右侧工具标签", () => {
        if (!detail) return;
        detail.inspectorCollapsed = false;
        applyInspectorState(detail);
        activateInspectorTab(detail, "tools");
      }, "TOOL");
      add("当前票据", "更多 / 内部备注", "打开右侧更多标签", () => {
        if (!detail) return;
        detail.inspectorCollapsed = false;
        applyInspectorState(detail);
        activateInspectorTab(detail, "more");
      });
      add("当前票据", "快捷回复", "插入一条已保存的模板", openTemplateModal);
      add("当前票据", "正文并完成", "发送当前草稿并结束票据", () => doAction("finish"), "⌘↵");
      if (ticket.state === "claimed") add("当前票据", "转交票据", "把票据交给其他回复员", openTransfer);
      if (isActive(ticket)) add("当前票据", "取消请求", "中止请求并通知调用方", () => doAction("cancel"));
    }
    add("工作台", "下一张票据", "切换到队列中的下一张票据", nextTicket);
    add("工作台", "聚焦回复框", "把光标放到回复编辑器", focusDraft);
    add("工作台", document.body.classList.contains("queue-collapsed") ? "展开队列" : "收起队列", "释放会话区域的横向空间", toggleQueue, "[");
    add("工作台", document.body.classList.contains("compact-ui") ? "切换舒适密度" : "切换紧凑密度", "紧凑显示队列和消息", toggleCompactUi);
    add("工作台", "快捷键面板", "查看和自定义键盘快捷键", openShortcuts, "?");
  }
  const layoutLabels = { auto: "自动", fit: "适配", scroll: "滚动" };
  for (const [key, label] of Object.entries(layoutLabels)) {
    add("微缩总览", `布局：${label}`, "短会话适配或长会话滚动", () => setMinimapLayout(key), state.minimapLayout === key ? "当前" : "");
  }
  add("微缩总览", "滑块：悬停显示", "只在指针进入微缩条时显示滑块", () => setMinimapSlider("hover"), state.minimapSlider === "hover" ? "当前" : "");
  add("微缩总览", "滑块：一直显示", "微缩总览出现时始终显示滑块", () => setMinimapSlider("always"), state.minimapSlider === "always" ? "当前" : "");
  add("微缩总览", state.minimapMode === "semantic" ? "语义聚合：关闭" : "语义聚合：开启", "按用户/助手轮次聚合，合并工具组", () => setMinimapMode(state.minimapMode === "semantic" ? "overlay" : "semantic"), state.minimapMode === "semantic" ? "已开启" : "");
  add("微缩总览", "聚焦微缩总览", "用键盘方向键、Home/End 导航", () => {
    const minimap = detail?.els?.threadMinimap;
    if (!minimap || minimap.classList.contains("hidden")) return;
    minimap.classList.add("visible");
    minimap.focus({ preventScroll: true });
  });

  const tickets = [...state.tickets]
    .sort((a, b) => (a.state === "queued" ? 0 : isActive(a) ? 1 : 2) - (b.state === "queued" ? 0 : isActive(b) ? 1 : 2) || (a.created || a.createdAt) - (b.created || b.createdAt))
    .slice(0, 20);
  for (const item of tickets) {
    add("票据", item.preview || item.id, `${item.model || ""} · ${STATE_LABELS[item.state] || item.state}`, () => {
      state.selectedId = item.id;
      rememberSelectedTicket(item.id);
      if (window.matchMedia("(max-width: 780px)").matches) setMobileView("detail");
      render();
    }, shortId(item.id));
  }
  return actions;
}

function renderCommandPalette() {
  const palette = commandPaletteState;
  if (!palette) return;
  const query = palette.input.value.trim().toLowerCase();
  const all = commandPaletteActions();
  commandPaletteItems = all.filter((item) => !query || `${item.group} ${item.label} ${item.hint}`.toLowerCase().includes(query));
  if (commandPaletteIndex >= commandPaletteItems.length) commandPaletteIndex = Math.max(0, commandPaletteItems.length - 1);
  palette.list.replaceChildren();
  if (!commandPaletteItems.length) {
    palette.list.append(el("div", "command-palette-empty", "没有匹配的票据或操作"));
    return;
  }
  let group = "";
  commandPaletteItems.forEach((item, index) => {
    if (item.group !== group) {
      group = item.group;
      palette.list.append(el("div", "command-palette-group", group));
    }
    const button = el("button", "command-palette-item");
    button.type = "button";
    button.classList.toggle("active", index === commandPaletteIndex);
    const main = el("span", "command-palette-main");
    main.append(el("span", "command-palette-label", item.label));
    main.append(el("span", "command-palette-hint", item.hint));
    button.append(main);
    if (item.badge) button.append(el("kbd", "command-palette-badge", item.badge));
    button.addEventListener("click", () => {
      commandPaletteIndex = index;
      executeCommandPalette();
    });
    palette.list.append(button);
  });
  palette.list.querySelector(".command-palette-item.active")?.scrollIntoView({ block: "nearest" });
}

function openCommandPalette() {
  const palette = ensureCommandPalette();
  palette.input.value = "";
  commandPaletteIndex = 0;
  renderCommandPalette();
  palette.root.classList.remove("hidden");
  requestAnimationFrame(() => palette.input.focus());
}

function closeCommandPalette() {
  commandPaletteState?.root?.classList.add("hidden");
}

function executeCommandPalette() {
  const item = commandPaletteItems[commandPaletteIndex];
  if (!item) return;
  closeCommandPalette();
  try { item.run(); } catch (error) { toast(error.message); }
}

function toggleQueue() {
  const next = !document.body.classList.contains("queue-collapsed");
  document.body.classList.toggle("queue-collapsed", next);
  try { localStorage.setItem("ngzr.queueCollapsed", next ? "1" : "0"); } catch { /* optional */ }
  syncQueueToggle();
  requestAnimationFrame(reflowContextWidth);
}

function syncQueueToggle() {
  const text = document.body.classList.contains("queue-collapsed") ? "展开队列" : "收起队列";
  if (els.queueToggle) els.queueToggle.textContent = text;
  for (const button of document.querySelectorAll(".queue-toggle")) button.textContent = text;
}

function toggleCompactUi() {
  const next = !document.body.classList.contains("compact-ui");
  document.body.classList.toggle("compact-ui", next);
  try { localStorage.setItem("ngzr.compactUi", next ? "1" : "0"); } catch { /* optional */ }
}

function handleGlobalShortcut(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (commandPaletteState?.root?.classList.contains("hidden") === false) {
    if (event.key === "Escape") closeCommandPalette();
    return;
  }
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
  if (isDraft && !["think", "finish", "push"].includes(action)) return;
  if (["think", "finish", "push", "claim", "release", "refuse", "cancel", "next"].includes(action) && !currentTicket()) {
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
  installAudioUnlock();
  state.minimapMode = loadMinimapMode();
  state.minimapSlider = loadMinimapSlider();
  state.minimapLayout = loadMinimapLayout();
  state.shortcuts = loadShortcuts();
  updateShortcutLabels();
  try {
    if (localStorage.getItem("ngzr.queueCollapsed") === "1") document.body.classList.add("queue-collapsed");
    if (localStorage.getItem("ngzr.compactUi") === "1") document.body.classList.add("compact-ui");
  } catch { /* optional */ }
  syncQueueToggle();
  els.queueToggle?.addEventListener("click", toggleQueue);
  els.commandPaletteBtn?.addEventListener("click", openCommandPalette);
  els.autoclaim.checked = localStorage.getItem("ngzr.autoclaim") === "1";

  els.autoclaim.addEventListener("change", () => {
    localStorage.setItem("ngzr.autoclaim", els.autoclaim.checked ? "1" : "0");
  });
  setMobileView("queue");
  els.mobileViewTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mobile-view]");
    if (!button) return;
    setMobileView(button.dataset.mobileView);
  });
  els.cmdNext.addEventListener("click", nextTicket);
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
  els.cmdTemplates.addEventListener("click", openTemplateModal);
  els.cmdTransfer.addEventListener("click", openTransfer);
  els.cmdTakeover.addEventListener("click", takeoverTicket);
  els.cmdThink.addEventListener("click", () => doAction("think"));
  els.cmdPush.addEventListener("click", () => doAction("push"));
  els.cmdFinish.addEventListener("click", () => doAction("finish"));
  els.cmdRelease.addEventListener("click", () => doAction("release"));
  els.cmdRefuse.addEventListener("click", () => doAction("refuse"));
  els.cmdCancel.addEventListener("click", () => doAction("cancel"));
  els.cmdShortcuts.addEventListener("click", () => {
    closeCommandMenu();
    openShortcuts();
  });
  els.cmdMore.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleCommandMenu();
  });
  document.addEventListener("click", (event) => {
    if (!els.commandMenu || els.commandMenu.classList.contains("hidden")) return;
    if (els.commandMenu.contains(event.target) || els.cmdMore.contains(event.target)) return;
    closeCommandMenu();
  });
  window.addEventListener("resize", closeCommandMenu);
  window.addEventListener("resize", () => requestAnimationFrame(reflowContextWidth));
  setInterval(() => refreshQuickBarInfo(), 30_000);
  window.addEventListener("scroll", closeCommandMenu, true);
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.(".ai-tools")) closeAiMenus();
    if (detail?.els?.aiPanel?.classList.contains("expanded") &&
        !detail.els.aiPanel.contains(event.target)) {
      collapseAiPreview(detail);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.commandMenu.classList.contains("hidden")) {
      closeCommandMenu();
      els.cmdMore.focus();
      return;
    }
    if (detail?.els?.aiPanel?.classList.contains("expanded")) {
      collapseAiPreview(detail);
      detail.els.aiExpand?.focus();
      return;
    }
    closeAiMenus();
  });
  els.templateForm.addEventListener("submit", saveTemplate);
  els.templateReset.addEventListener("click", resetTemplateForm);
  els.templateClose.addEventListener("click", closeTemplateModal);
  els.templateModal.addEventListener("click", (event) => {
    if (event.target === els.templateModal) closeTemplateModal();
  });
  els.transferConfirm.addEventListener("click", confirmTransfer);
  els.transferCancel.addEventListener("click", closeTransfer);
  els.transferClose.addEventListener("click", closeTransfer);
  els.transferModal.addEventListener("click", (event) => {
    if (event.target === els.transferModal) closeTransfer();
  });
  els.shortcutClose.addEventListener("click", closeShortcuts);
  els.shortcutReset.addEventListener("click", resetShortcuts);
  els.shortcutModal.addEventListener("click", (event) => {
    if (event.target === els.shortcutModal) closeShortcuts();
  });
  initSubpages();
  els.attachmentClose?.addEventListener("click", () => els.attachmentModal.classList.add("hidden"));
  els.attachmentModal?.addEventListener("click", (event) => {
    if (event.target === els.attachmentModal) els.attachmentModal.classList.add("hidden");
  });
  window.addEventListener("pagehide", saveDraftsNow);
  window.NGZRPasswordStrength?.mount(els.newPassword);
  document.addEventListener("keydown", handleGlobalShortcut);
  syncCommandbar();

  loadSession();
}

init();
