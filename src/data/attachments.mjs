/**
 * Local attachment store with a deliberately narrow preview surface.
 *
 * Only text-like files, raster images and PDF text extraction are accepted.
 * The original blob is never served inline except for validated raster images;
 * PDF and text originals are download-only. No HTML/SVG/Office/ZIP execution.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash, randomUUID } from "node:crypto";

const FILE_ID_RE = /^file_[A-Za-z0-9_-]{8,80}$/;
const TEXT_EXTENSIONS = new Set([".txt", ".log", ".json", ".jsonl", ".ndjson", ".csv", ".tsv", ".md"]);
const TEXT_MIME = new Set(["text/plain", "text/csv", "application/json", "application/x-ndjson"]);
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_PDF_PAGES = 200;

export class AttachmentError extends Error {
  constructor(message, code = "invalid_attachment", status = 400) {
    super(message);
    this.name = "AttachmentError";
    this.code = code;
    this.status = status;
  }
}

function cleanFilename(value) {
  const base = String(value || "attachment")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["\\]/g, "_")
    .trim();
  return (base || "attachment").slice(0, 160);
}

function extensionOf(name) {
  return path.extname(name).toLowerCase();
}

function isTextCandidate(name, declaredType) {
  const ext = extensionOf(name);
  const type = String(declaredType || "").split(";")[0].trim().toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || TEXT_MIME.has(type);
}

function detectPng(buf) {
  if (buf.length < 45) return null;
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  if (buf.readUInt32BE(8) !== 13 || buf.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  if (buf.indexOf(Buffer.from("IDAT"), 20) < 0) return null;
  if (buf.indexOf(Buffer.from("IEND"), 20) < 0) return null;
  return { kind: "image", mime: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function detectJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) return null;
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > buf.length) break;
    const length = buf.readUInt16BE(offset);
    if (length < 2 || offset + length > buf.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (offset + 7 <= buf.length) {
        return {
          kind: "image",
          mime: "image/jpeg",
          height: buf.readUInt16BE(offset + 3),
          width: buf.readUInt16BE(offset + 5),
        };
      }
      break;
    }
    offset += length;
  }
  return null;
}

function detectGif(buf) {
  if (buf.length < 10) return null;
  const sig = buf.subarray(0, 6).toString("ascii");
  if (sig !== "GIF87a" && sig !== "GIF89a") return null;
  if (buf[buf.length - 1] !== 0x3b) return null;
  return { kind: "image", mime: "image/gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function detectWebp(buf) {
  if (buf.length < 20) return null;
  if (buf.subarray(0, 4).toString("ascii") !== "RIFF" || buf.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const declared = buf.readUInt32LE(4) + 8;
  if (declared > buf.length || declared < 20) return null;
  const chunk = buf.subarray(12, 16).toString("ascii");
  const chunkSize = buf.readUInt32LE(16);
  if (chunkSize < 4 || 20 + chunkSize > buf.length) return null;
  if (chunk === "VP8X" && buf.length >= 30) {
    return { kind: "image", mime: "image/webp", width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (chunk === "VP8L" && buf.length >= 25 && buf[20] === 0x2f) {
    const bits = buf.readUInt32LE(21);
    return { kind: "image", mime: "image/webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === "VP8 " && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    return { kind: "image", mime: "image/webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function detectImage(buf) {
  return detectPng(buf) || detectJpeg(buf) || detectGif(buf) || detectWebp(buf);
}

function validateImageDimensions(image) {
  if (!image.width || !image.height) {
    throw new AttachmentError("图片尺寸无效，已拒绝处理。", "invalid_image_dimensions");
  }
  if (image.width > MAX_IMAGE_DIMENSION || image.height > MAX_IMAGE_DIMENSION ||
      image.width * image.height > MAX_IMAGE_PIXELS) {
    throw new AttachmentError("图片尺寸过大，已拒绝处理。", "image_too_large");
  }
}

function decodePdfString(value) {
  return value.replace(/\\([0-7]{1,3}|.)/g, (_, escape) => {
    if (/^[0-7]+$/.test(escape)) return String.fromCharCode(parseInt(escape, 8) & 0xff);
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" })[escape] || escape;
  });
}

function extractPdfContentText(content, maxBytes) {
  let out = "";
  let last = 0;
  const tokens = /\((?:\\[0-7]{1,3}|\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|(T\*|Td|TD|ET)/g;
  for (const match of content.matchAll(tokens)) {
    const token = match[0];
    if (token === "T*" || token === "Td" || token === "TD" || token === "ET") {
      out += "\n";
    } else {
      const after = content.slice(match.index + token.length, match.index + token.length + 24);
      if (!/\b(Tj|TJ|'|")/.test(after)) continue;
      const raw = token.startsWith("(") ? token.slice(1, -1) : null;
      if (raw !== null) out += decodePdfString(raw);
      else out += " ";
    }
    last = match.index + token.length;
    if (out.length >= maxBytes) break;
  }
  if (!out.trim()) {
    // Some generators put strings on separate lines; a conservative fallback
    // still extracts printable parenthesized strings, never binary payloads.
    const strings = content.match(/\((?:\\[0-7]{1,3}|\\.|[^\\()])*\)/g) || [];
    for (const raw of strings) out += `${decodePdfString(raw.slice(1, -1))} `;
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxBytes);
}

function extractPdfText(buf, maxBytes) {
  const raw = buf.toString("latin1");
  if (/\/Encrypt\b/.test(raw)) {
    throw new AttachmentError("不支持加密 PDF。", "pdf_encrypted");
  }
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|XFA)\b/.test(raw)) {
    throw new AttachmentError("PDF 包含可执行或嵌入式动作，已拒绝。", "pdf_active_content");
  }
  let pages = (raw.match(/\/Type\s*\/Page\b/g) || []).length;
  if (pages > MAX_PDF_PAGES) throw new AttachmentError("PDF 页数过多。", "pdf_too_many_pages");
  const streams = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  let total = 0;
  let count = 0;
  while ((match = streamRe.exec(raw)) && count < 80) {
    count += 1;
    const dictStart = Math.max(0, match.index - 800);
    const dict = raw.slice(dictStart, match.index);
    let bytes = Buffer.from(match[1], "latin1");
    if (/\/FlateDecode\b/.test(dict)) {
      try {
        bytes = zlib.inflateSync(bytes, { maxOutputLength: 1_000_000 });
      } catch {
        continue;
      }
    }
    if (/\/Filter\b/.test(dict) && !/\/FlateDecode\b/.test(dict)) continue;
    total += bytes.length;
    if (total > 6_000_000) break;
    streams.push(bytes.toString("latin1"));
  }
  let text = "";
  for (const stream of streams) {
    text += `${extractPdfContentText(stream, Math.max(0, maxBytes - text.length))}\n`;
    if (text.length >= maxBytes) break;
  }
  if (!pages) {
    const countMatch = raw.match(/\/Count\s+(\d+)/);
    pages = countMatch ? Number(countMatch[1]) : 0;
  }
  return { text: text.slice(0, maxBytes), pages };
}

function parseCsv(text, { maxRows = 200, maxColumns = 24 } = {}) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length <= maxRows; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t") { row.push(field); field = ""; }
    else if (ch === "\n") {
      row.push(field);
      rows.push(row.slice(0, maxColumns));
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
    if (row.length > maxColumns) row.length = maxColumns;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row.slice(0, maxColumns));
  }
  const columns = rows.shift() || [];
  return { columns, rows, totalRows: rows.length, truncated: rows.length >= maxRows };
}

function isBinaryText(text) {
  if (text.includes("\u0000")) return true;
  const controls = [...text].filter((ch) => ch.charCodeAt(0) < 9 || (ch.charCodeAt(0) > 13 && ch.charCodeAt(0) < 32));
  return controls.length > Math.max(8, text.length * 0.005);
}

function textPreview(buf, filename, declaredType, maxBytes) {
  if (!isTextCandidate(filename, declaredType)) return null;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new AttachmentError("文件不是有效的 UTF-8 文本。", "invalid_text_encoding");
  }
  if (isBinaryText(text)) throw new AttachmentError("文件看起来是二进制内容。", "binary_text");
  text = text.replace(/^\uFEFF/, "");
  const ext = extensionOf(filename);
  const mime = ext === ".csv" || ext === ".tsv" ? "text/csv" : ext === ".json" ? "application/json" : "text/plain";
  const truncated = text.length > maxBytes;
  const visible = text.slice(0, maxBytes);
  const preview = {
    text: visible,
    truncated,
    lines: visible.split("\n").length,
    totalBytes: buf.length,
  };
  if (mime === "text/csv") {
    try { preview.table = parseCsv(visible); } catch { /* display as text */ }
  }
  return { kind: mime === "text/csv" ? "csv" : mime === "application/json" ? "json" : "text", mime, preview };
}

function validateRecord(record) {
  if (!record || !FILE_ID_RE.test(record.id)) throw new AttachmentError("附件不存在。", "attachment_not_found", 404);
  if (record.status !== "ready") throw new AttachmentError("附件尚未就绪或已被隔离。", "attachment_not_ready", 409);
  return record;
}

export class AttachmentStore {
  constructor({ dir, maxBytes = 10 * 1024 * 1024, maxPerRequest = 5, maxTextPreviewBytes = 262_144, maxPdfTextBytes = 262_144, retentionMs = 30 * 86_400_000, maxStoreBytes = 2 * 1024 * 1024 * 1024, logger = console } = {}) {
    if (!dir) throw new Error("AttachmentStore needs a directory");
    this.dir = path.resolve(dir);
    this.maxBytes = maxBytes;
    this.maxStoreBytes = Math.max(1024 * 1024, Number(maxStoreBytes) || 0);
    this.totalBytes = 0;
    this.maxPerRequest = maxPerRequest;
    this.maxTextPreviewBytes = maxTextPreviewBytes;
    this.maxPdfTextBytes = maxPdfTextBytes;
    this.retentionMs = retentionMs;
    this.lastPruneAt = 0;
    this.cache = new Map();
    this.logger = logger;
  }

  init() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.dir, 0o700); } catch { /* best effort */ }
    this.scanUsage();
    this.prune();
    this.scanUsage();
    return this;
  }

  scanUsage() {
    let total = 0;
    let entries = [];
    try { entries = fs.readdirSync(this.dir); } catch { this.totalBytes = 0; return; }
    for (const name of entries) {
      if (!name.endsWith(".json") || !FILE_ID_RE.test(name.slice(0, -5))) continue;
      try {
        const record = JSON.parse(fs.readFileSync(path.join(this.dir, name), "utf8"));
        total += Math.max(0, Number(record.bytes) || 0);
      } catch {
        /* unreadable metadata is not counted; keep it for inspection */
      }
    }
    this.totalBytes = total;
  }

  prune(now = Date.now()) {
    if (this.lastPruneAt && now - this.lastPruneAt < 3_600_000) return;
    this.lastPruneAt = now;
    let entries = [];
    try { entries = fs.readdirSync(this.dir); } catch { return; }
    for (const name of entries) {
      if (!name.endsWith(".json") || !FILE_ID_RE.test(name.slice(0, -5))) continue;
      const metaFile = path.join(this.dir, name);
      try {
        const record = JSON.parse(fs.readFileSync(metaFile, "utf8"));
        if (now - Number(record.createdAt || 0) <= this.retentionMs) continue;
        fs.rmSync(metaFile, { force: true });
        fs.rmSync(path.join(this.dir, `${record.id}.bin`), { force: true });
        this.cache.delete(record.id);
        this.totalBytes = Math.max(0, this.totalBytes - Math.max(0, Number(record.bytes) || 0));
      } catch {
        /* leave unreadable metadata for an operator to inspect */
      }
    }
  }

  looksLikeImage(buffer) {
    try { return Boolean(detectImage(buffer)); } catch { return false; }
  }

  create({ buffer, filename, declaredType, ownerHash }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new AttachmentError("文件为空。", "empty_file");
    }
    if (buffer.length > this.maxBytes) {
      throw new AttachmentError(`文件超过上限（${this.maxBytes} 字节）。`, "file_too_large", 413);
    }
    this.prune();
    if (this.totalBytes + buffer.length > this.maxStoreBytes) {
      throw new AttachmentError("附件存储空间已满，请联系管理员清理或调高上限。", "attachment_store_full", 507);
    }
    const safeName = cleanFilename(filename);
    let detected = detectImage(buffer);
    if (detected) validateImageDimensions(detected);
    let pdf = null;
    if (!detected && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
      if (!/^%PDF-\d\.\d/.test(buffer.subarray(0, 12).toString("ascii"))) {
        throw new AttachmentError("PDF 文件头无效。", "invalid_pdf");
      }
      const extracted = extractPdfText(buffer, this.maxPdfTextBytes);
      pdf = {
        kind: "pdf",
        mime: "application/pdf",
        preview: { text: extracted.text, pages: extracted.pages, truncated: extracted.text.length >= this.maxPdfTextBytes },
      };
    }
    const text = detected || pdf ? null : textPreview(buffer, safeName, declaredType, this.maxTextPreviewBytes);
    const meta = detected || pdf || text;
    if (!meta) {
      throw new AttachmentError("不支持的附件类型。仅允许文本、CSV、JSON、PNG、JPEG、GIF、WebP 和 PDF。", "unsupported_file_type", 415);
    }
    const record = {
      id: `file_${randomUUID().replaceAll("-", "")}`,
      object: "file",
      purpose: "chat_attachment",
      bytes: buffer.length,
      filename: safeName,
      mime: meta.mime,
      kind: meta.kind,
      status: "ready",
      sha256: createHash("sha256").update(buffer).digest("hex"),
      createdAt: Date.now(),
      ownerHash,
      preview: meta.preview || {},
      image: detected ? { width: detected.width, height: detected.height } : undefined,
      warnings: meta.kind === "pdf" && !meta.preview?.text ? ["未从 PDF 抽取到文字；原件仅提供下载。"] : [],
    };
    const metaFile = this.metaPath(record.id);
    const blobFile = this.blobPath(record.id);
    fs.writeFileSync(blobFile, buffer, { mode: 0o600 });
    fs.writeFileSync(metaFile, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(blobFile, 0o600);
    fs.chmodSync(metaFile, 0o600);
    this.totalBytes += buffer.length;
    this.cache.set(record.id, record);
    while (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value);
    return record;
  }

  metaPath(id) {
    if (!FILE_ID_RE.test(id)) throw new AttachmentError("附件 ID 无效。", "invalid_attachment_id", 400);
    return path.join(this.dir, `${id}.json`);
  }

  blobPath(id) {
    if (!FILE_ID_RE.test(id)) throw new AttachmentError("附件 ID 无效。", "invalid_attachment_id", 400);
    return path.join(this.dir, `${id}.bin`);
  }

  get(id) {
    const cached = this.cache.get(id);
    if (cached) return validateRecord(cached);
    const metaFile = this.metaPath(id);
    if (!fs.existsSync(metaFile)) throw new AttachmentError("附件不存在。", "attachment_not_found", 404);
    let record;
    try { record = JSON.parse(fs.readFileSync(metaFile, "utf8")); } catch {
      throw new AttachmentError("附件元数据无法读取。", "attachment_corrupt", 500);
    }
    this.cache.set(id, record);
    while (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value);
    return validateRecord(record);
  }

  getOwned(id, ownerHash) {
    const record = this.get(id);
    if (!ownerHash || record.ownerHash !== ownerHash) {
      throw new AttachmentError("附件不存在。", "attachment_not_found", 404);
    }
    return record;
  }

  readBlob(id) {
    const record = this.get(id);
    return { record, buffer: fs.readFileSync(this.blobPath(id)) };
  }

  summary(record) {
    return {
      type: "file",
      fileId: record.id,
      name: record.filename,
      mime: record.mime,
      kind: record.kind,
      bytes: record.bytes,
      sha256: record.sha256,
      previewAvailable: record.kind !== "image",
      image: record.image,
      pages: record.preview?.pages || 0,
      warnings: record.warnings || [],
    };
  }

  preview(id) {
    const record = this.get(id);
    return {
      id: record.id,
      name: record.filename,
      mime: record.mime,
      kind: record.kind,
      bytes: record.bytes,
      ...(record.image ? { image: record.image } : {}),
      preview: record.preview || {},
      warnings: record.warnings || [],
    };
  }
}

export { FILE_ID_RE, cleanFilename, detectImage, extractPdfText, parseCsv };
