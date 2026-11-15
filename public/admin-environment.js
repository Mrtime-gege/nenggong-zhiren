const $ = (id) => document.getElementById(id);
let csrf = "";

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf && options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrf;
  const response = await fetch(path, {
    credentials: "same-origin",
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

function setStatus(text, bad = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("err", bad);
}

function row(label, value, title = "") {
  const item = document.createElement("div");
  item.className = "runtime-item";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("code");
  valueEl.textContent = value;
  valueEl.title = title || value;
  item.append(labelEl, valueEl);
  return item;
}

function statusRow(label, available, detail, error = "") {
  const item = document.createElement("div");
  item.className = `vault-row${available ? "" : " missing"}`;
  const head = document.createElement("div");
  head.className = "vault-head";
  const name = document.createElement("span");
  name.textContent = label;
  const state = document.createElement("span");
  state.className = "admin-hint";
  state.textContent = available ? "可用" : "不可用";
  head.append(name, state);
  const meta = document.createElement("div");
  meta.className = "vault-meta";
  const hint = document.createElement("span");
  hint.className = "admin-hint";
  hint.textContent = detail || (available ? "" : error || "未配置");
  meta.append(hint);
  item.append(head, meta);
  return item;
}

function link(label, url) {
  const anchor = document.createElement("a");
  anchor.className = "install-link";
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = label;
  return anchor;
}

function installRow(label, component, info, available, detail = "") {
  const item = document.createElement("div");
  item.className = "vault-row";
  const head = document.createElement("div");
  head.className = "vault-head";
  head.append(Object.assign(document.createElement("span"), { textContent: label }));
  head.append(Object.assign(document.createElement("span"), {
    className: "admin-hint",
    textContent: available ? "已可用" : "未安装",
  }));
  const meta = document.createElement("div");
  meta.className = "vault-meta";
  const command = document.createElement("code");
  command.textContent = info?.command || "";
  meta.append(command);
  const actions = document.createElement("div");
  actions.className = "install-actions";
  const copy = document.createElement("button");
  copy.className = "btn ghost";
  copy.type = "button";
  copy.textContent = "复制命令";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(info?.command || ""); copy.textContent = "已复制"; }
    catch { copy.textContent = "复制失败"; }
    setTimeout(() => { copy.textContent = "复制命令"; }, 1500);
  });
  const install = document.createElement("button");
  install.className = "btn";
  install.type = "button";
  install.textContent = "安装依赖";
  install.disabled = available;
  install.addEventListener("click", () => installComponent(component, label, install));
  actions.append(copy, install);
  if (info?.pypi) actions.append(link("PyPI", info.pypi));
  if (info?.script) actions.append(link("worker 脚本", info.script));
  item.append(head, meta, actions);
  if (detail) {
    const hint = document.createElement("div");
    hint.className = "vault-meta admin-hint";
    hint.textContent = detail;
    item.append(hint);
  }
  return item;
}

async function installComponent(component, label, button) {
  if (!window.confirm(`安装 ${label} 的可选依赖？这会在服务器上运行 pip。`)) return;
  const output = $("installOutput");
  button.disabled = true;
  output.classList.remove("hidden");
  output.textContent = `正在安装 ${label}…`;
  try {
    const data = await api("/op/api/environment/install", {
      method: "POST",
      body: { component, confirm: "INSTALL" },
    });
    output.textContent = `${data.ok ? "安装完成" : "安装失败（退出码 " + data.exitCode + "）"}\n\n${data.stdout || ""}\n${data.stderr || ""}`.trim();
    if (data.ok) await load();
  } catch (error) {
    output.textContent = `安装失败：${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function load() {
  setStatus("探测中…");
  $("refresh").disabled = true;
  try {
    const me = await api("/auth/me");
    csrf = me.csrfToken || "";
    if (me.user) {
      $("userLabel").textContent = `${me.user.username} · ${me.user.role === "admin" ? "管理员" : "人工回复员"}`;
      window.NGZRNAV?.render(me.user.role, me.features);
    }
    const data = await api("/op/api/environment");
    const runtime = data.runtime || {};
    const workers = data.workers || {};
    const features = data.features || {};
    $("runtimeGrid").replaceChildren(
      row("Node", runtime.node || "—"),
      row("平台", `${runtime.platform || "—"} / ${runtime.arch || "—"}`),
      row("SQLite", runtime.sqlite ? "可用" : "不可用"),
      row("检查时间", data.checkedAt ? new Date(data.checkedAt).toLocaleString("zh-CN", { hour12: false }) : "—"),
    );
    const python = workers.python || {};
    const image = workers.image || {};
    const pdf = workers.pdf || {};
    $("workerGrid").replaceChildren(
      row("Python", python.executable || "—", python.error || ""),
      row("图片 worker", image.file || "未配置", image.error || ""),
      row("PDF worker", pdf.file || "未配置", pdf.error || ""),
    );
    $("featureList").replaceChildren(
      statusRow("图片重编码", Boolean(features.imageNormalization), image.file || "", image.error),
      statusRow("PDF 页图预览", Boolean(features.pdfPagePreview), pdf.file || "", pdf.error),
      statusRow("历史索引", Boolean(features.historyIndex), runtime.sqlite ? "SQLite 可用" : "回退内存筛选"),
    );
    const installInfo = data.install || {};
    $("installList").replaceChildren(
      installRow("图片重编码依赖", "pillow", installInfo.image, Boolean(features.imageNormalization), features.imageNormalization ? "" : "需要 Pillow 和 normalize-image.py"),
      installRow("PDF 页图依赖", "pypdfium2", installInfo.pdf, Boolean(features.pdfPagePreview), features.pdfPagePreview ? "" : "需要 pypdfium2 和 render-pdf-page.py"),
    );
    const workerHint = installInfo.workers;
    if (workerHint) {
      const hint = document.createElement("div");
      hint.className = "vault-meta";
      hint.append("worker 脚本地址：", link(workerHint.scripts || "", workerHint.scripts || ""), " ");
      if (workerHint.docs) hint.append(link("部署文档", workerHint.docs));
      $("installList").append(hint);
    }
    $("configHint").textContent = JSON.stringify({
      workers: {
        python: "python3",
        imageWorker: "scripts/normalize-image.py",
        pdfWorker: "scripts/render-pdf-page.py",
        probeTimeoutMs: 2500,
      },
    }, null, 2);
    setStatus("已同步");
  } catch (error) {
    setStatus("探测失败", true);
    $("featureList").replaceChildren(statusRow("环境探测", false, error.message));
  } finally {
    $("refresh").disabled = false;
  }
}

$("refresh").addEventListener("click", load);
$("logout").addEventListener("click", async () => {
  try {
    await fetch("/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": (await api("/auth/me")).csrfToken },
    });
  } finally {
    location.replace("/login");
  }
});
load();
