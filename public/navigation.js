/*
 * Shared top navigation registry and admin hub bootstrapper.
 *
 * Top-level pages are intentionally small. Admin pages are grouped into
 * overview / records / management hubs, while the legacy URLs remain available
 * as deep links (and as ?embed=1 frames for the hubs).
 */
(function () {
  const pages = [
    { key: "workbench", label: "坐席", href: "/console" },
    { key: "overview", label: "概览", href: "/console/overview", adminOnly: true },
    { key: "records", label: "记录", href: "/console/records", adminOnly: true },
    { key: "admin", label: "管理", href: "/console/admin", adminOnly: true },
    { key: "settings", label: "设置", href: "/console/settings" },
  ];

  const legacyFor = {
    status: "overview",
    environment: "overview",
    usage: "overview",
    history: "records",
    audit: "records",
    users: "admin",
    models: "admin",
    keys: "admin",
  };

  const hubs = {
    overview: {
      title: "概览",
      tabs: [
        { key: "status", label: "实时状态", href: "/console/status" },
        { key: "usage", label: "用量", href: "/console/usage" },
        { key: "environment", label: "环境", href: "/console/environment" },
      ],
    },
    records: {
      title: "记录",
      tabs: [
        { key: "history", label: "历史票据", href: "/console/history" },
        { key: "audit", label: "审计日志", href: "/console/audit" },
      ],
    },
    admin: {
      title: "管理",
      tabs: [
        { key: "users", label: "用户", href: "/console/users" },
        { key: "models", label: "模型", href: "/console/models" },
        { key: "keys", label: "API 密钥", href: "/console/keys" },
      ],
    },
  };

  function currentPage() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/console/overview") return "overview";
    if (path === "/console/records") return "records";
    if (path === "/console/admin") return "admin";
    if (path === "/console/settings") return "settings";
    if (path === "/console" || path === "") return "workbench";
    const legacy = path.split("/").pop();
    return legacyFor[legacy] || document.body.dataset.page || "workbench";
  }

  function ensureHelpLink() {
    const conn = document.querySelector(".topbar .conn");
    if (!conn || conn.querySelector(".topnav-help")) return;
    const help = document.createElement("a");
    help.className = "topnav-help";
    help.href = "/console/guide";
    help.textContent = "教程";
    help.title = "新手教程";
    const user = conn.querySelector("#userLabel");
    conn.insertBefore(help, user || conn.firstChild);
  }

  function render(role = "", features = {}) {
    const nav = document.getElementById("topnav");
    if (!nav) return;
    const isAdmin = role === "admin";
    nav.replaceChildren();
    for (const page of pages) {
      if (page.adminOnly && !isAdmin) continue;
      const link = document.createElement("a");
      link.className = "topnav-item";
      link.href = page.href;
      link.textContent = page.label;
      link.dataset.menuLevel = "primary";
      if (page.key === currentPage()) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
      }
      nav.append(link);
    }
    ensureHelpLink();
  }

  function installEmbedStyle(frame) {
    try {
      const doc = frame.contentDocument;
      if (!doc) return;
      let style = doc.getElementById("ngzr-embed-style");
      if (!style) {
        style = doc.createElement("style");
        style.id = "ngzr-embed-style";
        doc.head.append(style);
      }
      style.textContent = `
        .topbar { display: none !important; }
        .admin-main, .status-main { padding-top: 18px !important; }
        body { min-height: 100vh; }
      `;
      doc.documentElement.classList.add("ngzr-embedded");
    } catch {
      /* same-origin pages should be reachable */
    }
  }

  function selectedTab(spec) {
    const requested = new URLSearchParams(location.search).get("tab");
    return spec.tabs.find((tab) => tab.key === requested) || spec.tabs[0];
  }

  function frameUrl(tab) {
    const url = new URL(tab.href, location.origin);
    for (const [key, value] of new URLSearchParams(location.search)) {
      if (key !== "tab" && key !== "embed") url.searchParams.set(key, value);
    }
    url.searchParams.set("embed", "1");
    return url.toString();
  }

  function initHub(features = {}) {
    const hub = document.querySelector("[data-hub]");
    if (!hub) return;
    const spec = hubs[currentPage()];
    if (!spec) return;
    spec.tabs = spec.tabs.filter((tab) => {
      if (tab.key === "usage" && features.usageDashboard === false) return false;
      if (tab.key === "audit" && features.auditLog === false) return false;
      return true;
    });
    if (!spec.tabs.length) return;
    const title = document.getElementById("hubTitle");
    if (title) title.textContent = spec.title;
    const host = document.getElementById("hubFrames");
    const tabbar = document.getElementById("hubTabs");
    const initialFrame = document.getElementById("hubFrame");
    if (!host || !tabbar || !initialFrame) return;
    const frames = new Map();
    const initial = selectedTab(spec);

    function ensureFrame(tab, { preload = false } = {}) {
      let frame = frames.get(tab.key);
      if (frame) return frame;
      if (!frames.size) {
        frame = initialFrame;
        frame.title = tab.label;
      } else {
        frame = document.createElement("iframe");
        frame.className = "hub-frame";
        frame.title = tab.label;
        frame.hidden = true;
        host.append(frame);
      }
      frame.dataset.hubTab = tab.key;
      frame.addEventListener("load", () => installEmbedStyle(frame));
      frames.set(tab.key, frame);
      frame.src = frameUrl(tab);
      if (preload) frame.hidden = true;
      return frame;
    }

    function activate(tab) {
      for (const item of document.querySelectorAll(".hub-tab")) {
        const active = item.dataset.tab === tab.key;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      }
      for (const frame of frames.values()) frame.hidden = true;
      const frame = ensureFrame(tab);
      frame.hidden = false;
      const url = new URL(location.href);
      url.searchParams.set("tab", tab.key);
      history.replaceState({}, "", url);
    }

    tabbar.replaceChildren();
    for (const tab of spec.tabs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hub-tab";
      button.dataset.tab = tab.key;
      button.textContent = tab.label;
      button.setAttribute("aria-selected", "false");
      button.addEventListener("click", () => activate(tab));
      const preloadOnIntent = () => ensureFrame(tab, { preload: true });
      button.addEventListener("pointerenter", preloadOnIntent);
      button.addEventListener("focus", preloadOnIntent);
      tabbar.append(button);
    }

    activate(initial);
    // Preload only the adjacent tab after the first screen settles. Hovering or
    // focusing a tab preloads that specific page immediately; the environment
    // page is intentionally not preloaded automatically because it probes
    // external workers and can be expensive.
    const currentIndex = spec.tabs.indexOf(initial);
    const adjacent = spec.tabs[currentIndex + 1] || spec.tabs[currentIndex - 1];
    const preloadAdjacent = () => {
      if (!adjacent || adjacent.key === "environment" || frames.has(adjacent.key)) return;
      ensureFrame(adjacent, { preload: true });
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(preloadAdjacent, { timeout: 1500 });
    else setTimeout(preloadAdjacent, 500);
  }

  async function bootHub() {
    if (!document.querySelector("[data-hub]")) return;
    try {
      const response = await fetch("/auth/me", { credentials: "same-origin" });
      if (response.status === 401) {
        location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        return;
      }
      if (!response.ok) throw new Error("加载失败");
      const me = await response.json();
      render(me.user?.role || "", me.features || {});
      const user = document.getElementById("userLabel");
      if (user) user.textContent = `${me.user?.username || ""} · ${me.user?.role === "admin" ? "管理员" : "人工回复员"}`;
      const logout = document.getElementById("logout");
      if (logout) {
        logout.addEventListener("click", async () => {
          const csrf = me.csrfToken;
          await fetch("/auth/logout", {
            method: "POST",
            headers: { "X-CSRF-Token": csrf, Origin: location.origin },
            credentials: "same-origin",
          });
          location.href = "/login";
        });
      }
      initHub(me.features || {});
    } catch {
      const status = document.getElementById("status");
      if (status) status.textContent = "连接失败";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootHub);
  else bootHub();

  window.NGZRNAV = { pages, hubs, render, currentPage, initHub };
})();
