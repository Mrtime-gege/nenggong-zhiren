/** Fetch caller-supplied images safely: public http(s) only, no redirects. */

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class SafeFetchError extends Error {
  constructor(message, code = "unsafe_url", status = 400) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    this.status = status;
  }
}

const IMAGE_TYPES = new Map([
  ["image/png", "image/png"],
  ["image/jpeg", "image/jpeg"],
  ["image/jpg", "image/jpeg"],
  ["image/gif", "image/gif"],
  ["image/webp", "image/webp"],
]);

/** True for loopback, private, link-local, CGNAT, multicast and reserved ranges. */
export function isPrivateAddress(address) {
  const value = String(address || "");
  const version = net.isIP(value);
  if (version === 4) {
    const parts = value.split(".").map(Number);
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const lower = value.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("ff")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (mappedHex) {
      const high = parseInt(mappedHex[1], 16);
      const low = parseInt(mappedHex[2], 16);
      return isPrivateAddress([high >> 8, high & 255, low >> 8, low & 255].join("."));
    }
    return false;
  }
  return true;
}

export async function resolvePublicImageUrl(raw, { lookup = dns.promises.lookup } = {}) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    throw new SafeFetchError("图片地址格式不正确。", "invalid_image_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("只允许 http/https 图片地址。", "invalid_image_scheme");
  }
  if (url.username || url.password) {
    throw new SafeFetchError("图片地址不能包含用户名或密码。", "invalid_image_url");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) throw new SafeFetchError("图片地址缺少主机名。", "invalid_image_url");
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new SafeFetchError("不允许访问内网地址。", "private_image_host", 403);
    }
    return { url, addresses: [hostname] };
  }
  let resolved;
  try {
    resolved = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SafeFetchError("图片域名无法解析。", "image_dns_failed", 502);
  }
  const addresses = (Array.isArray(resolved) ? resolved : [resolved])
    .map((entry) => (typeof entry === "string" ? entry : entry?.address))
    .filter(Boolean);
  if (!addresses.length) throw new SafeFetchError("图片域名无法解析。", "image_dns_failed", 502);
  if (addresses.some((address) => isPrivateAddress(address))) {
    throw new SafeFetchError("不允许访问内网地址。", "private_image_host", 403);
  }
  return { url, addresses };
}

export function fetchRemoteImage({ url, addresses }, {
  maxBytes = 5 * 1024 * 1024,
  timeoutMs = 8000,
} = {}) {
  return new Promise((resolve, reject) => {
    const pinned = addresses[0];
    const family = net.isIP(pinned) || 4;
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const client = url.protocol === "https:" ? https : http;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = client.request({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        "User-Agent": "nenggong-zhiren-image-proxy",
        Accept: "image/png,image/jpeg,image/gif,image/webp;q=0.9,*/*;q=0.1",
      },
      timeout: timeoutMs,
      servername: net.isIP(hostname) ? undefined : hostname,
      lookup: (_host, _options, callback) => callback(null, pinned, family),
    }, (response) => {
      const status = Number(response.statusCode) || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        return fail(new SafeFetchError("图片地址不允许重定向。", "image_redirect", 502));
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return fail(new SafeFetchError("图片源返回了错误状态。", "image_upstream_status", 502));
      }
      const type = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const mime = IMAGE_TYPES.get(type);
      if (!mime) {
        response.resume();
        return fail(new SafeFetchError("图片源返回的不是支持的图片类型。", "image_unsupported_type", 415));
      }
      const declared = Number(response.headers["content-length"] || 0);
      if (declared > maxBytes) {
        response.resume();
        return fail(new SafeFetchError("图片超过大小限制。", "image_too_large", 413));
      }
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy();
          return fail(new SafeFetchError("图片超过大小限制。", "image_too_large", 413));
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({ buffer: Buffer.concat(chunks), mime });
      });
      response.on("error", (error) => fail(new SafeFetchError(`图片读取失败：${error.message}`, "image_read_failed", 502)));
    });
    request.on("timeout", () => {
      request.destroy();
      fail(new SafeFetchError("图片源响应超时。", "image_timeout", 504));
    });
    request.on("error", (error) => fail(new SafeFetchError(`图片请求失败：${error.message}`, "image_fetch_failed", 502)));
    request.end();
  });
}
