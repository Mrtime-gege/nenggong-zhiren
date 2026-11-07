/** Static pages, login shell and admin-page authorization. */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export function createPageService({ publicDir, auth, ApiError, sendRaw }) {
  const staticAssetCache = new Map();

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function safeNextPath(value, fallback = "/console") {
    const next = String(value || "").trim();
    if (!next || next.length > 512) return fallback;
    if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
    if (next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
    return next;
  }

  async function loadStaticAsset(entry) {
    const file = path.join(publicDir, entry.file);
    const info = await stat(file);
    const signature = `${info.mtimeMs}:${info.size}`;
    const cached = staticAssetCache.get(entry.file);
    if (cached?.signature === signature) return cached;
    const body = await readFile(file);
    const etag = `"s-${createHash("sha1").update(body).digest("base64url").slice(0, 20)}"`;
    const isCodeAsset = /\.(?:css|js)$/i.test(entry.file);
    const asset = {
      signature,
      body,
      etag,
      cacheControl: isCodeAsset
        ? "public, max-age=0, must-revalidate"
        : "public, max-age=86400, immutable",
    };
    staticAssetCache.set(entry.file, asset);
    return asset;
  }

  async function serveStatic(req, res, entry, extraHeaders = {}) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      throw new ApiError(405, "Method not allowed.", "invalid_request_error", "method_not_allowed");
    }
    try {
      const asset = await loadStaticAsset(entry);
      if (String(req.headers["if-none-match"] || "") === asset.etag) {
        res.writeHead(304, { ETag: asset.etag, "Cache-Control": asset.cacheControl });
        res.end();
        return;
      }
      sendRaw(res, 200, entry.type, req.method === "HEAD" ? "" : asset.body, {
        "Cache-Control": asset.cacheControl,
        ETag: asset.etag,
        "X-Content-Type-Options": "nosniff",
        ...extraHeaders,
      });
    } catch {
      throw new ApiError(404, "Asset not found.", "invalid_request_error", "not_found");
    }
  }

  async function serveLoginPage(res, { status = 200, error = "", next = "/console", retryAfter = null } = {}) {
    let html;
    try {
      html = await readFile(path.join(publicDir, "login.html"), "utf8");
    } catch {
      throw new ApiError(500, "Login page unavailable.", "server_error", "login_page_unavailable");
    }
    html = html
      .replaceAll("{{NEXT}}", escapeHtml(safeNextPath(next)))
      .replaceAll("{{ERROR}}", escapeHtml(error));
    const headers = {};
    if (retryAfter !== null) headers["Retry-After"] = String(retryAfter);
    sendRaw(res, status, "text/html; charset=utf-8", html, headers);
  }

  async function servePage(req, res, filename, fallback) {
    try {
      const body = await readFile(path.join(publicDir, filename));
      sendRaw(res, 200, "text/html; charset=utf-8", req.method === "HEAD" ? "" : body, {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
    } catch {
      throw new ApiError(404, fallback || "Page not found.", "invalid_request_error", "not_found");
    }
  }

  async function serveConsole(req, res) {
    return servePage(req, res, "console.html", "Console not found.");
  }

  async function serveAdminPage(req, res, filename) {
    const session = auth.getSession(req);
    if (!session) {
      res.writeHead(302, { Location: `/login?next=${encodeURIComponent(req.url || "/console")}` });
      res.end();
      return;
    }
    if (session.role !== "admin") {
      res.writeHead(302, { Location: "/console" });
      res.end();
      return;
    }
    return servePage(req, res, filename);
  }

  return { escapeHtml, safeNextPath, serveStatic, serveLoginPage, servePage, serveConsole, serveAdminPage };
}
