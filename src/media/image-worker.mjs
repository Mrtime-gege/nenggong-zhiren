/** Optional isolated image normalization. Falls back to the original buffer. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function normalizeImageBuffer(buffer, {
  script = path.join(process.cwd(), "scripts", "normalize-image.py"),
  maxBytes = 10 * 1024 * 1024,
  timeoutMs = 8000,
  maxDimension = 4096,
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ngzr-img-"));
  const input = path.join(dir, "input.bin");
  const output = path.join(dir, "output.bin");
  try {
    fs.writeFileSync(input, buffer, { mode: 0o600 });
    const { stdout } = await execFileAsync("python3", [script, input, output, String(maxBytes), String(maxDimension)], {
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      env: { PATH: process.env.PATH || "/usr/bin:/bin", LANG: "C" },
    });
    const info = JSON.parse(String(stdout || "").trim());
    if (!["image/png", "image/jpeg"].includes(info.mime)) throw new Error("invalid worker mime");
    const normalized = fs.readFileSync(output);
    if (!normalized.length || normalized.length > maxBytes) throw new Error("normalized image too large");
    return { buffer: normalized, mime: info.mime, width: Number(info.width) || 0, height: Number(info.height) || 0 };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
