const $ = (id) => document.getElementById(id);
let csrf = "";
let operator = "";
let models = [];

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
  if (!response.ok) throw new Error(data.error?.message || `请求失败（${response.status}）`);
  return data;
}

function setStatus(text, bad = false) {
  $("status").textContent = text;
  $("status").classList.toggle("err", bad);
}

function setError(text = "") {
  $("modelsError").textContent = text;
}

function render() {
  const tbody = $("modelTable");
  tbody.replaceChildren();
  $("modelCount").textContent = `${models.length} 个模型`;
  $("modelsEmpty").classList.toggle("hidden", models.length > 0);
  for (const model of models) {
    const row = document.createElement("tr");
    for (const value of [
      model.id,
      model.name || model.id,
      (model.capabilities || []).join(", ") || "text",
      new Date(model.createdAt).toLocaleString(),
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (value === model.id) cell.className = "mono";
      row.append(cell);
    }
    const actions = document.createElement("td");
    const remove = document.createElement("button");
    remove.className = "btn danger";
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", () => removeModel(model));
    actions.append(remove);
    row.append(actions);
    tbody.append(row);
  }
}

async function loadModels() {
  const data = await api("/op/api/models");
  models = Array.isArray(data.models) ? data.models : [];
  render();
}

async function removeModel(model) {
  if (!window.confirm(`删除模型「${model.id}」？\n\n如果仍有调用密钥、回复员权限或未结束票据引用它，删除会被拒绝。`)) return;
  setError("");
  try {
    await api(`/op/api/models/${encodeURIComponent(model.id)}`, { method: "DELETE" });
    setStatus(`模型已删除：${model.id}`);
    await loadModels();
    window.parent?.postMessage({ type: "ngzr-models-changed" }, location.origin);
  } catch (error) {
    setError(error.message);
  }
}

async function createModel(event) {
  event.preventDefault();
  setError("");
  $("modelCreateBtn").disabled = true;
  try {
    await api("/op/api/models", {
      method: "POST",
      body: {
        id: $("modelId").value.trim(),
        name: $("modelName").value.trim() || undefined,
      },
    });
    $("modelCreateForm").reset();
    $("modelId").focus();
    setStatus("模型已添加");
    await loadModels();
    window.parent?.postMessage({ type: "ngzr-models-changed" }, location.origin);
  } catch (error) {
    setError(error.message);
  } finally {
    $("modelCreateBtn").disabled = false;
  }
}

async function init() {
  try {
    const me = await api("/auth/me");
    csrf = me.csrfToken;
    operator = me.user.username;
    if (me.user.role !== "admin") {
      location.replace("/console");
      return;
    }
    $("userLabel").textContent = `${operator} · 管理员`;
    window.NGZRNAV?.render(me.user.role, me.features);
    await loadModels();
    $("modelCreateForm").addEventListener("submit", createModel);
    $("logout").addEventListener("click", async () => {
      try { await api("/auth/logout", { method: "POST", body: {} }); } catch { /* leave */ }
      location.replace("/login");
    });
    setStatus("已登录");
  } catch (error) {
    setStatus("加载失败", true);
    setError(error.message);
  }
}
init();
