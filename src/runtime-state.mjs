/** Small persisted status file for restart supervision. */

import fs from "node:fs";
import path from "node:path";

export function readRestartStatus(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeRestartStatus(file, patch) {
  let next = {};
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const previous = readRestartStatus(file);
    next = { ...(previous && typeof previous === "object" ? previous : {}), ...patch };
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  } catch {
    return next;
  }
  return next;
}
