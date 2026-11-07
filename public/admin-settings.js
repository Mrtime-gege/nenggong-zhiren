/* Settings page: per-user personalization + admin-only functional settings */
const $ = (id) => document.getElementById(id);
let csrf = "";
let operator = "";
let role = "";
let latest = null;
let preferences = null;
let autoClaimAvailable = false;
const QUICK_KINDS = [
  ["action", "动作"],
  ["link", "页面跳转"],
  ["info", "信息显示"],
];
const QUICK_ACTIONS = [
  { value: "aiGenerate", label: "AI 生成 / 再次生成" },
  { value: "aiPrompt", label: "AI 引导" },
  { value: "templates", label: "快捷回复" },
  { value: "transfer", label: "转交" },
  { value: "routing", label: "打开路由" },
  { value: "tools", label: "打开工具" },
  { value: "more", label: "打开更多" },
  { value: "claim", label: "认领票据" },
  { value: "next", label: "下一张票据" },
  { value: "history", label: "查看历史", adminOnly: true },
  { value: "settings", label: "打开设置" },
  { value: "status", label: "打开状态页", adminOnly: true },
  { value: "users", label: "打开用户管理", adminOnly: true },
  { value: "models", label: "打开模型管理", adminOnly: true },
  { value: "keys", label: "打开 API 密钥", adminOnly: true },
  { value: "usage", label: "打开用量", adminOnly: true },
  { value: "audit", label: "打开审计", adminOnly: true },
];
const QUICK_LINKS = [
  { value: "/console/status", label: "状态页", adminOnly: true },
  { value: "/console/users", label: "用户管理", adminOnly: true },
  { value: "/console/models", label: "模型管理", adminOnly: true },
  { value: "/console/keys", label: "API 密钥", adminOnly: true },
  { value: "/console/usage", label: "用量", adminOnly: true },
  { value: "/console/audit", label: "审计", adminOnly: true },
  { value: "/console/history", label: "历史", adminOnly: true },
  { value: "/console/settings", label: "设置" },
];
const QUICK_INFOS = [
  { value: "memory", label: "内存占用" },
  { value: "uptime", label: "运行时长" },
  { value: "queue", label: "队列数量" },
  { value: "aiCards", label: "AI 结果数" },
];
const LEGACY_QUICK_BAR = {
  ai: { kind: "action", value: "aiGenerate", label: "AI 生成" },
  aiPrompt: { kind: "action", value: "aiPrompt", label: "AI 引导" },
  templates: { kind: "action", value: "templates", label: "快捷回复" },
  transfer: { kind: "action", value: "transfer", label: "转交" },
};
const MAX_QUICK_BAR_ITEMS = 15;
const DEFAULT_QUICK_BAR = [
  { id: "default-ai", kind: "action", value: "aiGenerate", label: "AI 生成" },
  { id: "default-ai-prompt", kind: "action", value: "aiPrompt", label: "AI 引导" },
];
let quickBarDraft = [];
let quickBarDraftSeq = 0;

function quickBarSpec(kind, value) {
  const list = kind === "action" ? QUICK_ACTIONS : kind === "link" ? QUICK_LINKS : kind === "info" ? QUICK_INFOS : [];
  return list.find((item) => item.value === value) || null;
}

function quickBarOptionsFor(kind) {
  const list = kind === "action" ? QUICK_ACTIONS : kind === "link" ? QUICK_LINKS : kind === "info" ? QUICK_INFOS : [];
  return list.filter((item) => !item.adminOnly || role === "admin");
}

function normalizeQuickItem(raw, index) {
  const source = typeof raw === "string" ? LEGACY_QUICK_BAR[raw] : raw;
  if (!source || typeof source !== "object") return null;
  const kind = QUICK_KINDS.some(([value]) => value === source.kind) ? source.kind : "action";
  const options = quickBarOptionsFor(kind);
  let value = String(source.value || "");
  if (!options.some((item) => item.value === value)) value = options[0]?.value || "";
  if (!value) return null;
  const spec = quickBarSpec(kind, value);
  const label = String(source.label || "").trim().slice(0, 40) || spec?.label || value;
  return {
    id: String(source.id || `quick_${Date.now()}_${++quickBarDraftSeq}`).slice(0, 64),
    kind,
    value,
    label,
  };
}

function normalizeQuickBar(value) {
  if (!Array.isArray(value)) return DEFAULT_QUICK_BAR.map((item) => ({ ...item }));
  return value.map((item, index) => normalizeQuickItem(item, index)).filter(Boolean).slice(0, MAX_QUICK_BAR_ITEMS);
}

function quickBarFormRow(item, index) {
  const row = document.createElement("div");
  row.className = "quickbar-item";
  row.dataset.index = String(index);

  const top = document.createElement("div");
  top.className = "quickbar-item-main";
  const label = document.createElement("input");
  label.className = "quickbar-label-input";
  label.maxLength = 40;
  label.value = item.label;
  label.placeholder = "显示名称";
  label.setAttribute("aria-label", "快捷项名称");
  label.addEventListener("input", () => { item.label = label.value; });

  const kind = document.createElement("select");
  kind.className = "quickbar-kind-select";
  kind.setAttribute("aria-label", "快捷项类型");
  for (const [value, text] of QUICK_KINDS) kind.append(new Option(text, value, false, item.kind === value));

  const value = document.createElement("select");
  value.className = "quickbar-value-select";
  value.setAttribute("aria-label", "快捷项功能");
  const fillValueOptions = () => {
    const options = quickBarOptionsFor(item.kind);
    value.replaceChildren();
    for (const option of options) value.append(new Option(option.label, option.value, false, item.value === option.value));
    if (!options.some((option) => option.value === item.value)) item.value = options[0]?.value || "";
    value.value = item.value;
  };
  fillValueOptions();

  const actions = document.createElement("div");
  actions.className = "quickbar-item-actions";
  const up = document.createElement("button");
  up.type = "button";
  up.className = "btn ghost quickbar-mini";
  up.textContent = "↑";
  up.title = "上移";
  up.disabled = index === 0;
  up.addEventListener("click", () => {
    [quickBarDraft[index - 1], quickBarDraft[index]] = [quickBarDraft[index], quickBarDraft[index - 1]];
    renderQuickBarOptions();
    queueSave("personal", savePersonal);
  });
  const down = document.createElement("button");
  down.type = "button";
  down.className = "btn ghost quickbar-mini";
  down.textContent = "↓";
  down.title = "下移";
  down.disabled = index === quickBarDraft.length - 1;
  down.addEventListener("click", () => {
    [quickBarDraft[index + 1], quickBarDraft[index]] = [quickBarDraft[index], quickBarDraft[index + 1]];
    renderQuickBarOptions();
    queueSave("personal", savePersonal);
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn ghost quickbar-mini quickbar-remove";
  remove.textContent = "删除";
  remove.title = "删除此快捷项";
  remove.addEventListener("click", () => {
    quickBarDraft.splice(index, 1);
    renderQuickBarOptions();
    queueSave("personal", savePersonal);
  });
  actions.append(up, down, remove);

  kind.addEventListener("change", () => {
    item.kind = kind.value;
    item.value = quickBarOptionsFor(item.kind)[0]?.value || "";
    if (!item.label || Object.values(LEGACY_QUICK_BAR).some((legacy) => legacy.label === item.label)) {
      item.label = quickBarOptionsFor(item.kind)[0]?.label || item.label;
    }
    renderQuickBarOptions();
    queueSave("personal", savePersonal);
  });
  value.addEventListener("change", () => {
    item.value = value.value;
    const spec = quickBarSpec(item.kind, item.value);
    if (!item.label || Object.values(LEGACY_QUICK_BAR).some((legacy) => legacy.label === item.label)) item.label = spec?.label || item.label;
    renderQuickBarOptions();
    queueSave("personal", savePersonal);
  });
  top.append(label, kind, value, actions);

  row.append(top);
  return row;
}

function renderQuickBarOptions() {
  const host = $("quickBarOptions");
  if (!host) return;
  const add = $("quickBarAdd");
  if (add) {
    add.disabled = quickBarDraft.length >= MAX_QUICK_BAR_ITEMS;
    add.title = add.disabled ? `最多 ${MAX_QUICK_BAR_ITEMS} 项` : "添加快捷项";
    add.textContent = add.disabled ? `已达上限 ${MAX_QUICK_BAR_ITEMS} 项` : "＋ 添加快捷项";
  }
  host.replaceChildren();
  quickBarDraft.forEach((item, index) => host.append(quickBarFormRow(item, index)));
  if (!quickBarDraft.length) {
    const empty = document.createElement("div");
    empty.className = "admin-hint";
    empty.textContent = "快捷栏为空。点击下方添加。";
    host.append(empty);
  }
}

function addQuickBarItem() {
  if (quickBarDraft.length >= MAX_QUICK_BAR_ITEMS) {
    showSettingsToast(`快捷栏最多 ${MAX_QUICK_BAR_ITEMS} 项。`, true);
    return;
  }
  const options = quickBarOptionsFor("action");
  const first = options[0];
  if (!first) return;
  quickBarDraft.push({
    id: `quick_${Date.now()}_${++quickBarDraftSeq}`,
    kind: "action",
    value: first.value,
    label: first.label,
  });
  renderQuickBarOptions();
  queueSave("personal", savePersonal);
}

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = csrf;
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 401) {
    location.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
    throw new Error("请重新登录");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `请求失败（${response.status}）`);
  return data;
}

function setStatus(text, bad = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("err", bad);
}

function showSettingsToast(message, bad = false) {
  const el = $("settingsToast");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", bad);
  el.classList.add("show");
  clearTimeout(showSettingsToast.timer);
  showSettingsToast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function flashSaved(message) {
  setStatus(message);
  showSettingsToast(message);
}

function hideSettingsToast() {
  const el = $("settingsToast");
  if (!el) return;
  el.classList.remove("show", "error");
}

function sameValue(actual, expected) {
  return actual === expected;
}

function setError(id, message = "") {
  const el = $(id);
  if (el) el.textContent = message;
}

function syncAutoClaimPreference(enabled = autoClaimAvailable) {
  autoClaimAvailable = Boolean(enabled);
  const input = $("prefAutoAiClaim");
  const hint = $("prefAutoAiClaimHint");
  if (input) input.disabled = !autoClaimAvailable;
  if (hint) {
    hint.textContent = autoClaimAvailable
      ? "已允许；开启后认领票据时会自动请求 AI 并填入草稿和工具。"
      : "需管理员在 AI 辅助中开启“允许回复员认领后自动使用 AI 辅助”。";
  }
}

function fillPreferences(data) {
  preferences = data.preferences || data;
  $("prefBrowserNotify").checked = preferences.browserNotifications !== false;
  $("prefSound").checked = preferences.notificationSound !== false;
  $("prefAutoClaim").checked = preferences.autoClaimDefault === true;
  if ($("prefAutoAiClaim")) $("prefAutoAiClaim").checked = preferences.autoAiOnClaim === true;
  syncAutoClaimPreference();
  if ($("prefQueueAlert")) $("prefQueueAlert").value = preferences.queueAlertSeconds ?? 120;
  quickBarDraft = normalizeQuickBar(preferences.quickBar);
  renderQuickBarOptions();
  const notifyButton = $("notifyPermission");
  if (notifyButton) {
    const supported = "Notification" in window;
    notifyButton.disabled = !supported || (supported && Notification.permission === "granted");
    notifyButton.title = !supported ? "当前浏览器不支持通知" : Notification.permission === "granted" ? "通知权限已授权" : "请求浏览器通知权限";
  }
}

function fillSettings(data) {
  latest = data;
  const s = data.settings;
  $("setWait").value = s.queue.waitTimeoutMs;
  $("setResponse").value = s.queue.responseTimeoutMs;
  $("setRetention").value = s.queue.retentionMs;
  $("setStream").value = s.queue.streamDelayMs;
  $("setConcurrent").value = s.limits.maxConcurrentPerKey;
  $("setBody").value = s.limits.bodyLimitBytes;
  $("setAudit").checked = s.features.auditLog;
  $("setUsage").checked = s.features.usageDashboard;
  $("setPublicGuide").checked = s.features.publicGuide !== false;
  const ai = s.aiAssist || {};
  $("aiEnabled").checked = ai.enabled === true;
  $("aiAutoClaimEnabled").checked = ai.autoClaimEnabled === true;
  $("aiAutoReceive").checked = ai.autoReplyOnReceive === true;
  $("aiEndpoint").value = ai.endpoint || "";
  $("aiModel").value = ai.model || "";
  $("aiConcurrent").value = ai.maxConcurrent ?? 2;
  $("aiApiKey").value = "";
  $("aiClearKey").checked = false;
  const key = data.aiAssistKey || {};
  $("aiKeyStatus").textContent = key.configured ? `已配置 ${key.hint || ""}` : "未配置";
  syncAutoClaimPreference(ai.enabled === true && ai.autoClaimEnabled === true);
  latest.mfaEnabled = data.mfaEnabled === true;
  $("mfaStatus").textContent = latest.mfaEnabled ? "已启用" : "未启用";
  $("mfaDisableBox").classList.toggle("hidden", !latest.mfaEnabled);
  $("mfaSetupBox").classList.add("hidden");
  $("mfaSetupBtn").classList.toggle("hidden", latest.mfaEnabled);
  const ro = data.readonly;
  const pairs = [
    ["监听地址", `${ro.host}:${ro.port}`],
    ["HTTPS", ro.tls_enabled ? "已启用" : "未启用"],
    ["登录 Cookie", ro.cookie_secure],
    ["模型", ro.models.join(", ")],
    ["受信 Host", ro.trusted_hosts.join(", ") || "自动"],
    ["账号文件", ro.users_file],
    ["密钥文件", ro.api_keys_file],
    ["运行状态", ro.state_file],
    ["用量文件", ro.usage_file],
    ["审计文件", ro.audit_file],
    ["会话有效期", `${Math.round((ro.session_ttl_ms || 0) / 60000)} 分`],
    ["会话空闲", `${Math.round((ro.session_idle_ms || 0) / 60000)} 分`],
    ["登录失败上限", `${ro.login_ip_max_failures} 次/IP · ${ro.login_user_max_failures} 次/用户`],
    ["内容日志", ro.log_content ? "开启" : "关闭"],
  ];
  const box = $("readonly");
  box.replaceChildren();
  for (const [key, value] of pairs) {
    const cell = document.createElement("div");
    cell.className = "readonly-item";
    const k = document.createElement("span");
    k.textContent = key;
    const v = document.createElement("code");
    v.textContent = value;
    cell.append(k, v);
    box.append(cell);
  }
}

async function load() {
  const me = await api("/auth/me");
  csrf = me.csrfToken;
  operator = me.user.username;
  role = me.user.role;
  $("userLabel").textContent = `${operator} · ${role === "admin" ? "管理员" : "人工回复员"}`;
  window.NGZRNAV?.render(role, me.features);
  document.querySelectorAll("[data-admin-only]").forEach((section) => {
    section.classList.toggle("hidden", role !== "admin");
  });
  autoClaimAvailable = me.aiAssist?.enabled === true && me.aiAssist?.autoClaimEnabled === true;
  fillPreferences(await api("/op/api/preferences"));
  if (role === "admin") {
    fillSettings(await api("/op/api/settings"));
  }
  setStatus("已登录");
}

function numberField(id, label) {
  const input = $(id);
  const raw = input.value.trim();
  const value = Number(raw);
  const min = Number(input.min);
  const max = Number(input.max);
  if (!raw || raw === "-" || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    input.classList.add("input-invalid");
    input.setAttribute("aria-invalid", "true");
    throw new Error(`${label}必须是 ${input.min}–${input.max} 的整数，已拒绝本次修改。`);
  }
  input.classList.remove("input-invalid");
  input.removeAttribute("aria-invalid");
  return value;
}

const saveTimers = new Map();
const saveSequence = new Map();
function queueSave(key, fn, delay = 120) {
  hideSettingsToast();
  const version = (saveSequence.get(key) || 0) + 1;
  saveSequence.set(key, version);
  clearTimeout(saveTimers.get(key));
  saveTimers.set(key, setTimeout(() => {
    saveTimers.delete(key);
    Promise.resolve(fn(version)).catch(() => {});
  }, delay));
}
function isCurrentSave(key, version) {
  return (saveSequence.get(key) || 0) === version;
}

async function savePersonal(version) {
  setError("personalError");
  try {
    const queueAlertSeconds = numberField("prefQueueAlert", "排队提醒");
    const data = await api("/op/api/preferences", {
      method: "PATCH",
      body: {
        browserNotifications: $("prefBrowserNotify").checked,
        notificationSound: $("prefSound").checked,
        autoClaimDefault: $("prefAutoClaim").checked,
        autoAiOnClaim: $("prefAutoAiClaim")?.checked === true,
        queueAlertSeconds,
        quickBar: quickBarDraft.map((item) => ({
          id: item.id,
          kind: item.kind,
          value: item.value,
          label: item.label,
        })),
      },
    });
    preferences = data.preferences;
    if (!isCurrentSave("personal", version)) return;
    if (preferences.queueAlertSeconds !== queueAlertSeconds) throw new Error("服务端未保存本次修改，请重试。");
    try {
      window.parent?.postMessage({ type: "ngzr-preferences-changed", preferences }, location.origin);
    } catch { /* standalone page or blocked parent */ }
    flashSaved("个性化设置已修改并生效");
  } catch (error) {
    if (!isCurrentSave("personal", version)) return;
    hideSettingsToast();
    setError("personalError", error.message);
  }
}

async function saveRuntime(version) {
  if (role !== "admin") return;
  setError("settingsError");
  try {
    const queue = {
      waitTimeoutMs: numberField("setWait", "等待超时"),
      responseTimeoutMs: numberField("setResponse", "回复超时"),
      retentionMs: numberField("setRetention", "完成记录保留"),
      streamDelayMs: numberField("setStream", "全局默认输出速度"),
    };
    const limits = {
      maxConcurrentPerKey: numberField("setConcurrent", "每密钥并发上限"),
      bodyLimitBytes: numberField("setBody", "请求体上限"),
    };
    const data = await api("/op/api/settings", { method: "PATCH", body: { queue, limits } });
    if (!isCurrentSave("runtime", version)) return;
    const saved = data.settings;
    for (const [key, value] of Object.entries(queue)) {
      if (!sameValue(saved.queue[key], value)) throw new Error("服务端未保存本次运行参数修改，请重试。");
    }
    for (const [key, value] of Object.entries(limits)) {
      if (!sameValue(saved.limits[key], value)) throw new Error("服务端未保存本次运行参数修改，请重试。");
    }
    latest.settings = saved;
    flashSaved("运行参数已修改并生效");
  } catch (error) {
    if (!isCurrentSave("runtime", version)) return;
    setError("settingsError", error.message);
  }
}

async function saveFeatures(version) {
  if (role !== "admin") return;
  setError("featureError");
  try {
    const data = await api("/op/api/settings", {
      method: "PATCH",
      body: {
        features: {
          auditLog: $("setAudit").checked,
          usageDashboard: $("setUsage").checked,
          publicGuide: $("setPublicGuide").checked,
        },
      },
    });
    if (!isCurrentSave("features", version)) return;
    const expected = {
      auditLog: $("setAudit").checked,
      usageDashboard: $("setUsage").checked,
      publicGuide: $("setPublicGuide").checked,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (!sameValue(data.settings.features[key], value)) throw new Error("服务端未保存本次功能设置修改，请重试。");
    }
    latest.settings = data.settings;
    window.NGZRNAV?.render(role, data.settings.features);
    try {
      window.parent?.postMessage(
        { type: "ngzr-features-changed", features: data.settings.features },
        location.origin,
      );
    } catch { /* optional */ }
    flashSaved("功能设置已修改并生效");
  } catch (error) {
    if (!isCurrentSave("features", version)) return;
    setError("featureError", error.message);
  }
}

async function saveAiAssist(version) {
  if (role !== "admin") return;
  setError("aiError");
  try {
    const body = {
      aiAssist: {
        enabled: $("aiEnabled").checked,
        autoClaimEnabled: $("aiAutoClaimEnabled").checked,
        autoReplyOnReceive: $("aiAutoReceive").checked,
        endpoint: $("aiEndpoint").value.trim(),
        model: $("aiModel").value.trim(),
        maxConcurrent: numberField("aiConcurrent", "全局并发"),
      },
    };
    if ($("aiApiKey").value.trim()) body.apiKey = $("aiApiKey").value.trim();
    if ($("aiClearKey").checked) body.clearAiKey = true;
    const data = await api("/op/api/settings", { method: "PATCH", body });
    if (!isCurrentSave("ai", version)) return;
    const savedAi = data.settings.aiAssist;
    for (const [key, value] of Object.entries(body.aiAssist)) {
      if (!sameValue(savedAi[key], value)) throw new Error("服务端未保存本次 AI 设置修改，请重试。");
    }
    latest.settings = data.settings;
    try { window.parent?.postMessage({ type: "ngzr-ai-changed" }, location.origin); } catch { /* optional */ }
    const key = data.aiAssistKey || {};
    $("aiKeyStatus").textContent = key.configured ? `已配置 ${key.hint || ""}` : "未配置";
    $("aiApiKey").value = "";
    $("aiClearKey").checked = false;
    syncAutoClaimPreference(savedAi.enabled === true && savedAi.autoClaimEnabled === true);
    flashSaved("AI 设置已修改并生效");
  } catch (error) {
    if (!isCurrentSave("ai", version)) return;
    hideSettingsToast();
    setError("aiError", error.message);
  }
}

function bindAutoSave(formId, key, fn) {
  const form = $(formId);
  if (!form) return;
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("change", () => queueSave(key, fn));
}

function previewSound() {
  if ($("prefSound") && !$("prefSound").checked) {
    setError("personalError", "提示音当前已关闭。");
    return;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.1);
    oscillator.addEventListener("ended", () => ctx.close().catch(() => {}), { once: true });
  } catch {
    setError("personalError", "浏览器无法播放提示音。");
  }
}

async function requestPermission() {
  if (!("Notification" in window)) {
    setError("personalError", "当前浏览器不支持通知。");
    return;
  }
  setError("personalError");
  if (Notification.permission === "denied") {
    setError("personalError", "浏览器已拒绝通知权限，请在站点设置中允许后刷新页面。");
    return;
  }
  const result = await Notification.requestPermission();
  const button = $("notifyPermission");
  if (button) button.disabled = result === "granted";
  if (result === "granted") {
    flashSaved("浏览器通知已授权");
  } else if (result === "denied") {
    setError("personalError", "浏览器已拒绝通知权限，请在站点设置中允许后刷新页面。");
  }
}

async function setupMfa() {
  if (role !== "admin") return;
  setError("mfaError");
  try {
    const data = await api("/op/api/mfa/setup", { method: "POST" });
    $("mfaSecret").textContent = data.secret;
    $("mfaUri").textContent = data.otpauth;
    $("mfaSetupBox").classList.remove("hidden");
    $("mfaSetupBtn").classList.add("hidden");
    $("mfaCode").focus();
  } catch (error) { setError("mfaError", error.message); }
}

async function enableMfa(event) {
  event.preventDefault();
  if (role !== "admin") return;
  setError("mfaError");
  $("mfaEnableBtn").disabled = true;
  try {
    await api("/op/api/mfa/enable", { method: "POST", body: { code: $("mfaCode").value.trim() } });
    flashSaved("MFA 已启用");
    $("mfaSetupBox").classList.add("hidden");
    $("mfaDisableBox").classList.remove("hidden");
    $("mfaStatus").textContent = "已启用";
    $("mfaSetupBtn").classList.add("hidden");
  } catch (error) { setError("mfaError", error.message); }
  finally { $("mfaEnableBtn").disabled = false; }
}

async function disableMfa(event) {
  event.preventDefault();
  if (role !== "admin") return;
  setError("mfaError");
  $("mfaDisableBtn").disabled = true;
  try {
    await api("/op/api/mfa/disable", { method: "POST", body: { password: $("mfaPassword").value } });
    flashSaved("MFA 已关闭");
    $("mfaDisableBox").classList.add("hidden");
    $("mfaSetupBox").classList.add("hidden");
    $("mfaStatus").textContent = "未启用";
    $("mfaSetupBtn").classList.remove("hidden");
    $("mfaPassword").value = "";
  } catch (error) { setError("mfaError", error.message); }
  finally { $("mfaDisableBtn").disabled = false; }
}

function cancelMfaSetup() {
  $("mfaSetupBox").classList.add("hidden");
  $("mfaSetupBtn").classList.remove("hidden");
  setError("mfaError");
}

async function logout() {
  try { await api("/auth/logout", { method: "POST", body: {} }); } catch { /* leave */ }
  location.replace("/login");
}

const SETTINGS_TAB_KEY = "ngzr.settingsTab";

function settingsTabForCard(card) {
  if (card.classList.contains("personal-card")) return "personal";
  const title = card.querySelector(".admin-card-title")?.textContent.trim() || "";
  if (title.startsWith("运行参数")) return "runtime";
  if (title.startsWith("功能设置")) return "features";
  if (title.startsWith("AI 辅助")) return "ai";
  if (title.includes("MFA")) return "security";
  if (title.startsWith("只读启动配置")) return "system";
  return "";
}

function initSettingsNavigation() {
  const host = $("settingsPanels");
  if (!host || host.dataset.ready === "1") return;
  const tabs = [...document.querySelectorAll("[data-settings-tab]")];
  if (!tabs.length) return;
  const allowed = new Set(tabs.map((tab) => tab.dataset.settingsTab));
  const panels = new Map();
  for (const key of allowed) {
    const panel = document.createElement("section");
    panel.className = "settings-panel hidden";
    panel.dataset.settingsPanel = key;
    host.append(panel);
    panels.set(key, panel);
  }
  const cards = [...document.querySelectorAll(".settings-content .admin-card")];
  for (const card of cards) {
    const key = settingsTabForCard(card);
    if (!panels.has(key)) continue;
    panels.get(key).append(card);
  }
  document.querySelector(".settings-content > .admin-only[data-admin-only]")?.remove();
  host.dataset.ready = "1";

  const activate = (requested, persist = true) => {
    const key = allowed.has(requested) ? requested : "personal";
    for (const tab of tabs) {
      const active = tab.dataset.settingsTab === key;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-current", active ? "page" : "false");
    }
    for (const [panelKey, panel] of panels) {
      panel.classList.toggle("hidden", panelKey !== key);
    }
    if (persist) {
      try { localStorage.setItem(SETTINGS_TAB_KEY, key); } catch { /* optional */ }
      try { history.replaceState(null, "", `${location.pathname}#${key}`); } catch { /* optional */ }
    }
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => activate(tab.dataset.settingsTab));
  }
  let initial = location.hash.slice(1);
  if (!allowed.has(initial)) {
    try { initial = localStorage.getItem(SETTINGS_TAB_KEY) || "personal"; } catch { initial = "personal"; }
  }
  activate(initial, false);
}

async function init() {
  initSettingsNavigation();
  try {
    await load();
    bindAutoSave("personalForm", "personal", savePersonal);
    $("quickBarAdd")?.addEventListener("click", addQuickBarItem);
    $("notifyPermission").addEventListener("click", requestPermission);
    $("prefSoundTest")?.addEventListener("click", previewSound);
    $("logout").addEventListener("click", logout);
    if (role === "admin") {
      bindAutoSave("runtimeForm", "runtime", saveRuntime);
      bindAutoSave("featureForm", "features", saveFeatures);
      bindAutoSave("aiAssistForm", "ai", saveAiAssist);
      $("mfaSetupBtn").addEventListener("click", setupMfa);
      $("mfaEnableForm").addEventListener("submit", enableMfa);
      $("mfaDisableForm").addEventListener("submit", disableMfa);
      $("mfaCancelSetup").addEventListener("click", cancelMfaSetup);
    }
  } catch (error) {
    setStatus("加载失败", true);
    setError("personalError", error.message);
    setError("settingsError", error.message);
  }
}
init();
