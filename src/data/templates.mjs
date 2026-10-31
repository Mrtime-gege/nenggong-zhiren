/** Server-side shared/personal reply templates for the operator console. */

import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const VERSION = 1;
const MAX_TEMPLATES = 300;
const MAX_NAME = 64;
const MAX_CONTENT = 4000;
const MAX_SCOPE = 64;
const DEFAULT_TEMPLATES = [
  { name: "收到", content: "收到，我先查看一下，稍后回复你。" },
  { name: "处理中", content: "正在处理中，预计还需要一点时间。" },
  { name: "请补充信息", content: "为了准确处理，请补充更多信息，谢谢。" },
  { name: "已完成", content: "已处理完成，请查收。" },
];

export class TemplateError extends Error {
  constructor(message, code = "invalid_template", status = 400) {
    super(message);
    this.name = "TemplateError";
    this.code = code;
    this.status = status;
  }
}

function cleanText(value, max, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new TemplateError(`${label}不能为空。`, "invalid_template");
  if (text.length > max) throw new TemplateError(`${label}不能超过 ${max} 个字符。`, "invalid_template");
  return text;
}

function cleanVisibility(value) {
  return value === "shared" ? "shared" : "personal";
}

function publicTemplate(template) {
  return {
    id: template.id,
    name: template.name,
    content: template.content,
    scope: template.scope || "",
    visibility: template.visibility,
    owner: template.owner,
    uses: template.uses || 0,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export class TemplateStore {
  constructor({ file, logger = console, now = Date.now } = {}) {
    if (!file) throw new Error("TemplateStore needs a file path");
    this.file = path.resolve(file);
    this.logger = logger;
    this.now = now;
    this.templates = [];
    this.seeded = false;
    this.loaded = false;
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.load();
    return this;
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.seedDefaults();
      this.loaded = true;
      this.persist();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      fs.chmodSync(this.file, 0o600);
    } catch (error) {
      throw new Error(`无法读取快捷回复文件 ${this.file}: ${error.message}`);
    }
    if (!parsed || parsed.version !== VERSION || !Array.isArray(parsed.templates)) {
      throw new Error(`快捷回复文件格式不正确: ${this.file}`);
    }
    this.templates = [];
    for (const raw of parsed.templates) {
      if (!raw || typeof raw !== "object") continue;
      const id = typeof raw.id === "string" && /^tpl_[A-Za-z0-9_-]{8,80}$/.test(raw.id) ? raw.id : "";
      const name = typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_NAME) : "";
      const content = typeof raw.content === "string" ? raw.content.trim().slice(0, MAX_CONTENT) : "";
      const owner = typeof raw.owner === "string" ? raw.owner.slice(0, 64) : "";
      if (!id || !name || !content || !owner) continue;
      this.templates.push({
        id,
        name,
        content,
        scope: typeof raw.scope === "string" ? raw.scope.slice(0, MAX_SCOPE) : "",
        visibility: cleanVisibility(raw.visibility),
        owner,
        uses: Math.max(0, Number(raw.uses) || 0),
        createdAt: Number(raw.createdAt) || this.now(),
        updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || this.now(),
      });
    }
    if (!this.templates.length && parsed.seeded !== true) this.seedDefaults();
    this.seeded = true;
    this.loaded = true;
    if (!parsed.seeded) this.persist();
  }

  seedDefaults() {
    const now = this.now();
    this.templates = DEFAULT_TEMPLATES.map((item, index) => ({
      id: `tpl_default_${index + 1}`,
      name: item.name,
      content: item.content,
      scope: "",
      visibility: "shared",
      owner: "system",
      uses: 0,
      createdAt: now,
      updatedAt: now,
    }));
    this.seeded = true;
  }

  persist() {
    const temp = path.join(
      path.dirname(this.file),
      `.templates.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`,
    );
    const payload = { version: VERSION, seeded: this.seeded, templates: this.templates };
    fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  listFor(username, role = "operator") {
    return this.templates
      .filter((item) => item.visibility === "shared" || item.owner === username || role === "admin")
      .sort((a, b) => {
        if (a.visibility !== b.visibility) return a.visibility === "shared" ? -1 : 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      })
      .map(publicTemplate);
  }

  getVisible(id, username, role = "operator") {
    const template = this.templates.find((item) => item.id === id);
    if (!template) throw new TemplateError("快捷回复不存在。", "template_not_found", 404);
    if (template.visibility !== "shared" && template.owner !== username && role !== "admin") {
      throw new TemplateError("快捷回复不存在。", "template_not_found", 404);
    }
    return template;
  }

  create({ username, role, name, content, scope, visibility }) {
    if (this.templates.length >= MAX_TEMPLATES) {
      throw new TemplateError("快捷回复数量已达上限。", "template_limit", 409);
    }
    const kind = cleanVisibility(visibility);
    if (kind === "shared" && role !== "admin") {
      throw new TemplateError("只有管理员可以创建共享快捷回复。", "template_forbidden", 403);
    }
    const now = this.now();
    const template = {
      id: `tpl_${randomUUID().replaceAll("-", "")}`,
      name: cleanText(name, MAX_NAME, "名称"),
      content: cleanText(content, MAX_CONTENT, "内容"),
      scope: String(scope || "").trim().slice(0, MAX_SCOPE),
      visibility: kind,
      owner: String(username || "").slice(0, 64),
      uses: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.templates.push(template);
    this.persist();
    return publicTemplate(template);
  }

  update(id, { username, role, name, content, scope, visibility }) {
    const template = this.getVisible(id, username, role);
    if (template.visibility === "shared" && role !== "admin") {
      throw new TemplateError("只有管理员可以修改共享快捷回复。", "template_forbidden", 403);
    }
    if (template.visibility !== "shared" && template.owner !== username && role !== "admin") {
      throw new TemplateError("无权修改该快捷回复。", "template_forbidden", 403);
    }
    if (name !== undefined) template.name = cleanText(name, MAX_NAME, "名称");
    if (content !== undefined) template.content = cleanText(content, MAX_CONTENT, "内容");
    if (scope !== undefined) template.scope = String(scope || "").trim().slice(0, MAX_SCOPE);
    if (visibility !== undefined) {
      const kind = cleanVisibility(visibility);
      if (kind === "shared" && role !== "admin") {
        throw new TemplateError("只有管理员可以发布共享快捷回复。", "template_forbidden", 403);
      }
      template.visibility = kind;
      if (kind === "personal") template.owner = template.owner || username;
    }
    template.updatedAt = this.now();
    this.persist();
    return publicTemplate(template);
  }

  remove(id, { username, role }) {
    const template = this.getVisible(id, username, role);
    if (template.visibility === "shared" && role !== "admin") {
      throw new TemplateError("只有管理员可以删除共享快捷回复。", "template_forbidden", 403);
    }
    if (template.visibility !== "shared" && template.owner !== username && role !== "admin") {
      throw new TemplateError("无权删除该快捷回复。", "template_forbidden", 403);
    }
    this.templates = this.templates.filter((item) => item.id !== id);
    this.persist();
    return { id };
  }

  markUsed(id, { username, role }) {
    const template = this.getVisible(id, username, role);
    template.uses = Math.max(0, Number(template.uses) || 0) + 1;
    template.updatedAt = this.now();
    this.persist();
    return publicTemplate(template);
  }
}
