/**
 * 能工智人 · account, session and login-throttle service.
 *
 * No external dependencies. Users live in usersFile (default: users.json); passwords are
 * stored as salted scrypt hashes and never returned. Sessions are in-memory,
 * single-process and intentionally expire.
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { verifyTotp } from "./totp.mjs";
import { normalizeUserFeatures } from "./features.mjs";

const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
const ROLES = new Set(["admin", "operator"]);
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;
const SCRYPT_OPTIONS = Object.freeze({ N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const HASH_BYTES = 64;
const DEFAULT_PREFERENCES = Object.freeze({
  browserNotifications: true,
  notificationSound: true,
  autoClaimDefault: false,
  autoAiOnClaim: false,
  queueAlertSeconds: 120,
});

function normalizePreferences(raw, fallback = DEFAULT_PREFERENCES) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const bool = (key) => (typeof source[key] === "boolean" ? source[key] : fallback[key]);
  const queueAlertSeconds = Number(source.queueAlertSeconds ?? fallback.queueAlertSeconds);
  return {
    browserNotifications: bool("browserNotifications"),
    notificationSound: bool("notificationSound"),
    autoClaimDefault: bool("autoClaimDefault"),
    autoAiOnClaim: bool("autoAiOnClaim"),
    queueAlertSeconds:
      Number.isInteger(queueAlertSeconds) && queueAlertSeconds >= 10 && queueAlertSeconds <= 86_400
        ? queueAlertSeconds
        : fallback.queueAlertSeconds,
  };
}


export class AuthError extends Error {
  constructor(message, code = "auth_error", status = 400) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeUsername(value) {
  const username = String(value ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new AuthError(
      "用户名需为 3–32 位小写字母、数字、下划线、点或连字符，且以字母/数字开头。",
      "invalid_username",
    );
  }
  return username;
}

function normalizeAllowedModels(raw) {
  if (raw === undefined || raw === null || raw === "") return [];
  if (!Array.isArray(raw)) throw new AuthError("允许模型必须是字符串数组。", "invalid_allowed_models");
  return [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))].slice(0, 64);
}

export function assertPassword(value) {
  const password = String(value ?? "");
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new AuthError(`密码长度需为 ${PASSWORD_MIN}–${PASSWORD_MAX} 位。`, "invalid_password");
  }
  return password;
}

function hashPassword(password, saltHex) {
  return scryptSync(password, Buffer.from(saltHex, "hex"), HASH_BYTES, SCRYPT_OPTIONS);
}

function passwordMatches(password, user) {
  const expected = Buffer.from(user.hash, "hex");
  const actual = hashPassword(password, user.salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies.set(name, value);
  }
  return cookies;
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

export class AuthService {
  constructor({
    dataDir,
    usersFile,
    sessionTtlMs = 12 * 60 * 60_000,
    sessionIdleMs = 2 * 60 * 60_000,
    loginRateWindowMs = 5 * 60_000,
    loginIpMaxFailures = 10,
    loginUserMaxFailures = 5,
    secureCookies = false,
    cookieName = "ngzr_session",
    logger = console,
    now = Date.now,
  } = {}) {
    if (!dataDir && !usersFile) throw new Error("AuthService needs dataDir or usersFile");
    this.dataDir = dataDir ? path.resolve(dataDir) : path.dirname(path.resolve(usersFile));
    this.usersFile = usersFile ? path.resolve(usersFile) : path.join(this.dataDir, "users.json");
    this.manageDataDir = Boolean(dataDir);
    this.sessionTtlMs = sessionTtlMs;
    this.sessionIdleMs = sessionIdleMs;
    this.loginRateWindowMs = loginRateWindowMs;
    this.loginIpMaxFailures = loginIpMaxFailures;
    this.loginUserMaxFailures = loginUserMaxFailures;
    this.secureCookies = secureCookies;
    this.cookieName = cookieName;
    this.logger = logger;
    this.now = now;
    this.users = new Map();
    this.sessions = new Map();
    this.loginFailures = new Map();
    this.cleanupTimer = null;
    this.watchHandler = null;
    this.dummy = (() => {
      const salt = randomBytes(16).toString("hex");
      const hash = hashPassword(`dummy-${randomBytes(16).toString("hex")}`, salt).toString("hex");
      return { salt, hash };
    })();
  }

  init() {
    if (this.manageDataDir) {
      fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
      try {
        fs.chmodSync(this.dataDir, 0o700);
      } catch {
        /* non-POSIX or not owner: no fatal */
      }
    } else {
      fs.mkdirSync(path.dirname(this.usersFile), { recursive: true });
    }
    this.loadUsers();
    this.startCleanup();
    this.watchUsers();
    return this;
  }

  watchUsers() {
    if (this.watchHandler) return;
    this.watchHandler = (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
      try {
        this.loadUsers();
        this.reconcileSessions();
        this.logger.log?.("[auth] users file changed; accounts reloaded");
      } catch (error) {
        this.logger.error?.(`[auth] users file reload failed: ${error.message}`);
      }
    };
    fs.watchFile(this.usersFile, { interval: 500 }, this.watchHandler);
  }

  destroyAllSessions() {
    this.sessions.clear();
  }

  reconcileSessions() {
    for (const [token, session] of this.sessions) {
      const user = this.users.get(session.username);
      if (!user || user.role !== session.role || user.hash !== session.passwordHash) {
        this.sessions.delete(token);
      }
    }
  }

  startCleanup() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = this.now();
      for (const [token, session] of this.sessions) {
        if (session.expiresAt <= now || now - session.lastSeen > this.sessionIdleMs) {
          this.sessions.delete(token);
        }
      }
      for (const [key, entry] of this.loginFailures) {
        entry.failures = entry.failures.filter((at) => now - at < this.loginRateWindowMs);
        if (entry.failures.length === 0) this.loginFailures.delete(key);
      }
    }, 60_000);
    this.cleanupTimer.unref?.();
  }

  loadUsers() {
    if (!fs.existsSync(this.usersFile)) {
      this.users = new Map();
      this.persistUsers();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.usersFile, "utf8"));
      fs.chmodSync(this.usersFile, 0o600);
    } catch (error) {
      throw new Error(`无法读取用户文件 ${this.usersFile}: ${error.message}`);
    }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.users)) {
      throw new Error(`用户文件格式不正确: ${this.usersFile}`);
    }
    this.users = new Map();
    for (const raw of parsed.users) {
      const username = normalizeUsername(raw.username);
      if (!ROLES.has(raw.role)) continue;
      if (typeof raw.salt !== "string" || typeof raw.hash !== "string") continue;
      this.users.set(username, {
        username,
        role: raw.role,
        salt: raw.salt,
        hash: raw.hash,
        createdAt: Number(raw.createdAt) || this.now(),
        allowedModels: normalizeAllowedModels(raw.allowedModels || []),
        features: normalizeUserFeatures(raw.features),
        preferences: normalizePreferences(raw.preferences),
        totpSecret: typeof raw.totpSecret === "string" ? raw.totpSecret : "",
        mfaEnabled: raw.mfaEnabled === true && typeof raw.totpSecret === "string" && raw.totpSecret.length > 0,
      });
    }
  }

  persistUsers() {
    fs.mkdirSync(path.dirname(this.usersFile), { recursive: true });
    const payload = {
      version: 1,
      users: [...this.users.values()].map((user) => ({
        username: user.username,
        role: user.role,
        salt: user.salt,
        hash: user.hash,
        createdAt: user.createdAt,
        allowedModels: user.allowedModels || [],
        features: normalizeUserFeatures(user.features),
        preferences: normalizePreferences(user.preferences),
        totpSecret: user.totpSecret || undefined,
        mfaEnabled: user.mfaEnabled === true,
      })),
    };
    const tmp = path.join(
      path.dirname(this.usersFile),
      `.users.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`,
    );
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.usersFile);
    fs.chmodSync(this.usersFile, 0o600);
  }

  listUsers() {
    return [...this.users.values()]
      .map(({ username, role, createdAt, allowedModels, features, mfaEnabled }) => ({
        username,
        role,
        createdAt,
        allowedModels: [...(allowedModels || [])],
        features: normalizeUserFeatures(features),
        mfaEnabled: mfaEnabled === true,
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  mfaEnabled(username) {
    const user = this.users.get(normalizeUsername(username));
    return Boolean(user?.mfaEnabled && user.totpSecret);
  }

  setMfaSecret(username, secret) {
    const normalized = normalizeUsername(username);
    const user = this.users.get(normalized);
    if (!user) throw new AuthError("用户不存在。", "user_not_found", 404);
    user.totpSecret = String(secret || "");
    user.mfaEnabled = false;
    this.users.set(normalized, user);
    this.persistUsers();
  }

  enableMfa(username) {
    const normalized = normalizeUsername(username);
    const user = this.users.get(normalized);
    if (!user || !user.totpSecret) throw new AuthError("请先生成 MFA 密钥。", "mfa_not_setup");
    user.mfaEnabled = true;
    this.users.set(normalized, user);
    this.persistUsers();
  }

  disableMfa(username) {
    const normalized = normalizeUsername(username);
    const user = this.users.get(normalized);
    if (!user) throw new AuthError("用户不存在。", "user_not_found", 404);
    user.mfaEnabled = false;
    user.totpSecret = "";
    this.users.set(normalized, user);
    this.persistUsers();
  }

  verifyMfaSetup(username, code, at = this.now()) {
    const user = this.users.get(normalizeUsername(username));
    if (!user?.totpSecret) return false;
    return verifyTotp(user.totpSecret, code, at, 1);
  }

  verifyMfa(username, code, at = this.now()) {
    const user = this.users.get(normalizeUsername(username));
    if (!user?.mfaEnabled || !user.totpSecret) return true;
    return verifyTotp(user.totpSecret, code, at, 1);
  }

  onlineUsers() {
    const online = new Set();
    for (const session of this.sessions.values()) online.add(session.username);
    return online;
  }

  hasUser(username) {
    return this.users.has(normalizeUsername(username));
  }

  hasUsers() {
    return this.users.size > 0;
  }

  addUser(username, password, role = "operator", allowedModels = [], features = undefined) {
    const normalized = normalizeUsername(username);
    assertPassword(password);
    if (!ROLES.has(role)) throw new AuthError("角色只能是 admin 或 operator。", "invalid_role");
    if (this.users.has(normalized)) throw new AuthError("用户已存在。", "user_exists", 409);
    const salt = randomBytes(16).toString("hex");
    const user = {
      username: normalized,
      role,
      salt,
      hash: hashPassword(password, salt).toString("hex"),
      createdAt: this.now(),
      allowedModels: normalizeAllowedModels(allowedModels),
      features: normalizeUserFeatures(features),
      preferences: { ...DEFAULT_PREFERENCES },
    };
    this.users.set(normalized, user);
    this.persistUsers();
    return {
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      allowedModels: [...user.allowedModels],
      features: normalizeUserFeatures(user.features),
    };
  }

  getPreferences(username) {
    const user = this.users.get(normalizeUsername(username));
    if (!user) throw new AuthError("用户不存在。", "user_not_found", 404);
    return normalizePreferences(user.preferences);
  }

  setPreferences(username, patch) {
    const normalized = normalizeUsername(username);
    const user = this.users.get(normalized);
    if (!user) throw new AuthError("用户不存在。", "user_not_found", 404);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new AuthError("个性化设置必须是对象。", "invalid_preferences");
    }
    user.preferences = normalizePreferences({ ...normalizePreferences(user.preferences), ...patch });
    this.users.set(normalized, user);
    this.persistUsers();
    return normalizePreferences(user.preferences);
  }

  setUserFeatures(username, features) {
    const normalized = normalizeUsername(username);
    const user = this.users.get(normalized);
    if (!user) throw new AuthError("用户不存在。", "user_not_found", 404);
    user.features = normalizeUserFeatures({ ...normalizeUserFeatures(user.features), ...(features || {}) });
    this.users.set(normalized, user);
    this.persistUsers();
    return normalizeUserFeatures(user.features);
  }

  setAllowedModels(username, allowedModels) {
    const normalized = normalizeUsername(username);
    const user = this.users.get(normalized);
    if (!user) throw new AuthError("用户不存在。", "user_not_found", 404);
    user.allowedModels = normalizeAllowedModels(allowedModels);
    this.users.set(normalized, user);
    this.persistUsers();
    return { ...user, allowedModels: [...user.allowedModels] };
  }

  getUser(username) {
    const user = this.users.get(normalizeUsername(username));
    if (!user) return null;
    return {
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      allowedModels: [...(user.allowedModels || [])],
      features: normalizeUserFeatures(user.features),
      preferences: normalizePreferences(user.preferences),
      mfaEnabled: user.mfaEnabled === true,
    };
  }

  setPassword(username, password) {
    const normalized = normalizeUsername(username);
    assertPassword(password);
    const user = this.users.get(normalized);
    if (!user) throw new AuthError("用户不存在。", "user_not_found", 404);
    const salt = randomBytes(16).toString("hex");
    user.salt = salt;
    user.hash = hashPassword(password, salt).toString("hex");
    this.users.set(normalized, user);
    this.persistUsers();
    this.destroyUserSessions(normalized);
  }

  setRole(username, role) {
    const normalized = normalizeUsername(username);
    if (!ROLES.has(role)) throw new AuthError("角色只能是 admin 或 operator。", "invalid_role");
    const user = this.users.get(normalized);
    if (!user) throw new AuthError("用户不存在。", "user_not_found", 404);
    if (user.role === "admin" && role !== "admin") {
      const admins = [...this.users.values()].filter((item) => item.role === "admin");
      if (admins.length <= 1) {
        throw new AuthError("不能降级最后一个管理员。", "last_admin", 409);
      }
    }
    user.role = role;
    this.users.set(normalized, user);
    this.persistUsers();
    this.destroyUserSessions(normalized);
    return {
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      allowedModels: [...(user.allowedModels || [])],
    };
  }

  removeUser(username) {
    const normalized = normalizeUsername(username);
    const user = this.users.get(normalized);
    if (!user) throw new AuthError("用户不存在。", "user_not_found", 404);
    if (user.role === "admin") {
      const admins = [...this.users.values()].filter((item) => item.role === "admin");
      if (admins.length <= 1) {
        throw new AuthError("不能删除最后一个管理员。", "last_admin", 409);
      }
    }
    this.users.delete(normalized);
    this.persistUsers();
    this.destroyUserSessions(normalized);
  }

  ensureBootstrap({ username = "admin", password = "" } = {}) {
    if (this.users.size > 0) return { created: false };
    const finalUsername = username ? normalizeUsername(username) : "admin";
    const generated = !password;
    const finalPassword = generated ? randomBytes(18).toString("base64url") : assertPassword(password);
    const user = this.addUser(finalUsername, finalPassword, "admin");
    return { created: true, generated, username: user.username, password: finalPassword };
  }

  loginAllowed(ip, username) {
    const now = this.now();
    const ipEntry = this.loginFailures.get(`ip:${ip}`);
    const userEntry = this.loginFailures.get(`user:${normalizeUsernameSafe(username)}`);
    const prune = (entry, windowMs) =>
      entry ? entry.failures.filter((at) => now - at < windowMs) : [];
    const ipFailures = prune(ipEntry, this.loginRateWindowMs);
    const userFailures = prune(userEntry, this.loginRateWindowMs);
    let retryAfterMs = 0;
    if (ipFailures.length >= this.loginIpMaxFailures) {
      retryAfterMs = Math.max(retryAfterMs, this.loginRateWindowMs - (now - ipFailures[0]));
    }
    if (userFailures.length >= this.loginUserMaxFailures) {
      retryAfterMs = Math.max(retryAfterMs, this.loginRateWindowMs - (now - userFailures[0]));
    }
    return { allowed: retryAfterMs <= 0, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  recordLoginFailure(ip, username) {
    const now = this.now();
    for (const [key, windowMs] of [
      [`ip:${ip}`, this.loginRateWindowMs],
      [`user:${normalizeUsernameSafe(username)}`, this.loginRateWindowMs],
    ]) {
      const entry = this.loginFailures.get(key) || { failures: [] };
      entry.failures = entry.failures.filter((at) => now - at < windowMs);
      entry.failures.push(now);
      this.loginFailures.set(key, entry);
    }
  }

  clearLoginFailures(ip, username) {
    this.loginFailures.delete(`user:${normalizeUsernameSafe(username)}`);
    const ipEntry = this.loginFailures.get(`ip:${ip}`);
    if (ipEntry) {
      ipEntry.failures = ipEntry.failures.slice(-Math.floor(this.loginIpMaxFailures / 2));
      if (ipEntry.failures.length === 0) this.loginFailures.delete(`ip:${ip}`);
    }
  }

  verifyCredentials(username, password) {
    let normalized;
    try {
      normalized = normalizeUsername(username);
    } catch {
      // Still spend one scrypt round so unknown/invalid names do not answer
      // noticeably faster than a known user with a wrong password.
      passwordMatches(String(password ?? ""), this.dummy);
      return null;
    }
    const user = this.users.get(normalized);
    if (!user) {
      passwordMatches(String(password ?? ""), this.dummy);
      return null;
    }
    if (!passwordMatches(String(password ?? ""), user)) return null;
    return { username: user.username, role: user.role };
  }

  createSession(user, { ip = "", userAgent = "" } = {}) {
    const now = this.now();
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    const current = this.users.get(user.username);
    const session = {
      token,
      username: user.username,
      role: user.role,
      passwordHash: current?.hash || "",
      csrf,
      createdAt: now,
      lastSeen: now,
      expiresAt: now + this.sessionTtlMs,
      ip,
      userAgent: String(userAgent || "").slice(0, 256),
    };
    this.sessions.set(token, session);
    this.destroyExtraSessions(user.username, 5);
    return session;
  }

  destroyExtraSessions(username, keep) {
    const own = [...this.sessions.values()]
      .filter((session) => session.username === username)
      .sort((a, b) => a.createdAt - b.createdAt);
    while (own.length > keep) {
      const oldest = own.shift();
      this.sessions.delete(oldest.token);
    }
  }

  destroyUserSessions(username) {
    for (const [token, session] of this.sessions) {
      if (session.username === username) this.sessions.delete(token);
    }
  }

  getSession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.get(this.cookieName);
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    const now = this.now();
    if (session.expiresAt <= now || now - session.lastSeen > this.sessionIdleMs) {
      this.sessions.delete(token);
      return null;
    }
    session.lastSeen = now;
    return session;
  }

  destroySession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.get(this.cookieName);
    if (token) this.sessions.delete(token);
    return token || null;
  }

  sessionCookie(session, req) {
    const secure = this.secureCookies || Boolean(req.socket?.encrypted);
    const parts = [
      `${this.cookieName}=${session.token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${Math.max(1, Math.floor(this.sessionTtlMs / 1000))}`,
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
  }

  clearCookie(req) {
    const secure = this.secureCookies || Boolean(req.socket?.encrypted);
    const parts = [
      `${this.cookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=0",
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
  }

  csrfMatches(session, token) {
    return Boolean(session && token) && safeEqualText(session.csrf, token);
  }

  close() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    if (this.watchHandler) {
      fs.unwatchFile(this.usersFile, this.watchHandler);
      this.watchHandler = null;
    }
    this.sessions.clear();
  }
}

function normalizeUsernameSafe(value) {
  try {
    return normalizeUsername(value);
  } catch {
    return String(value ?? "").trim().toLowerCase().slice(0, 32);
  }
}
