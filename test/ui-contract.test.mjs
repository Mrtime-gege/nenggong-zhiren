import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("console loads split UI modules in dependency order", () => {
  const html = read("public/console.html");
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  const required = [
    "/navigation.js",
    "/console-utils.js",
    "/console-ai-cards.js",
    "/console-queue.js",
    "/console-shortcuts.js",
    "/console-detail.js",
    "/console.js",
  ];
  const positions = required.map((src) => scripts.indexOf(src));
  assert.ok(positions.every((position) => position >= 0), `missing script: ${required.filter((_, i) => positions[i] < 0).join(", ")}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.doesNotMatch(html, /id="usersModal"|id="keysModal"/);
});

test("settings and console do not expose removed AI limit fields", () => {
  const settings = read("public/settings.html");
  const consoleJs = read("public/console.js");
  for (const token of ["aiMaxInput", "aiMaxOutput", "aiDailyRequests", "aiDailyTokens", "aiDailyTotal", "aiFirstOutputTimeout"]) {
    assert.doesNotMatch(settings, new RegExp(token), token);
  }
  assert.doesNotMatch(consoleJs, /aiLimitBar|ai-card-double|doubleLimits/);
});

test("hub markup keeps the frame stack and no legacy breadcrumb", () => {
  const hub = read("public/hub.html");
  assert.match(hub, /id="hubFrames"/);
  assert.match(hub, /id="hubFrame"/);
  assert.doesNotMatch(hub, /hub-breadcrumb/);
});

test("navigation registry has exactly five primary entries", () => {
  const navigation = read("public/navigation.js");
  for (const label of ["坐席", "概览", "记录", "管理", "设置"]) assert.match(navigation, new RegExp(`label: "${label}"`));
  assert.doesNotMatch(navigation, /label: "教程"/);
  assert.match(navigation, /requestIdleCallback/);
  assert.match(navigation, /pointerenter/);
});

test("release whitelist ships every split frontend module", () => {
  const whitelist = read("release-whitelist.txt");
  for (const file of [
    "public/console-utils.js",
    "public/console-ai-cards.js",
    "public/console-queue.js",
    "public/console-shortcuts.js",
    "public/console-detail.js",
    "src/ai/cards.mjs",
    "src/http/pages.mjs",
    "src/http/public-assets.mjs",
    "src/text.mjs",
  ]) {
    assert.match(whitelist, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), file);
  }
});

test("example config has no removed AI usage file and package stays dependency-free", () => {
  const config = read("config.example.jsonc");
  assert.doesNotMatch(config, /aiUsageFile/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
