const $ = (id) => document.getElementById(id);
let csrf = "";
let operator = "";
let models = [];
let editingModelId = null;

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
    const speedLabel = Number.isInteger(model.speedMs)
      ? `${model.speedMs} ms`
      : model.id.includes("fast") ? "自动 fast" : "跟随全局";
    for (const value of [
      model.id,
      model.name || model.id,
      speedLabel,
      (model.capabilities || []).join(", ") || "text",
      new Date(model.createdAt).toLocaleString(),
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (value === model.id) cell.className = "mono";
      row.append(cell);
    }
    const actions = document.createElement("td");
    const edit = document.createElement("button");
    edit.className = "btn";
    edit.type = "button";
    edit.textContent = "编辑";
    edit.addEventListener("click", () => editModel(model));
    const remove = document.createElement("button");
    remove.className = "btn danger";
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", () => removeModel(model));
    actions.append(edit, remove);
    row.append(actions);
    tbody.append(row);
  }
}

function resetModelForm() {
  editingModelId = null;
  $("modelCreateForm").reset();
  $("modelId").readOnly = false;
  $("modelId").classList.remove("readonly-input");
  $("modelCreateBtn").textContent = "添加模型";
  $("modelCancelEdit").classList.add("hidden");
  $("modelFormHint").textContent = "添加后可在列表中再次编辑速度。";
}

function editModel(model) {
  editingModelId = model.id;
  $("modelId").value = model.id;
  $("modelId").readOnly = true;
  $("modelId").classList.add("readonly-input");
  $("modelName").value = model.name || "";
  $("modelSpeed").value = Number.isInteger(model.speedMs) ? model.speedMs : "";
  $("modelCreateBtn").textContent = "保存修改";
  $("modelCancelEdit").classList.remove("hidden");
  $("modelFormHint").textContent = "正在编辑模型；留空速度表示跟随全局。";
  $("modelCreateBtn").scrollIntoView({ block: "nearest", behavior: "smooth" });
  $("modelName").focus();
}

async function updateModel(modelId, body) {
  return api(`/op/api/models/${encodeURIComponent(modelId)}`, { method: "PATCH", body });
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
    if (editingModelId === model.id) resetModelForm();
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
    const speedRaw = $("modelSpeed").value.trim();
    const speedMs = speedRaw === "" ? (editingModelId ? null : undefined) : Number(speedRaw);
    if (speedMs !== undefined && speedMs !== null && (!Number.isInteger(speedMs) || speedMs < 0 || speedMs > 60000)) {
      throw new Error("输出速度必须是 0–60000 的整数毫秒。");
    }
    if (editingModelId) {
      await updateModel(editingModelId, {
        name: $("modelName").value.trim(),
        speedMs,
      });
      setStatus(`模型已更新：${editingModelId}`);
    } else {
      await api("/op/api/models", {
        method: "POST",
        body: {
          id: $("modelId").value.trim(),
          name: $("modelName").value.trim() || undefined,
          speedMs,
        },
      });
      setStatus("模型已添加");
    }
    resetModelForm();
    $("modelId").focus();
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
    $("modelCancelEdit").addEventListener("click", resetModelForm);
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
