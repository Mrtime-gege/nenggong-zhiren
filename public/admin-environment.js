const $ = (id) => document.getElementById(id);

async function api(path) {
  const response = await fetch(path, { credentials: "same-origin" });
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

async function load() {
  setStatus("探测中…");
  $("refresh").disabled = true;
  try {
    const me = await api("/auth/me");
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
