/**
 * Optional runtime capability probe.
 *
 * The probe intentionally checks only the explicitly configured Python binary,
 * worker paths and Python modules. It never walks the project tree, the home
 * directory or the host filesystem.
 */

import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function sqliteAvailable() {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

function fileState(file) {
  if (!file) return { configured: false, exists: false, file: "", bytes: 0 };
  try {
    const stat = fs.statSync(file);
    return {
      configured: true,
      exists: stat.isFile(),
      file,
      bytes: stat.isFile() ? stat.size : 0,
    };
  } catch {
    return { configured: true, exists: false, file, bytes: 0 };
  }
}

function cleanMessage(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function runPython(python, args, timeoutMs) {
  try {
    const { stdout, stderr } = await execFileAsync(python, args, {
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
      env: { PATH: process.env.PATH || "/usr/bin:/bin", LANG: "C" },
    });
    return { ok: true, version: cleanMessage(`${stdout || ""} ${stderr || ""}`) };
  } catch (error) {
    return { ok: false, version: "", error: cleanMessage(error.stderr || error.message) };
  }
}

async function moduleProbe(python, moduleName, timeoutMs) {
  const result = await runPython(
    python,
    ["-c", `import ${moduleName} as m; print(getattr(m, "__version__", "ok"))`],
    timeoutMs,
  );
  return result.ok
    ? { available: true, version: result.version }
    : { available: false, version: "", error: result.error };
}

export async function probeEnvironment(config = {}) {
  const python = String(config.python || "python3").trim() || "python3";
  const timeoutMs = Math.max(250, Math.min(30_000, Number(config.probeTimeoutMs) || 2500));
  const pythonInfo = await runPython(python, ["--version"], timeoutMs);
  const sqlite = sqliteAvailable();
  const image = fileState(config.imageWorker);
  const pdf = fileState(config.pdfWorker);
  const pil = pythonInfo.ok && image.exists
    ? await moduleProbe(python, "PIL", timeoutMs)
    : { available: false, version: "", error: image.exists ? "" : "worker not configured" };
  const pdfium = pythonInfo.ok && pdf.exists
    ? await moduleProbe(python, "pypdfium2", timeoutMs)
    : { available: false, version: "", error: pdf.exists ? "" : "worker not configured" };

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      sqlite,
    },
    workers: {
      python: {
        configured: true,
        executable: python,
        available: pythonInfo.ok,
        version: pythonInfo.version,
        error: pythonInfo.error || "",
      },
      image: {
        ...image,
        available: pythonInfo.ok && image.exists && pil.available,
        dependency: "PIL",
        dependencyAvailable: pil.available,
        dependencyVersion: pil.version || "",
        error: pil.error || "",
      },
      pdf: {
        ...pdf,
        available: pythonInfo.ok && pdf.exists && pdfium.available,
        dependency: "pypdfium2",
        dependencyAvailable: pdfium.available,
        dependencyVersion: pdfium.version || "",
        error: pdfium.error || "",
      },
    },
    features: {
      imageNormalization: Boolean(pythonInfo.ok && image.exists && pil.available),
      pdfPagePreview: Boolean(pythonInfo.ok && pdf.exists && pdfium.available),
      historyIndex: sqlite,
    },
  };
}
