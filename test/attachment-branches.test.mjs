import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AttachmentError, AttachmentStore, detectImage, parseCsv } from "../src/data/attachments.mjs";

test("attachment image detectors cover GIF and WebP", () => {
  const gif = Buffer.alloc(12);
  gif.write("GIF89a", 0, "ascii");
  gif.writeUInt16LE(3, 6);
  gif.writeUInt16LE(4, 8);
  gif[11] = 0x3b;
  assert.deepEqual(detectImage(gif), { kind: "image", mime: "image/gif", width: 3, height: 4 });

  const webp = Buffer.alloc(32);
  webp.write("RIFF", 0, "ascii");
  webp.writeUInt32LE(24, 4);
  webp.write("WEBP", 8, "ascii");
  webp.write("VP8X", 12, "ascii");
  webp.writeUInt32LE(10, 16);
  webp.writeUIntLE(6, 24, 3);
  webp.writeUIntLE(8, 27, 3);
  assert.deepEqual(detectImage(webp), { kind: "image", mime: "image/webp", width: 7, height: 9 });
});

test("CSV parser honors column/row limits and quoted newlines", () => {
  const parsed = parseCsv('a,b,c\n1,"x\ny",3\n4,5,6', { maxRows: 1, maxColumns: 2 });
  assert.deepEqual(parsed.columns, ["a", "b"]);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], ["1", "x\ny"]);
  assert.equal(parsed.truncated, true);
  assert.deepEqual(parseCsv("a,b", { maxColumns: 1 }).rows, []);
});

test("AttachmentStore creates PDF previews and rejects active PDF content", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ngzr-pdf-unit-"));
  const store = new AttachmentStore({ dir, logger: { error() {} } }).init();
  try {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page /Count 1 >>\nstream\nBT (PDF unit) Tj ET\nendstream\nendobj");
    const record = store.create({ buffer: pdf, filename: "unit.pdf", declaredType: "application/pdf", ownerHash: "owner" });
    assert.equal(record.kind, "pdf");
    assert.match(store.preview(record.id).preview.text, /PDF unit/);
    assert.throws(
      () => store.create({ buffer: Buffer.from("%PDF-1.4 /JavaScript <<>>"), filename: "bad.pdf", declaredType: "application/pdf" }),
      (error) => error instanceof AttachmentError && error.code === "pdf_active_content",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
