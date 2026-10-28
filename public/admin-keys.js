/* 调用密钥页面：新增和编辑复用同一表单 */

const $ = (id) => document.getElementById(id);
let csrf = "";
let operator = "";
let role = "";
let editingKeyId = "";
const state = { keys: [] };
let availableModels = [];
let selectedModels = new Set();
function customModelList() {
  return $("newKeyCustomModels").value.split(",").map((name) => name.trim()).filter(Boolean);
}

function allModelsSelected() {
  return selectedModels.size === 0 && customModelList().length === 0;
}

function selectedModelList() {
  const custom = customModelList();
  if (selectedModels.size === 0 && custom.length === 0) return [];
  return [...new Set([...selectedModels, ...custom])].slice(0, 64);
}

function updateModelHint() {
  const hint = $("newKeyModelHint");
  const models = selectedModelList();
  if (models.length === 0) {
    hint.textContent = "全部模型 = 不限制；可以保存常用模型组合。";
  } else {
    hint.textContent = `只允许 ${models.length} 个模型：${models.join("、")}`;
  }
}

function renderModelPicker() {
  const picker = $("newKeyModelPicker");
  picker.replaceChildren();
  const all = document.createElement("button");
  all.type = "button";
  all.className = "model-chip";
  all.textContent = "全部模型";
  all.classList.toggle("active", allModelsSelected());
  all.addEventListener("click", () => {
    selectedModels.clear();
    $("newKeyCustomModels").value = "";
    renderModelPicker();
  });
  picker.append(all);
  for (const name of availableModels) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "model-chip";
    chip.textContent = name;
    chip.classList.toggle("active", selectedModels.has(name));
    chip.addEventListener("click", () => {
      if (allModelsSelected()) {
        selectedModels.clear();
        selectedModels.add(name);
      } else if (selectedModels.has(name)) {
        selectedModels.delete(name);
      } else {
        selectedModels.add(name);
        if (selectedModels.size === availableModels.length && customModelList().length === 0) {
          selectedModels.clear();
        }
      }
      renderModelPicker();
    });
    picker.append(chip);
  }
  if (!availableModels.length) picker.append(elHint("暂无可选模型；可直接填下面的自定义模型。"));
  updateModelHint();
}

function elHint(text) {
  const span = document.createElement("span");
  span.className = "admin-hint";
  span.textContent = text;
  return span;
}

async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") headers["X-CSRF-Token"] = csrf;
  const response = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    location.replace(`/login?next=${encodeURIComponent(location.pathname)}`);
    throw new Error("请重新登录");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function setStatus(text, bad = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("err", bad);
}

function setError(message = "") {
  $("keysError").textContent = message;
}

function dateText(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function quotaText(key) {
  const limits = key.limits || {};
  return [
    `${Number(limits.requestsPerMinute) || "不限"}/分`,
    `${Number(limits.requestsPerDay) || "不限"}/日`,
    `${Number(limits.requestsPerMonth) || "不限"}/月`,
    `并发 ${Number(limits.maxConcurrent) || "继承"}`,
  ].join(" · ");
}

function usageText(usage) {
  if (!usage) return "—";
  return `${usage.minute}/分 · ${usage.day}/日 · ${usage.month}/月`;
}

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function remainingText(ms) {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时`;
  return `${Math.ceil(hours / 24)} 天`;
}

function updateExpiryHint() {
  const preset = $("newKeyExpiryPreset").value;
  const input = $("newKeyExpires");
  const hint = $("newKeyExpiryHint");
  hint.classList.remove("warn");
  if (preset === "never" || !input.value) {
    hint.textContent = "永不过期：密钥一直有效，直到手动停用或删除。";
    return;
  }
  const when = new Date(input.value);
  if (!Number.isFinite(when.getTime())) {
    hint.textContent = "时间格式不正确，请重新选择。";
    hint.classList.add("warn");
    return;
  }
  const diff = when.getTime() - Date.now();
  if (diff <= 0) {
    hint.textContent = `已过期（${dateText(when.getTime())}），请改到未来或选择永不过期。`;
    hint.classList.add("warn");
  } else {
    hint.textContent = `有效期至 ${dateText(when.getTime())}，还剩约 ${remainingText(diff)}。`;
  }
}

function applyExpiryPreset(value) {
  const input = $("newKeyExpires");
  if (value === "never") {
    input.value = "";
    input.disabled = true;
  } else if (value === "custom") {
    input.disabled = false;
    input.focus();
  } else {
    const target = new Date();
    target.setDate(target.getDate() + Number(value));
    target.setSeconds(0, 0);
    input.value = localDateTime(target.toISOString());
    input.disabled = false;
  }
  updateExpiryHint();
}

async function loadMe() {
  const me = await api("/auth/me");
  csrf = me.csrfToken;
  operator = me.user.username;
  role = me.user.role;
  if (role !== "admin") {
    location.replace("/console");
    return;
  }
  $("userLabel").textContent = `${operator} · 管理员`;
  const modelData = await api("/op/api/models");
  availableModels = (modelData.models || []).map((model) => String(model.id));
  renderModelPicker();
  window.NGZRNAV?.render(role, me.features);
  setStatus("已登录");
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST", body: {} });
  } catch {
    /* still leave */
  }
  location.replace("/login");
}

function setMode(isEdit) {
  $("keyFormTitle").textContent = isEdit ? "编辑密钥" : "生成新密钥";
  $("keyCreateBtn").textContent = isEdit ? "保存修改" : "生成新密钥";
  $("keyCancelBtn").classList.toggle("hidden", !isEdit);
  $("keyValueField").classList.toggle("hidden", isEdit);
}

function resetForm() {
  editingKeyId = "";
  setMode(false);
  $("keyCreateForm").reset();
  $("newKeyRpm").value = 0;
  $("newKeyPerDay").value = 0;
  $("newKeyPerMonth").value = 0;
  $("newKeyConcurrent").value = 0;
  $("newKeyValue").value = "";
  selectedModels.clear();
  $("newKeyCustomModels").value = "";
  renderModelPicker();
  $("newKeyExpiryPreset").value = "never";
  $("newKeyExpires").value = "";
  $("newKeyExpires").disabled = true;
  updateExpiryHint();
  $("newKeyBox").classList.add("hidden");
  setError("");
}

function fillForm(key) {
  const limits = key.limits || {};
  $("newKeyName").value = key.name;
  $("newKeyRpm").value = limits.requestsPerMinute || 0;
  $("newKeyPerDay").value = limits.requestsPerDay || 0;
  $("newKeyPerMonth").value = limits.requestsPerMonth || 0;
  $("newKeyConcurrent").value = limits.maxConcurrent || 0;
  const allowed = Array.isArray(key.allowedModels) ? key.allowedModels : [];
  selectedModels = new Set(allowed.filter((model) => availableModels.includes(model)));
  $("newKeyCustomModels").value = allowed.filter((model) => !availableModels.includes(model)).join(", ");
  renderModelPicker();
  if (key.expiresAt) {
    $("newKeyExpiryPreset").value = "custom";
    $("newKeyExpires").disabled = false;
    $("newKeyExpires").value = localDateTime(key.expiresAt);
  } else {
    $("newKeyExpiryPreset").value = "never";
    $("newKeyExpires").value = "";
    $("newKeyExpires").disabled = true;
  }
  updateExpiryHint();
  $("newKeyValue").value = "";
}

function beginEdit(key) {
  editingKeyId = key.id;
  setMode(true);
  fillForm(key);
  $("newKeyBox").classList.add("hidden");
  setError("");
  $("newKeyName").focus();
}

function renderKeys() {
  const tbody = $("keyTable");
  tbody.replaceChildren();
  $("keyCount").textContent = `${state.keys.length} 个密钥`;
  $("keysEmpty").classList.toggle("hidden", state.keys.length > 0);
  for (const key of state.keys) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.className = "cell-main";
    name.textContent = key.name;
    row.append(name);

    const hint = document.createElement("td");
    hint.className = "mono";
    hint.textContent = key.hint || "—";
    row.append(hint);

    const expired = Boolean(key.expiresAt && key.expiresAt <= Date.now());
    const status = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `status-badge ${key.disabled || expired ? "off" : "ok"}`;
    badge.textContent = key.disabled ? "已停用" : expired ? "已过期" : "可用";
    status.append(badge);
    row.append(status);

    const expiryCell = document.createElement("td");
    if (!key.expiresAt) {
      expiryCell.textContent = "永不过期";
    } else {
      expiryCell.textContent = dateText(key.expiresAt);
      const remaining = document.createElement("div");
      remaining.className = `admin-hint${expired ? " warn" : ""}`;
      remaining.textContent = expired
        ? "已过期"
        : `还剩约 ${remainingText(key.expiresAt - Date.now())}`;
      expiryCell.append(remaining);
    }
    row.append(expiryCell);

    for (const text of [quotaText(key), (key.allowedModels || []).join(", ") || "全部"]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }

    const created = document.createElement("td");
    created.append(document.createTextNode(dateText(key.createdAt)));
    const recent = document.createElement("div");
    recent.className = "admin-hint";
    recent.textContent = `最近：${dateText(key.lastUsedAt)}`;
    created.append(recent);
    row.append(created);

    const usage = document.createElement("td");
    usage.textContent = usageText(key.usage);
    row.append(usage);

    const actions = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "actions";
    const edit = document.createElement("button");
    edit.className = "btn ghost";
    edit.type = "button";
    edit.textContent = "编辑";
    edit.addEventListener("click", () => beginEdit(key));
    const rotate = document.createElement("button");
    rotate.className = "btn ghost";
    rotate.type = "button";
    rotate.textContent = "轮换";
    rotate.addEventListener("click", () => rotateKey(key));
    const toggle = document.createElement("button");
    toggle.className = "btn ghost";
    toggle.type = "button";
    toggle.textContent = key.disabled ? "启用" : "停用";
    toggle.addEventListener("click", () => toggleKey(key));
    const remove = document.createElement("button");
    remove.className = "btn danger";
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", () => deleteKey(key));
    wrap.append(edit, rotate, toggle, remove);
    actions.append(wrap);
    row.append(actions);
    tbody.append(row);
  }
}

async function loadKeys() {
  const data = await api("/op/api/keys");
  state.keys = Array.isArray(data.keys) ? data.keys : [];
  renderKeys();
}

function limitsForm() {
  return {
    requestsPerMinute: Number($("newKeyRpm").value) || 0,
    requestsPerDay: Number($("newKeyPerDay").value) || 0,
    requestsPerMonth: Number($("newKeyPerMonth").value) || 0,
    maxConcurrent: Number($("newKeyConcurrent").value) || 0,
  };
}

function modelsForm() {
  return selectedModelList();
}

function expiryForm() {
  if ($("newKeyExpiryPreset").value === "never") return null;
  const value = $("newKeyExpires").value;
  if (!value) throw new Error("请选择过期时间，或选择永不过期。");
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error("过期时间格式不正确。");
  if (parsed <= Date.now()) throw new Error("过期时间必须晚于当前时间；如需永久有效，请选择永不过期。");
  return parsed;
}

function sameNameKey(name) {
  const needle = String(name || "").trim().toLowerCase();
  return state.keys.find((key) => key.name.trim().toLowerCase() === needle);
}

async function saveCurrent(isEdit) {
  const body = {
    name: $("newKeyName").value.trim(),
    limits: limitsForm(),
    allowedModels: modelsForm(),
    expiresAt: expiryForm(),
  };
  if (!isEdit) body.value = $("newKeyValue").value.trim() || undefined;
  const data = await api(isEdit ? `/op/api/keys/${encodeURIComponent(editingKeyId)}` : "/op/api/keys", {
    method: isEdit ? "PATCH" : "POST",
    body,
  });
  const newKey = !isEdit ? data.key : "";
  resetForm();
  if (!isEdit) {
    $("newKeyValueDisplay").textContent = newKey;
    $("newKeyBox").classList.remove("hidden");
    setStatus("调用密钥已创建，请现在保存");
  } else {
    setStatus("密钥已更新");
  }
  await loadKeys();
}

async function submitKey(event) {
  event.preventDefault();
  setError("");
  $("keyCreateBtn").disabled = true;
  try {
    if (editingKeyId) {
      await saveCurrent(true);
      return;
    }
    const duplicate = sameNameKey($("newKeyName").value);
    if (duplicate) {
      editingKeyId = duplicate.id;
      setMode(true);
      setError("密钥名称已存在，已切换为编辑；当前填写内容保存后会更新这个密钥。");
      await saveCurrent(true);
      return;
    }
    await saveCurrent(false);
  } catch (error) {
    setError(error.message);
  } finally {
    $("keyCreateBtn").disabled = false;
  }
}

async function rotateKey(key) {
  if (!window.confirm(`轮换「${key.name}」？旧密钥会立即失效，新密钥只显示一次。`)) return;
  setError("");
  try {
    const data = await api(`/op/api/keys/${encodeURIComponent(key.id)}/rotate`, { method: "POST" });
    resetForm();
    $("newKeyValueDisplay").textContent = data.key;
    $("newKeyBox").classList.remove("hidden");
    setStatus("密钥已轮换，旧密钥立即失效");
    await loadKeys();
  } catch (error) {
    setError(error.message);
  }
}

async function toggleKey(key) {
  setError("");
  try {
    await api(`/op/api/keys/${encodeURIComponent(key.id)}`, {
      method: "PATCH",
      body: { disabled: !key.disabled },
    });
    setStatus(key.disabled ? "密钥已启用" : "密钥已停用");
    await loadKeys();
  } catch (error) {
    setError(error.message);
  }
}

async function deleteKey(key) {
  if (!window.confirm(`删除调用密钥「${key.name}」？删除后使用它的调用方会立即失败。`)) return;
  setError("");
  try {
    await api(`/op/api/keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
    if (editingKeyId === key.id) resetForm();
    setStatus("调用密钥已删除");
    await loadKeys();
  } catch (error) {
    setError(error.message);
  }
}

async function copyNewKey() {
  const value = $("newKeyValueDisplay").textContent || "";
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setStatus("已复制到剪贴板");
  } catch {
    const range = document.createRange();
    range.selectNodeContents($("newKeyValueDisplay"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    setStatus("请手动复制选中的密钥");
  }
}

async function init() {
  try {
    await loadMe();
    await loadKeys();
    resetForm();
    $("keyCreateForm").addEventListener("submit", submitKey);
    $("keyCancelBtn").addEventListener("click", resetForm);
    $("newKeyExpiryPreset").addEventListener("change", (event) => applyExpiryPreset(event.target.value));
    $("newKeyExpires").addEventListener("input", () => {
      $("newKeyExpiryPreset").value = "custom";
      updateExpiryHint();
    });
    $("newKeyCustomModels").addEventListener("input", renderModelPicker);
    $("copyKeyBtn").addEventListener("click", copyNewKey);
    $("logout").addEventListener("click", logout);
  } catch (error) {
    setStatus("加载失败", true);
    setError(error.message);
  }
}

init();
