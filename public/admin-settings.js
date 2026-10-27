/* Settings page */
const $ = (id) => document.getElementById(id);
let csrf = "";
let operator = "";
let role = "";
let latest = null;

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
  el.textContent = text;
  el.classList.toggle("err", bad);
}

function setError(id, message = "") { $(id).textContent = message; }

function fill(data) {
  latest = data;
  const s = data.settings;
  $("setWait").value = s.queue.waitTimeoutMs;
  $("setResponse").value = s.queue.responseTimeoutMs;
  $("setRetention").value = s.queue.retentionMs;
  $("setStream").value = s.queue.streamDelayMs;
  $("setConcurrent").value = s.limits.maxConcurrentPerKey;
  $("setBody").value = s.limits.bodyLimitBytes;
  $("setBrowserNotify").checked = s.features.browserNotifications;
  $("setSound").checked = s.features.notificationSound;
  $("setAutoClaim").checked = s.features.autoClaimDefault;
  $("setAudit").checked = s.features.auditLog;
  $("setUsage").checked = s.features.usageDashboard;
  $("setQueueAlert").value = s.features.queueAlertSeconds;
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
  updateNotifyState();
}

async function load() {
  const me = await api("/auth/me");
  csrf = me.csrfToken;
  operator = me.user.username;
  role = me.user.role;
  if (role !== "admin") { location.replace("/console"); return; }
  $("userLabel").textContent = `${operator} · 管理员`;
  window.NGZRNAV?.render(role, me.features);
  const data = await api("/op/api/settings");
  fill(data);
  setStatus("已登录");
}

async function saveRuntime(event) {
  event.preventDefault();
  setError("settingsError");
  $("runtimeSave").disabled = true;
  try {
    const data = await api("/op/api/settings", {
      method: "PATCH",
      body: {
        queue: {
          waitTimeoutMs: Number($("setWait").value),
          responseTimeoutMs: Number($("setResponse").value),
          retentionMs: Number($("setRetention").value),
          streamDelayMs: Number($("setStream").value),
        },
        limits: {
          maxConcurrentPerKey: Number($("setConcurrent").value),
          bodyLimitBytes: Number($("setBody").value),
        },
      },
    });
    latest.settings = data.settings;
    setStatus("运行参数已保存");
  } catch (error) {
    setError("settingsError", error.message);
  } finally {
    $("runtimeSave").disabled = false;
  }
}

async function saveFeatures(event) {
  event.preventDefault();
  setError("featureError");
  $("featureSave").disabled = true;
  try {
    const data = await api("/op/api/settings", {
      method: "PATCH",
      body: {
        features: {
          browserNotifications: $("setBrowserNotify").checked,
          notificationSound: $("setSound").checked,
          autoClaimDefault: $("setAutoClaim").checked,
          auditLog: $("setAudit").checked,
          usageDashboard: $("setUsage").checked,
          queueAlertSeconds: Number($("setQueueAlert").value),
        },
      },
    });
    latest.settings = data.settings;
    window.NGZRNAV?.render(role, data.settings.features);
    updateNotifyState();
    setStatus("功能开关已保存");
  } catch (error) {
    setError("featureError", error.message);
  } finally {
    $("featureSave").disabled = false;
  }
}

function updateNotifyState() {
  const supported = "Notification" in window;
  const state = supported ? Notification.permission : "unsupported";
  $("notifyState").textContent = state === "granted" ? "已授权" : state === "denied" ? "已拒绝" : state === "unsupported" ? "浏览器不支持" : "未授权";
  $("notifyPermission").disabled = !supported || state === "granted";
}

async function requestPermission() {
  if (!("Notification" in window)) return;
  const result = await Notification.requestPermission();
  updateNotifyState();
  if (result === "granted") new Notification("能工智人", { body: "浏览器通知已开启" });
}

async function setupMfa() {
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
  setError("mfaError");
  $("mfaEnableBtn").disabled = true;
  try {
    await api("/op/api/mfa/enable", { method: "POST", body: { code: $("mfaCode").value.trim() } });
    setStatus("MFA 已启用");
    $("mfaSetupBox").classList.add("hidden");
    $("mfaDisableBox").classList.remove("hidden");
    $("mfaStatus").textContent = "已启用";
    $("mfaSetupBtn").classList.add("hidden");
  } catch (error) { setError("mfaError", error.message); }
  finally { $("mfaEnableBtn").disabled = false; }
}

async function disableMfa(event) {
  event.preventDefault();
  setError("mfaError");
  $("mfaDisableBtn").disabled = true;
  try {
    await api("/op/api/mfa/disable", { method: "POST", body: { password: $("mfaPassword").value } });
    setStatus("MFA 已关闭");
    $("mfaDisableBox").classList.add("hidden");
    $("mfaSetupBox").classList.add("hidden");
    $("mfaStatus").textContent = "未启用";
    $("mfaSetupBtn").classList.remove("hidden");
    $("mfaPassword").value = "";
  } catch (error) { setError("mfaError", error.message); }
  finally { $("mfaDisableBtn").disabled = false; }
}

async function cancelMfaSetup() {
  $("mfaSetupBox").classList.add("hidden");
  $("mfaSetupBtn").classList.remove("hidden");
  setError("mfaError");
}

async function logout() {
  try { await api("/auth/logout", { method: "POST", body: {} }); } catch { /* leave */ }
  location.replace("/login");
}

async function init() {
  try {
    await load();
    $("runtimeForm").addEventListener("submit", saveRuntime);
    $("featureForm").addEventListener("submit", saveFeatures);
    $("notifyPermission").addEventListener("click", requestPermission);
    $("mfaSetupBtn").addEventListener("click", setupMfa);
    $("mfaEnableForm").addEventListener("submit", enableMfa);
    $("mfaDisableForm").addEventListener("submit", disableMfa);
    $("mfaCancelSetup").addEventListener("click", cancelMfaSetup);
    $("logout").addEventListener("click", logout);
  } catch (error) {
    setStatus("加载失败", true);
    setError("settingsError", error.message);
  }
}
init();
