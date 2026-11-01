#!/usr/bin/env node
/**
 * Build a whitelist-only release archive.
 *
 * Adding a release file requires an explicit maintainer decision:
 * update release-whitelist.txt only after approval, then run this script.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WHITELIST = path.join(ROOT, "release-whitelist.txt");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const outIndex = args.indexOf("--out");
if (!checkOnly && (outIndex < 0 || !args[outIndex + 1])) {
  console.error("[release] usage: node scripts/build-release.mjs --out <archive.tar.gz> | --check");
  process.exit(1);
}
const output = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : "";

function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}

if (!existsSync(WHITELIST)) fail("release-whitelist.txt is missing");
const files = readFileSync(WHITELIST, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

if (!files.length) fail("release whitelist is empty");
const seen = new Set();
for (const file of files) {
  if (path.isAbsolute(file) || file.includes("..") || path.posix.normalize(file) !== file) {
    fail(`unsafe whitelist path: ${file}`);
  }
  if (seen.has(file)) fail(`duplicate whitelist path: ${file}`);
  seen.add(file);
  if (!existsSync(path.join(ROOT, file))) fail(`whitelisted file missing: ${file}`);
}

const forbidden = [
  "test/",
  "examples/",
  "integrations/",
  "docs/archive/",
  "config.jsonc",
  "users.json",
  "api-keys.json",
  "state.db",
  "history.db",
  "settings.json",
  "models.json",
  "audit.log",
  "attachments/",
  ".env",
];
for (const file of files) {
  const hit = forbidden.find((prefix) => file === prefix || file.startsWith(prefix));
  if (hit) fail(`forbidden file in whitelist: ${file}`);
}

const version = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const prefix = `nenggong-zhiren-${version}`;
console.log(`[release] version=${version} files=${files.length}`);

if (checkOnly) {
  console.log("[release] whitelist check passed");
  process.exit(0);
}

execFileSync("tar", [
  "-czf", output,
  "--transform", `s,^,${prefix}/,`,
  "-C", ROOT,
  ...files,
], { stdio: "inherit" });
const hash = createHash("sha256").update(readFileSync(output)).digest("hex");
console.log(`[release] archive=${output}`);
console.log(`[release] sha256=${hash}`);
console.log("[release] optional files excluded: examples/ integrations/ test/ media-worker scripts");
