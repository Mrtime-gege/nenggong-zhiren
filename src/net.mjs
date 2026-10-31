/** Client-IP resolution with an explicit trusted-proxy boundary. */

import net from "node:net";

function normalize(value) {
  return String(value || "").trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
}

function ipv4Parts(value) {
  const parts = String(value).split(".").map((part) => Number(part));
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function ipv4InCidr(ip, cidr) {
  const [base, bitsText] = String(cidr).split("/");
  const bits = Number(bitsText);
  const baseParts = ipv4Parts(base);
  const ipParts = ipv4Parts(ip);
  if (!baseParts || !ipParts || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const baseNumber = baseParts.reduce((sum, part) => (sum << 8) + part, 0) >>> 0;
  const ipNumber = ipParts.reduce((sum, part) => (sum << 8) + part, 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (baseNumber & mask) >>> 0 === (ipNumber & mask) >>> 0;
}

export function isTrustedProxy(ip, proxies) {
  const value = normalize(ip);
  for (const proxy of proxies || []) {
    const candidate = normalize(proxy);
    if (!candidate) continue;
    if (candidate === value) return true;
    if (candidate.includes("/") && net.isIP(value) === 4) return ipv4InCidr(value, candidate);
  }
  return false;
}

function validForwardedIp(value) {
  const candidate = normalize(String(value || "").split(",")[0]);
  if (!candidate) return "";
  return net.isIP(candidate) ? candidate : "";
}

/** Remote address is authoritative unless it is an explicitly trusted proxy. */
export function resolveClientIp(req, trustedProxies = []) {
  const remote = normalize(req?.socket?.remoteAddress || "") || "unknown";
  if (!trustedProxies?.length || !isTrustedProxy(remote, trustedProxies)) return remote;
  const forwarded = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")
    .map((part) => normalize(part))
    .filter((part) => net.isIP(part));
  // Walk from the proxy edge inward and return the first untrusted address.
  for (let index = forwarded.length - 1; index >= 0; index -= 1) {
    const candidate = forwarded[index];
    if (!isTrustedProxy(candidate, trustedProxies)) return candidate;
  }
  return validForwardedIp(req.headers?.["x-real-ip"]) || remote;
}
