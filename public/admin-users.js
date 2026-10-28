/* 用户管理页面：新增和编辑复用同一表单 */

const $ = (id) => document.getElementById(id);
let csrf = "";
let operator = "";
let role = "";
let editingUser = "";
const state = { users: [] };
let availableModels = [];
let selectedUserModels = new Set();

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
  $("usersError").textContent = message;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
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

function resetForm() {
  editingUser = "";
  $("userFormTitle").textContent = "添加用户";
  $("newUsername").disabled = false;
  $("newUsername").value = "";
  $("newPassword").value = "";
  $("newPassword").required = true;
  window.NGZRPasswordStrength?.hide($("newPassword"));
  $("newPassword").placeholder = "至少 8 位";
  $("passwordFlag").className = "req";
  $("passwordFlag").textContent = "必填";
  $("newRole").disabled = false;
  $("newRole").value = "operator";
  selectedUserModels.clear();
  renderUserModelPicker();
  $("userCreateBtn").textContent = "添加用户";
  $("userCancelBtn").classList.add("hidden");
  setError("");
}

function beginEdit(user) {
  editingUser = user.username;
  $("userFormTitle").textContent = "编辑用户";
  $("newUsername").value = user.username;
  $("newUsername").disabled = true;
  $("newPassword").value = "";
  $("newPassword").required = false;
  window.NGZRPasswordStrength?.hide($("newPassword"));
  $("newPassword").placeholder = "留空表示不修改密码";
  $("passwordFlag").className = "opt";
  $("passwordFlag").textContent = "选填";
  $("newRole").value = user.role;
  $("newRole").disabled = user.username === operator;
  selectedUserModels = new Set((user.allowedModels || []).filter((model) => availableModels.includes(model)));
  renderUserModelPicker();
  $("userCreateBtn").textContent = "保存修改";
  $("userCancelBtn").classList.remove("hidden");
  setError("");
  $("newPassword").focus();
}

function selectedUserModelList() {
  return selectedUserModels.size ? [...selectedUserModels] : [];
}

function renderUserModelPicker() {
  const picker = $("userModelPicker");
  picker.replaceChildren();
  const all = document.createElement("button");
  all.type = "button";
  all.className = "model-chip";
  all.textContent = "全部模型";
  all.classList.toggle("active", selectedUserModels.size === 0);
  all.addEventListener("click", () => {
    selectedUserModels.clear();
    renderUserModelPicker();
  });
  picker.append(all);
  for (const model of availableModels) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "model-chip";
    chip.textContent = model;
    chip.classList.toggle("active", selectedUserModels.has(model));
    chip.addEventListener("click", () => {
      if (selectedUserModels.size === 0) {
        selectedUserModels.clear();
        selectedUserModels.add(model);
      } else if (selectedUserModels.has(model)) {
        selectedUserModels.delete(model);
      } else {
        selectedUserModels.add(model);
        if (selectedUserModels.size === availableModels.length) selectedUserModels.clear();
      }
      renderUserModelPicker();
    });
    picker.append(chip);
  }
  if (!availableModels.length) {
    picker.append(Object.assign(document.createElement("span"), {
      className: "admin-hint",
      textContent: "还没有可用模型，请先在「模型」页面添加。",
    }));
  }
  $("userModelHint").textContent = selectedUserModels.size
    ? `仅可回复：${selectedUserModelList().join("、")}`
    : "全部模型 = 不限制；无权限的票据不会出现在该用户队列中。";
}

async function loadModels() {
  const data = await api("/op/api/models");
  availableModels = (data.models || []).map((model) => String(model.id));
  renderUserModelPicker();
}

function renderUsers() {
  const tbody = $("userTable");
  tbody.replaceChildren();
  $("userCount").textContent = `${state.users.length} 个用户`;
  $("usersEmpty").classList.toggle("hidden", state.users.length > 0);
  for (const user of state.users) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.className = "cell-main";
    name.textContent = user.username;
    row.append(name);

    const roleCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "role-badge";
    badge.textContent = user.role === "admin" ? "管理员" : "人工回复员";
    roleCell.append(badge);
    row.append(roleCell);

    const modelsCell = document.createElement("td");
    modelsCell.textContent = user.allowedModels?.length ? user.allowedModels.join(", ") : "全部";
    row.append(modelsCell);

    const created = document.createElement("td");
    created.textContent = formatDate(user.createdAt);
    row.append(created);

    const actions = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "actions";
    const edit = document.createElement("button");
    edit.className = "btn ghost";
    edit.type = "button";
    edit.textContent = "编辑";
    edit.addEventListener("click", () => beginEdit(user));
    wrap.append(edit);
    if (user.username !== operator) {
      const remove = document.createElement("button");
      remove.className = "btn danger";
      remove.type = "button";
      remove.textContent = "删除";
      remove.addEventListener("click", () => deleteUser(user.username));
      wrap.append(remove);
    }
    actions.append(wrap);
    row.append(actions);
    tbody.append(row);
  }
}

async function loadUsers() {
  const data = await api("/op/api/users");
  state.users = Array.isArray(data.users) ? data.users : [];
  renderUsers();
}

async function submitUser(event) {
  event.preventDefault();
  const username = $("newUsername").value.trim().toLowerCase();
  const password = $("newPassword").value;
  const nextRole = $("newRole").value;
  setError("");

  if (!editingUser) {
    const duplicate = state.users.find((user) => user.username === username);
    if (duplicate) {
      beginEdit(duplicate);
      setError("该用户名已存在，已切换为编辑模式；修改后点「保存修改」。");
      return;
    }
  }

  $("userCreateBtn").disabled = true;
  try {
    if (editingUser) {
      const body = {};
      if (password) body.password = password;
      if (editingUser !== operator) body.role = nextRole;
      body.allowedModels = selectedUserModelList();
      if (!Object.keys(body).length) {
        setError("没有需要保存的修改。输入新密码或修改角色后再保存。");
        return;
      }
      const data = await api(`/op/api/users/${encodeURIComponent(editingUser)}`, {
        method: "PATCH",
        body,
      });
      if (!password && data.user && data.user.role === nextRole) {
        setStatus(`已保存 ${editingUser}`);
      } else {
        setStatus(`已更新 ${editingUser}`);
      }
      if (editingUser === operator && password) {
        location.replace("/login");
        return;
      }
      resetForm();
      await loadUsers();
    } else {
      await api("/op/api/users", {
        method: "POST",
        body: { username, password, role: nextRole, allowedModels: selectedUserModelList() },
      });
      setStatus("用户已添加");
      resetForm();
      await loadUsers();
    }
  } catch (error) {
    setError(error.message);
  } finally {
    $("userCreateBtn").disabled = false;
  }
}

async function deleteUser(username) {
  if (!window.confirm(`删除用户 ${username}？该用户现有会话会立即失效。`)) return;
  setError("");
  try {
    await api(`/op/api/users/${encodeURIComponent(username)}`, { method: "DELETE" });
    if (editingUser === username) resetForm();
    setStatus(`已删除 ${username}`);
    await loadUsers();
  } catch (error) {
    setError(error.message);
  }
}

async function init() {
  try {
    await loadMe();
    await loadModels();
    await loadUsers();
    window.NGZRPasswordStrength?.mount($("newPassword"));
    resetForm();
    $("userCreateForm").addEventListener("submit", submitUser);
    $("userCancelBtn").addEventListener("click", resetForm);
    $("logout").addEventListener("click", logout);
  } catch (error) {
    setStatus("加载失败", true);
    setError(error.message);
  }
}

init();
