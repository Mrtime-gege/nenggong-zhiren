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

/** Parse an IPv6 address into a 128-bit BigInt, or null. */
function ipv6ToBigInt(address) {
  let text = String(address || "").toLowerCase();
  if (text.includes("%")) text = text.slice(0, text.indexOf("%"));
  if (!net.isIPv6(text)) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const parseGroups = (groups) => {
    const output = [];
    for (const group of groups) {
      if (group.includes(".")) {
        const parts = group.split(".").map(Number);
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
        output.push((parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
        output.push(parseInt(group, 16));
      }
    }
    return output;
  };
  const head = parseGroups(left);
  const tail = parseGroups(right);
  if (!head || !tail) return null;
  const total = head.length + tail.length;
  if (total > 8 || (halves.length === 1 && total !== 8) || (halves.length === 2 && total > 7)) return null;
  const groups = [...head, ...Array(8 - total).fill(0), ...tail];
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

function inPrefix(value, base, bits) {
  const shift = BigInt(128 - bits);
  const prefix = ipv6ToBigInt(base);
  return prefix !== null && (value >> shift) === (prefix >> shift);
}

function ipv4FromBigInt(value) {
  return [Number((value >> 24n) & 255n), Number((value >> 16n) & 255n), Number((value >> 8n) & 255n), Number(value & 255n)].join(".");
}

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
    if (a === 192 && b === 88 && c === 99) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const number = ipv6ToBigInt(value);
    if (number === null) return true;
    if (number === 0n || number === 1n) return true;
    if (inPrefix(number, "fe80::", 10)) return true;
    if (inPrefix(number, "fec0::", 10)) return true;
    if (inPrefix(number, "fc00::", 7)) return true;
    if (inPrefix(number, "ff00::", 8)) return true;
    if (inPrefix(number, "::", 96)) return true;
    // IPv4-mapped (::ffff:0:0/96) and IPv4-translated (::ffff:0:0:0/96)
    // address forms carry an IPv4 address in the low 32 bits.
    const upper96 = number >> 32n;
    if (upper96 === 0xffffn || upper96 === 0xffff0000n) {
      return isPrivateAddress(ipv4FromBigInt(number & 0xffffffffn));
    }
    if (inPrefix(number, "64:ff9b::", 96)) return true;
    if (inPrefix(number, "64:ff9b:1::", 48)) return true;
    if (inPrefix(number, "100::", 64)) return true;
    if (inPrefix(number, "2001:2::", 48)) return true;
    if (inPrefix(number, "2001:10::", 28)) return true;
    if (inPrefix(number, "2001:db8::", 32)) return true;
    if (inPrefix(number, "2002::", 16)) {
      return isPrivateAddress(ipv4FromBigInt((number >> 80n) & 0xffffffffn));
    }
    return false;
  }
  return true;
}

const ALLOWED_PORTS = new Set([80, 443]);

function effectivePort(url) {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
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
  const portAllowed = ALLOWED_PORTS.has(effectivePort(url));
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) throw new SafeFetchError("图片地址缺少主机名。", "invalid_image_url");
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new SafeFetchError("不允许访问内网地址。", "private_image_host", 403);
    }
    if (!portAllowed) {
      throw new SafeFetchError("图片地址只允许 80 或 443 端口。", "image_port_not_allowed", 403);
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
  if (!portAllowed) {
    throw new SafeFetchError("图片地址只允许 80 或 443 端口。", "image_port_not_allowed", 403);
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
    let request = null;
    const cleanup = () => {
      clearTimeout(deadline);
      clearTimeout(idle);
      if (request) request.destroy();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(idle);
      resolve(result);
    };
    // Absolute deadline: a trickling upstream must not hold a proxy slot forever.
    const deadline = setTimeout(() => {
      fail(new SafeFetchError("图片源响应超时。", "image_timeout", 504));
    }, timeoutMs);
    deadline.unref?.();
    let idle = null;
    try {
      request = client.request({
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          "User-Agent": "nenggong-zhiren-image-proxy",
          Accept: "image/png,image/jpeg,image/gif,image/webp;q=0.9,*/*;q=0.1",
        },
        servername: net.isIP(hostname) ? undefined : hostname,
        lookup: (_host, _options, callback) => callback(null, pinned, family),
      }, (response) => {
        const status = Number(response.statusCode) || 0;
        const rejectUpstream = (error) => {
          response.destroy();
          fail(error);
        };
        if (status >= 300 && status < 400) return rejectUpstream(new SafeFetchError("图片地址不允许重定向。", "image_redirect", 502));
        if (status < 200 || status >= 300) return rejectUpstream(new SafeFetchError("图片源返回了错误状态。", "image_upstream_status", 502));
        const type = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        const mime = IMAGE_TYPES.get(type);
        if (!mime) return rejectUpstream(new SafeFetchError("图片源返回的不是支持的图片类型。", "image_unsupported_type", 415));
        const declared = Number(response.headers["content-length"] || 0);
        if (declared > maxBytes) return rejectUpstream(new SafeFetchError("图片超过大小限制。", "image_too_large", 413));
        const chunks = [];
        let total = 0;
        idle = setTimeout(() => rejectUpstream(new SafeFetchError("图片源响应超时。", "image_timeout", 504)), timeoutMs);
        idle.unref?.();
        response.on("data", (chunk) => {
          if (settled) return;
          total += chunk.length;
          if (total > maxBytes) {
            rejectUpstream(new SafeFetchError("图片超过大小限制。", "image_too_large", 413));
            return;
          }
          chunks.push(chunk);
          if (idle) idle.refresh();
        });
        response.on("end", () => {
          if (settled) return;
          succeed({ buffer: Buffer.concat(chunks), mime });
        });
        response.on("error", (error) => fail(new SafeFetchError(`图片读取失败：${error.message}`, "image_read_failed", 502)));
      });
    } catch (error) {
      fail(new SafeFetchError(`图片请求失败：${error.message}`, "image_fetch_failed", 502));
      return;
    }
    request.on("error", (error) => fail(new SafeFetchError(`图片请求失败：${error.message}`, "image_fetch_failed", 502)));
    request.end();
  });
}
