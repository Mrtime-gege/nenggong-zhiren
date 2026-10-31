/**
 * 能工智人 · configuration loader.
 *
 * The service is configured only by `config.jsonc` in the project root.
 * Comments are part of the format and explain allowed values and effects.
 * No environment variables or command-line options are used for runtime data.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const CONFIG_FILE = path.join(ROOT, "config.jsonc");

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
    this.code = "invalid_config";
  }
}

/**
 * Remove // and slash-star comments outside strings, then remove trailing
 * commas before } or ]. This is intentionally a small JSONC reader, not a
 * general JSON5 implementation.
 */
export function stripJsonc(input) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += char;
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    output += char;
  }

  if (inString || blockComment) {
    throw new ConfigError("config.jsonc contains an unterminated string or comment.");
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

export function parseJsonc(text, file = "config.jsonc") {
  let value;
  try {
    value = JSON.parse(stripJsonc(String(text)));
  } catch (error) {
    throw new ConfigError(`Cannot parse ${file}: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`${file} must contain a JSON object.`);
  }
  return value;
}

function objectAt(object, key, label) {
  const value = object?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`${label} must be an object.`);
  }
  return value;
}

function stringAt(object, key, label, fallback = "", { allowEmpty = false } = {}) {
  const value = object?.[key] ?? fallback;
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new ConfigError(`${label} must be ${allowEmpty ? "a string" : "a non-empty string"}.`);
  }
  return value.trim();
}

function integerAt(object, key, label, { fallback, min = -Infinity, max = Infinity } = {}) {
  const value = object?.[key] ?? fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) {
    throw new ConfigError(`${label} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function booleanAt(object, key, label, fallback = false) {
  const value = object?.[key] ?? fallback;
  if (typeof value !== "boolean") throw new ConfigError(`${label} must be true or false.`);
  return value;
}

function stringArrayAt(object, key, label, fallback = []) {
  const value = object?.[key] ?? fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ConfigError(`${label} must be an array of non-empty strings.`);
  }
  return value.map((item) => item.trim());
}

function resolvePath(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

export function loadConfig(file = CONFIG_FILE) {
  if (!fs.existsSync(file)) {
    throw new ConfigError(
      `Missing ${path.basename(file)}. Copy config.example.jsonc to config.jsonc and edit it.`,
    );
  }
  const raw = parseJsonc(fs.readFileSync(file, "utf8"), path.basename(file));

  const server = objectAt(raw, "server", "server");
  const storage = objectAt(raw, "storage", "storage");
  const auth = objectAt(raw, "auth", "auth");
  const queue = objectAt(raw, "queue", "queue");
  const limits = objectAt(raw, "limits", "limits");
  const models = objectAt(raw, "models", "models");
  const tls = objectAt(raw, "tls", "tls");
  const logging = objectAt(raw, "logging", "logging");
  const auditCfg = raw.audit ?? {};
  const attachments = raw.attachments ?? {};
  if (typeof attachments !== "object" || Array.isArray(attachments)) {
    throw new ConfigError("attachments must be an object.");
  }
  const alerts = raw.alerts ?? {};
  if (typeof alerts !== "object" || Array.isArray(alerts)) {
    throw new ConfigError("alerts must be an object.");
  }
  const features = raw.features ?? {};
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    throw new ConfigError("features must be an object.");
  }

  const host = stringAt(server, "host", "server.host", "0.0.0.0");
  const port = integerAt(server, "port", "server.port", { fallback: 7355, min: 0, max: 65535 });
  const cookieSecureRaw = server.cookieSecure ?? "auto";
  if (!["auto", true, false].includes(cookieSecureRaw)) {
    throw new ConfigError('server.cookieSecure must be "auto", true, or false.');
  }

  const usersFile = resolvePath(stringAt(storage, "usersFile", "storage.usersFile", "users.json"));
  const apiKeysFile = resolvePath(stringAt(storage, "apiKeysFile", "storage.apiKeysFile", "api-keys.json"));
  const stateFile = resolvePath(stringAt(storage, "stateFile", "storage.stateFile", "state.json"));
  const usageFile = resolvePath(stringAt(storage, "usageFile", "storage.usageFile", "usage.json"));
  const settingsFile = resolvePath(stringAt(storage, "settingsFile", "storage.settingsFile", "settings.json"));
  const auditFile = resolvePath(stringAt(storage, "auditFile", "storage.auditFile", "audit.log"));
  const modelsFile = resolvePath(stringAt(storage, "modelsFile", "storage.modelsFile", "models.json"));
  const attachmentsDir = resolvePath(stringAt(storage, "attachmentsDir", "storage.attachmentsDir", "attachments"));
  const templatesFile = resolvePath(stringAt(storage, "templatesFile", "storage.templatesFile", "templates.json"));
  const aiSecretsFile = resolvePath(stringAt(storage, "aiSecretsFile", "storage.aiSecretsFile", "ai-secrets.json"));
  const aiUsageFile = resolvePath(stringAt(storage, "aiUsageFile", "storage.aiUsageFile", "ai-usage.json"));
  const historyFile = resolvePath(stringAt(storage, "historyFile", "storage.historyFile", "history.db"));
  const stateDb = resolvePath(stringAt(storage, "stateDb", "storage.stateDb", "state.db"));
  const modelIds = stringArrayAt(models, "ids", "models.ids", ["human-1", "human-1-fast"]);
  if (!modelIds.length) throw new ConfigError("models.ids must contain at least one model name.");
  const defaultModel = stringAt(models, "default", "models.default", modelIds[0]);
  if (!modelIds.includes(defaultModel)) {
    throw new ConfigError("models.default must be one of models.ids.");
  }
  const catalogRaw = models.catalog;
  const catalog = [];
  if (catalogRaw !== undefined) {
    if (!Array.isArray(catalogRaw)) throw new ConfigError("models.catalog must be an array.");
    for (const item of catalogRaw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new ConfigError("models.catalog entries must be objects.");
      }
      const id = stringAt(item, "id", "models.catalog[].id");
      if (!modelIds.includes(id)) throw new ConfigError(`models.catalog id '${id}' must appear in models.ids.`);
      const capabilities = stringArrayAt(item, "capabilities", "models.catalog[].capabilities", ["text", "streaming"]);
      const allowed = new Set(["text", "streaming", "tools", "images", "json", "reasoning"]);
      for (const capability of capabilities) {
        if (!allowed.has(capability)) {
          throw new ConfigError(`Unknown model capability '${capability}'.`);
        }
      }
      catalog.push({
        id,
        name: stringAt(item, "name", "models.catalog[].name", id),
        description: stringAt(item, "description", "models.catalog[].description", "", { allowEmpty: true }),
        contextWindow: integerAt(item, "contextWindow", "models.catalog[].contextWindow", {
          fallback: 131072,
          min: 1,
          max: 10_000_000,
        }),
        maxOutputTokens: integerAt(item, "maxOutputTokens", "models.catalog[].maxOutputTokens", {
          fallback: 8192,
          min: 1,
          max: 1_000_000,
        }),
        capabilities,
        deprecated: booleanAt(item, "deprecated", "models.catalog[].deprecated", false),
      });
    }
  }
  if (!catalog.length) {
    for (const id of modelIds) {
      catalog.push({
        id,
        name: id,
        description: "human-backed response model",
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ["text", "streaming", "tools", "images"],
        deprecated: false,
      });
    }
  }
  for (const id of modelIds) {
    if (!catalog.some((model) => model.id === id)) {
      catalog.push({
        id,
        name: id,
        description: "human-backed response model",
        contextWindow: 131072,
        maxOutputTokens: 8192,
        capabilities: ["text", "streaming", "tools", "images"],
        deprecated: false,
      });
    }
  }

  const tlsEnabled = booleanAt(tls, "enabled", "tls.enabled", false);
  const certFile = resolvePath(stringAt(tls, "certFile", "tls.certFile", "", { allowEmpty: true }));
  const keyFile = resolvePath(stringAt(tls, "keyFile", "tls.keyFile", "", { allowEmpty: true }));
  if (tlsEnabled && (!certFile || !keyFile)) {
    throw new ConfigError("tls.enabled requires both tls.certFile and tls.keyFile.");
  }
  if (tlsEnabled && (!fs.existsSync(certFile) || !fs.existsSync(keyFile))) {
    throw new ConfigError("tls.enabled is true but tls.certFile or tls.keyFile does not exist.");
  }

  return Object.freeze({
    file,
    root: ROOT,
    server: Object.freeze({
      host,
      port,
      cookieSecure: cookieSecureRaw,
      trustedHosts: stringArrayAt(server, "trustedHosts", "server.trustedHosts", []).map((item) =>
        item.toLowerCase(),
      ),
      trustedProxies: stringArrayAt(server, "trustedProxies", "server.trustedProxies", []),
      corsOrigins: stringArrayAt(server, "corsOrigins", "server.corsOrigins", ["*"]),
    }),
    storage: Object.freeze({ usersFile, apiKeysFile, stateFile, usageFile, settingsFile, auditFile, modelsFile, attachmentsDir, templatesFile, aiSecretsFile, aiUsageFile, historyFile, stateDb }),
    auth: Object.freeze({
      sessionTtlMs: integerAt(auth, "sessionTtlMs", "auth.sessionTtlMs", {
        fallback: 12 * 60 * 60_000,
        min: 60_000,
        max: 30 * 24 * 60 * 60_000,
      }),
      sessionIdleMs: integerAt(auth, "sessionIdleMs", "auth.sessionIdleMs", {
        fallback: 2 * 60 * 60_000,
        min: 60_000,
        max: 7 * 24 * 60 * 60_000,
      }),
      loginRateWindowMs: integerAt(auth, "loginRateWindowMs", "auth.loginRateWindowMs", {
        fallback: 5 * 60_000,
        min: 10_000,
        max: 60 * 60_000,
      }),
      loginIpMaxFailures: integerAt(auth, "loginIpMaxFailures", "auth.loginIpMaxFailures", {
        fallback: 10,
        min: 1,
        max: 1_000,
      }),
      loginUserMaxFailures: integerAt(auth, "loginUserMaxFailures", "auth.loginUserMaxFailures", {
        fallback: 5,
        min: 1,
        max: 1_000,
      }),
    }),
    queue: Object.freeze({
      waitTimeoutMs: integerAt(queue, "waitTimeoutMs", "queue.waitTimeoutMs", {
        fallback: 300_000,
        min: 100,
        max: 86_400_000,
      }),
      responseTimeoutMs: integerAt(queue, "responseTimeoutMs", "queue.responseTimeoutMs", {
        fallback: 900_000,
        min: 100,
        max: 86_400_000,
      }),
      retentionMs: integerAt(queue, "retentionMs", "queue.retentionMs", {
        fallback: 30 * 60_000,
        min: 10_000,
        max: 86_400_000,
      }),
      streamDelayMs: integerAt(queue, "streamDelayMs", "queue.streamDelayMs", {
        fallback: 26,
        min: 0,
        max: 60_000,
      }),
    }),
    limits: Object.freeze({
      maxConcurrentPerKey: integerAt(limits, "maxConcurrentPerKey", "limits.maxConcurrentPerKey", {
        fallback: 4,
        min: 1,
        max: 1_000,
      }),
      bodyLimitBytes: integerAt(limits, "bodyLimitBytes", "limits.bodyLimitBytes", {
        fallback: 2 * 1024 * 1024,
        min: 1024,
        max: 64 * 1024 * 1024,
      }),
    }),
    models: Object.freeze({
      ids: Object.freeze(modelIds),
      default: defaultModel,
      catalog: Object.freeze(catalog.map((model) => Object.freeze(model))),
    }),
    tls: Object.freeze({ enabled: tlsEnabled, certFile, keyFile }),
    logging: Object.freeze({ content: booleanAt(logging, "content", "logging.content", false) }),
    attachments: Object.freeze({
      enabled: booleanAt(attachments, "enabled", "attachments.enabled", true),
      maxBytes: integerAt(attachments, "maxBytes", "attachments.maxBytes", {
        fallback: 10 * 1024 * 1024,
        min: 1,
        max: 50 * 1024 * 1024,
      }),
      maxPerRequest: integerAt(attachments, "maxPerRequest", "attachments.maxPerRequest", {
        fallback: 5,
        min: 1,
        max: 20,
      }),
      maxImagesPerRequest: integerAt(attachments, "maxImagesPerRequest", "attachments.maxImagesPerRequest", {
        fallback: 8,
        min: 1,
        max: 50,
      }),
      maxImageUrlBytes: integerAt(attachments, "maxImageUrlBytes", "attachments.maxImageUrlBytes", {
        fallback: 2_000_000,
        min: 16_384,
        max: 8 * 1024 * 1024,
      }),
      reencodeImages: booleanAt(attachments, "reencodeImages", "attachments.reencodeImages", false),
      pdfPagePreview: booleanAt(attachments, "pdfPagePreview", "attachments.pdfPagePreview", false),
      maxTextPreviewBytes: integerAt(attachments, "maxTextPreviewBytes", "attachments.maxTextPreviewBytes", {
        fallback: 262_144,
        min: 1_024,
        max: 2 * 1024 * 1024,
      }),
      maxPdfTextBytes: integerAt(attachments, "maxPdfTextBytes", "attachments.maxPdfTextBytes", {
        fallback: 262_144,
        min: 1_024,
        max: 2 * 1024 * 1024,
      }),
      maxBytesPerKeyPerDay: integerAt(attachments, "maxBytesPerKeyPerDay", "attachments.maxBytesPerKeyPerDay", {
        fallback: 200 * 1024 * 1024,
        min: 0,
        max: 10 * 1024 * 1024 * 1024,
      }),
      maxStoreBytes: integerAt(attachments, "maxStoreBytes", "attachments.maxStoreBytes", {
        fallback: 2 * 1024 * 1024 * 1024,
        min: 1024 * 1024,
        max: 100 * 1024 * 1024 * 1024,
      }),
      retentionMs: integerAt(attachments, "retentionMs", "attachments.retentionMs", {
        fallback: 30 * 86_400_000,
        min: 3_600_000,
        max: 365 * 86_400_000,
      }),
    }),
    alerts: Object.freeze({
      webhookUrl: stringAt(alerts, "webhookUrl", "alerts.webhookUrl", "", { allowEmpty: true }),
      queueDepth: integerAt(alerts, "queueDepth", "alerts.queueDepth", { fallback: 10, min: 1, max: 10_000 }),
      oldestWaitMs: integerAt(alerts, "oldestWaitMs", "alerts.oldestWaitMs", {
        fallback: 60_000,
        min: 1_000,
        max: 86_400_000,
      }),
      cooldownMs: integerAt(alerts, "cooldownMs", "alerts.cooldownMs", {
        fallback: 300_000,
        min: 10_000,
        max: 86_400_000,
      }),
    }),
    audit: Object.freeze({
      maxBytes: integerAt(auditCfg, "maxBytes", "audit.maxBytes", {
        fallback: 10 * 1024 * 1024,
        min: 1024 * 1024,
        max: 1024 * 1024 * 1024,
      }),
      keepFiles: integerAt(auditCfg, "keepFiles", "audit.keepFiles", {
        fallback: 5,
        min: 1,
        max: 20,
      }),
    }),
    features: Object.freeze({
      auditLog: booleanAt(features, "auditLog", "features.auditLog", true),
      usageDashboard: booleanAt(features, "usageDashboard", "features.usageDashboard", true),
      publicGuide: booleanAt(features, "publicGuide", "features.publicGuide", true),
    }),
    allowNullOrigin: false,
  });
}
