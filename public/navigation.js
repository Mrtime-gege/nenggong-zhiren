/*
 * Shared top navigation registry.
 *
 * To add a page later:
 *   1. add one entry below;
 *   2. create a page with <body data-page="your-key">;
 *   3. add its server route/static file.
 *
 * The workbench is available to every logged-in user; adminOnly pages are
 * hidden until /auth/me confirms the admin role.
 */
(function () {
  const pages = [
    { key: "status", label: "状态", href: "/console/status", adminOnly: true },
    { key: "workbench", label: "坐席", href: "/console" },
    { key: "guide", label: "教程", href: "/console/guide" },
    { key: "users", label: "用户管理", href: "/console/users", adminOnly: true },
    { key: "models", label: "模型", href: "/console/models", adminOnly: true },
    { key: "keys", label: "API 密钥", href: "/console/keys", adminOnly: true },
    { key: "usage", label: "用量", href: "/console/usage", adminOnly: true, feature: "usageDashboard" },
    { key: "history", label: "历史", href: "/console/history", adminOnly: true },
    { key: "audit", label: "审计", href: "/console/audit", adminOnly: true },
    { key: "settings", label: "设置", href: "/console/settings" },
    // Add future pages here. Example:
    // { key: "team", label: "团队", href: "/console/team", adminOnly: true },
  ];

  function activePage() {
    return document.body.dataset.page || "workbench";
  }

  function render(role = "", features = {}) {
    const nav = document.getElementById("topnav");
    if (!nav) return;
    const isAdmin = role === "admin";
    nav.replaceChildren();
    for (const page of pages) {
      if (page.adminOnly && !isAdmin) continue;
      if (page.feature && features[page.feature] === false) continue;
      const link = document.createElement("a");
      link.className = "topnav-item";
      link.href = page.href;
      link.textContent = page.label;
      if (page.key === activePage()) link.classList.add("active");
      nav.append(link);
    }
  }

  window.NGZRNAV = { pages, render };
})();
