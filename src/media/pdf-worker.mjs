/** Optional PDF page rasterizer. The caller treats failure as "preview unavailable". */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function renderPdfPageBuffer(buffer, page, {
  script = path.join(process.cwd(), "scripts", "render-pdf-page.py"),
  maxBytes = 4 * 1024 * 1024,
  timeoutMs = 12000,
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ngzr-pdf-"));
  const input = path.join(dir, "input.pdf");
  const output = path.join(dir, "page.png");
  try {
    fs.writeFileSync(input, buffer, { mode: 0o600 });
    const { stdout } = await execFileAsync(
      "python3",
      [script, input, output, String(page), String(maxBytes)],
      {
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
        env: { PATH: process.env.PATH || "/usr/bin:/bin", LANG: "C" },
      },
    );
    const info = JSON.parse(String(stdout || "").trim());
    if (info.mime !== "image/png") throw new Error("invalid PDF worker output");
    const image = fs.readFileSync(output);
    if (!image.length || image.length > maxBytes) throw new Error("PDF page image too large");
    return { buffer: image, mime: "image/png", width: Number(info.width) || 0, height: Number(info.height) || 0 };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
