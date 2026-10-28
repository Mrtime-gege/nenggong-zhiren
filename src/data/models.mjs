/** Persistent model registry for the human-backed provider. */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const FILE_VERSION = 1;
const MAX_MODELS = 128;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const CAPABILITIES = new Set(["text", "streaming", "tools", "images", "json", "reasoning"]);

export class ModelError extends Error {
  constructor(message, code = "invalid_model", status = 400) {
    super(message);
    this.name = "ModelError";
    this.code = code;
    this.status = status;
  }
}

function normalizeCapabilities(raw) {
  const values = Array.isArray(raw) ? raw : ["text", "streaming", "tools", "images", "json", "reasoning"];
  const out = [...new Set(values.map((item) => String(item).trim()).filter((item) => CAPABILITIES.has(item)))];
  return out.length ? out : ["text", "streaming"];
}

function normalizeModel(raw) {
  const id = String(raw?.id ?? "").trim();
  if (!MODEL_ID_RE.test(id)) {
    throw new ModelError("模型名需为 2–64 位字母、数字、点、下划线或连字符，并且以字母或数字开头。", "invalid_model_id");
  }
  const name = String(raw?.name ?? id).trim().slice(0, 80) || id;
  return {
    id,
    name,
    description: String(raw?.description ?? "").slice(0, 500),
    contextWindow: Number(raw?.contextWindow) || 131072,
    maxOutputTokens: Number(raw?.maxOutputTokens) || 8192,
    capabilities: normalizeCapabilities(raw?.capabilities),
    deprecated: raw?.deprecated === true,
    createdAt: Number(raw?.createdAt) || Date.now(),
  };
}

export class ModelStore {
  constructor({ file, seed = [], logger = console } = {}) {
    if (!file) throw new Error("ModelStore needs a file path");
    this.file = path.resolve(file);
    this.seed = Array.isArray(seed) ? seed : [];
    this.logger = logger;
    this.records = new Map();
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.load();
    return this;
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.records = new Map();
      for (const raw of this.seed) {
        const record = normalizeModel(raw);
        this.records.set(record.id, record);
      }
      if (!this.records.size) throw new Error("模型列表不能为空。");
      this.persist();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      fs.chmodSync(this.file, 0o600);
    } catch (error) {
      throw new Error(`无法读取模型文件 ${this.file}: ${error.message}`);
    }
    if (!parsed || parsed.version !== FILE_VERSION || !Array.isArray(parsed.models) || !parsed.models.length) {
      throw new Error(`模型文件格式不正确: ${this.file}`);
    }
    this.records = new Map();
    for (const raw of parsed.models) {
      const record = normalizeModel(raw);
      this.records.set(record.id, record);
    }
  }

  persist() {
    const payload = {
      version: FILE_VERSION,
      models: [...this.records.values()].map((record) => ({
        id: record.id,
        name: record.name,
        description: record.description,
        contextWindow: record.contextWindow,
        maxOutputTokens: record.maxOutputTokens,
        capabilities: record.capabilities,
        deprecated: record.deprecated,
        createdAt: record.createdAt,
      })),
    };
    const tmp = path.join(
      path.dirname(this.file),
      `.models.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`,
    );
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  list() {
    return [...this.records.values()]
      .map((record) => ({ ...record, capabilities: [...record.capabilities] }))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  has(id) {
    return this.records.has(String(id));
  }

  get(id) {
    const record = this.records.get(String(id));
    return record ? { ...record, capabilities: [...record.capabilities] } : null;
  }

  add({ id, name, description, contextWindow, maxOutputTokens, capabilities } = {}) {
    if (this.records.size >= MAX_MODELS) throw new ModelError(`最多保留 ${MAX_MODELS} 个模型。`, "too_many_models", 409);
    const record = normalizeModel({
      id,
      name: name || id,
      description,
      contextWindow,
      maxOutputTokens,
      capabilities,
      createdAt: Date.now(),
    });
    if (this.records.has(record.id)) throw new ModelError("模型名已存在。", "model_exists", 409);
    this.records.set(record.id, record);
    this.persist();
    return { ...record, capabilities: [...record.capabilities] };
  }

  remove(id) {
    const key = String(id);
    if (!this.records.has(key)) throw new ModelError("模型不存在。", "model_not_found", 404);
    if (this.records.size <= 1) throw new ModelError("至少需要保留一个模型。", "last_model", 409);
    this.records.delete(key);
    this.persist();
    return true;
  }
}
