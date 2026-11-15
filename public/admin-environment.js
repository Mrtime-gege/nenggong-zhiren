const $ = (id) => document.getElementById(id);
let csrf = "";
let probe = null;
let busy = false;

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

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function link(label, url) {
  const anchor = el("a", "optional-link", label);
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function setStatus(text, bad = false) {
  const node = $("status");
  node.textContent = text;
  node.classList.toggle("err", bad);
}

function setOutput(text) {
  const output = $("installOutput");
  output.classList.remove("hidden");
  output.textContent = text;
}

function clearOutput() {
  const output = $("installOutput");
  output.textContent = "";
  output.classList.add("hidden");
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "已复制";
  } catch {
    button.textContent = "复制失败";
  }
  setTimeout(() => { button.textContent = "复制"; }, 1500);
}

function row(label, value, title = "") {
  const item = el("div", "runtime-item");
  const labelEl = el("span", "", label);
  const valueEl = el("code", "", value);
  valueEl.title = title || value;
  item.append(labelEl, valueEl);
  return item;
}

function badge(tone, label) {
  return el("span", `optional-badge ${tone}`, label);
}

function capabilityState(worker, featureAvailable, python) {
  if (!python.available) return { tone: "error", label: "Python 不可用" };
  if (!worker.configured) return { tone: "muted", label: "未配置脚本" };
  if (!worker.exists) return { tone: "warn", label: "脚本不存在" };
  if (!worker.dependencyAvailable) return { tone: "warn", label: `缺少 ${worker.dependency}` };
  if (!featureAvailable) return { tone: "warn", label: "不可用" };
  return { tone: "ok", label: "可用" };
}

function detail(label, value, tone = "") {
  const line = el("div", "optional-detail");
  line.append(el("span", "optional-detail-label", label), el("code", `optional-detail-value ${tone}`.trim(), value));
  return line;
}

function commandLine(label, command, onCopy) {
  const line = el("div", "optional-command");
  line.append(el("span", "optional-command-label", label));
  const code = el("code", "", command);
  const copy = el("button", "btn ghost optional-copy", "复制");
  copy.type = "button";
  copy.addEventListener("click", () => onCopy(command, copy));
  line.append(code, copy);
  return line;
}

function capabilityCard({ title, description, component, info, worker, featureAvailable, python }) {
  const state = capabilityState(worker, featureAvailable, python);
  const card = el("article", `optional-capability ${state.tone}`);
  const head = el("div", "optional-capability-head");
  head.append(el("h3", "", title), badge(state.tone, state.label));
  card.append(head, el("p", "optional-capability-desc", description));

  const details = el("div", "optional-details");
  const dependency = worker.dependency || "—";
  const dependencyVersion = worker.dependencyVersion ? ` ${worker.dependencyVersion}` : "";
  details.append(
    detail("Python", python.available ? (python.version || "可用") : "不可用", python.available ? "" : "error"),
    detail("依赖", worker.dependencyAvailable ? `${dependency}${dependencyVersion}` : `${dependency} 未安装`, worker.dependencyAvailable ? "" : "warn"),
    detail("worker", worker.exists ? worker.file : (worker.file || "未配置"), worker.exists ? "" : "warn"),
  );
  card.append(details);

  if (worker.error || (python.error && !python.available)) {
    card.append(el("p", "optional-error", worker.error || python.error));
  }

  if (info && component) {
    card.append(commandLine("安装", info.command || "", copyText));
    card.append(commandLine("卸载", info.uninstallCommand || "", copyText));

    const actions = el("div", "optional-actions");
    const install = el("button", "btn", featureAvailable ? "重新安装" : "安装依赖");
    install.type = "button";
    install.disabled = busy || !python.available;
    install.addEventListener("click", () => runPip("install", component, title));
    const uninstall = el("button", "btn ghost", "卸载依赖");
    uninstall.type = "button";
    uninstall.disabled = busy || !worker.dependencyAvailable;
    uninstall.title = worker.dependencyAvailable ? `卸载 ${dependency}` : "当前环境未检测到该依赖";
    uninstall.addEventListener("click", () => runPip("uninstall", component, title));
    actions.append(install, uninstall);
    if (info.pypi) actions.append(link("PyPI 页面", info.pypi));
    if (info.script) actions.append(link("worker 脚本", info.script));
    card.append(actions);
  }

  return card;
}

function historyCard(runtime, available) {
  const card = el("article", `optional-capability ${available ? "ok" : "warn"}`);
  const head = el("div", "optional-capability-head");
  head.append(el("h3", "", "历史索引"), badge(available ? "ok" : "warn", available ? "可用" : "回退模式"));
  card.append(head, el("p", "optional-capability-desc", "使用 Node 内置 SQLite 与 FTS5 提供历史检索和 CSV；不可用时回退到内存筛选，不需要安装额外依赖。"));
  const details = el("div", "optional-details");
  details.append(
    detail("Node", runtime.node || "—"),
    detail("SQLite", available ? "可用" : "不可用", available ? "" : "warn"),
    detail("数据位置", "history.db"),
  );
  card.append(details);
  return card;
}

function renderOptional(data) {
  const runtime = data.runtime || {};
  const workers = data.workers || {};
  const features = data.features || {};
  const install = data.install || {};
  const python = workers.python || {};
  const image = workers.image || {};
  const pdf = workers.pdf || {};
  const availableCount = [features.imageNormalization, features.pdfPagePreview, features.historyIndex].filter(Boolean).length;
  const summary = $("optionalSummary");
  summary.textContent = `${availableCount}/3 可用${python.available ? ` · ${python.executable || "python"}` : " · Python 不可用"}`;
  summary.classList.toggle("err", availableCount === 0);

  $("optionalGrid").replaceChildren(
    capabilityCard({
      title: "图片重编码",
      description: "上传前用 Pillow 重编码图片并剥离 EXIF，降低图片解析风险。",
      component: "pillow",
      info: install.image,
      worker: image,
      featureAvailable: Boolean(features.imageNormalization),
      python,
    }),
    capabilityCard({
      title: "PDF 页图预览",
      description: "按需把 PDF 单页渲染为图片，供工作台预览；文字抽取和下载不受影响。",
      component: "pypdfium2",
      info: install.pdf,
      worker: pdf,
      featureAvailable: Boolean(features.pdfPagePreview),
      python,
    }),
    historyCard(runtime, Boolean(features.historyIndex)),
  );

  const links = $("workerLinks");
  links.replaceChildren();
  if (install.workers) {
    links.append(
      el("span", "", "worker 脚本："),
      link("GitHub scripts", install.workers.scripts || ""),
      el("span", "", " · "),
      link("部署文档", install.workers.docs || ""),
      el("span", "", " · 脚本不随发布包提供，下载后放到 config.jsonc 的 workers 路径。"),
    );
  }
}

async function runPip(action, component, label) {
  if (busy) return;
  const info = probe?.install?.[component === "pillow" ? "image" : "pdf"] || {};
  const command = action === "install" ? info.command : info.uninstallCommand;
  const verb = action === "install" ? "安装" : "卸载";
  const warning = action === "install"
    ? `安装 ${label} 的可选依赖？这会在服务器上运行 pip。`
    : `从服务账号的 Python 环境卸载 ${label}？其他依赖它的程序可能受影响。`;
  if (!window.confirm(warning)) return;
  busy = true;
  setStatus(`${verb}中…`);
  setOutput(`$ ${command || ""}\n\n正在${verb} ${label}…`);
  try {
    const data = await api(`/op/api/environment/${action}`, {
      method: "POST",
      body: { component, confirm: action === "install" ? "INSTALL" : "UNINSTALL" },
    });
    setOutput([
      data.ok ? `${verb}完成` : `${verb}失败（退出码 ${data.exitCode}）`,
      "",
      `$ ${command || ""}`,
      data.stdout || "",
      data.stderr || "",
    ].join("\n").trim());
    busy = false;
    await load();
    setStatus(data.ok ? "已同步" : `${verb}失败`, !data.ok);
  } catch (error) {
    setOutput(`${verb}失败：${error.message}`);
    setStatus(`${verb}失败`, true);
  } finally {
    busy = false;
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
    probe = data;
    const runtime = data.runtime || {};
    $("runtimeGrid").replaceChildren(
      row("Node", runtime.node || "—"),
      row("平台", `${runtime.platform || "—"} / ${runtime.arch || "—"}`),
      row("SQLite", runtime.sqlite ? "可用" : "不可用"),
      row("检查时间", data.checkedAt ? new Date(data.checkedAt).toLocaleString("zh-CN", { hour12: false }) : "—"),
    );
    renderOptional(data);
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
    $("optionalSummary").textContent = "探测失败";
    $("optionalSummary").classList.add("err");
    $("optionalGrid").replaceChildren(el("p", "optional-error", error.message));
  } finally {
    $("refresh").disabled = false;
  }
}

$("refresh").addEventListener("click", load);
$("clearOutput").addEventListener("click", clearOutput);
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
