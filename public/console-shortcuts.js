/** Keyboard shortcut definitions, persistence and editor. */

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

