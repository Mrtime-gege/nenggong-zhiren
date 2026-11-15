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

function probeError(error) {
  const raw = String(error?.stderr || error?.message || "").trim();
  const last = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) || "";
  if (/ModuleNotFoundError|No module named/i.test(last)) return "未安装";
  return cleanMessage(last || "不可用").slice(0, 240);
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
    return { ok: false, version: "", error: probeError(error) };
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

const REPO_URL = "https://github.com/Mrtime-gege/nenggong-zhiren";

function installInfo(python) {
  const venvPip = process.platform === "win32" ? ".venv\\Scripts\\pip.exe" : ".venv/bin/pip";
  return {
    image: {
      package: "Pillow",
      command: `${python} -m venv .venv && ${venvPip} install Pillow`,
      uninstallCommand: `${venvPip} uninstall -y Pillow`,
      pypi: "https://pypi.org/project/Pillow/",
      project: "https://github.com/python-pillow/Pillow",
      script: `${REPO_URL}/blob/main/scripts/normalize-image.py`,
      scripts: `${REPO_URL}/tree/main/scripts`,
    },
    pdf: {
      package: "pypdfium2",
      command: `${python} -m venv .venv && ${venvPip} install pypdfium2`,
      uninstallCommand: `${venvPip} uninstall -y pypdfium2`,
      pypi: "https://pypi.org/project/pypdfium2/",
      project: "https://github.com/pypdfium2-team/pypdfium2",
      script: `${REPO_URL}/blob/main/scripts/render-pdf-page.py`,
      scripts: `${REPO_URL}/tree/main/scripts`,
    },
    workers: {
      scripts: `${REPO_URL}/tree/main/scripts`,
      docs: `${REPO_URL}/blob/main/docs/deployment.md#可选媒体-worker`,
    },
  };
}

export async function probeEnvironment(config = {}) {
  const python = String(config.python || "").trim();
  const basePython = String(config.basePython || config.python || "python3").trim() || "python3";
  const timeoutMs = Math.max(250, Math.min(30_000, Number(config.probeTimeoutMs) || 2500));
  const pythonInfo = python
    ? await runPython(python, ["--version"], timeoutMs)
    : { ok: false, version: "", error: config.external ? "外部解释器未配置" : "未创建项目 .venv" };
  const sqlite = sqliteAvailable();
  const image = fileState(config.imageWorker);
  const pdf = fileState(config.pdfWorker);
  // Probe modules even when the worker file is absent so the admin page can
  // still report and uninstall an installed-but-unused dependency.
  const pil = pythonInfo.ok
    ? await moduleProbe(python, "PIL", timeoutMs)
    : { available: false, version: "", error: pythonInfo.error || "未安装" };
  const pdfium = pythonInfo.ok
    ? await moduleProbe(python, "pypdfium2", timeoutMs)
    : { available: false, version: "", error: pythonInfo.error || "未安装" };

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
        configured: Boolean(python),
        executable: python,
        base: basePython,
        external: Boolean(config.external),
        managed: !config.external,
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
    install: installInfo(basePython),
  };
}
