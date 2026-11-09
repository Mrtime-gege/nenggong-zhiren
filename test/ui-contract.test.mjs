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

test("conversation and inspector scrollbars reserve a control-safe gutter", () => {
  const css = fs.readFileSync(path.join(ROOT, "public/console.css"), "utf8");
  assert.match(css, /padding-right:\s*82px/);
  assert.match(css, /padding-right:\s*60px/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
});

test("settings and console do not expose removed AI limit fields", () => {
  const settings = read("public/settings.html");
  const consoleJs = read("public/console.js");
  for (const token of ["aiMaxInput", "aiMaxOutput", "aiDailyRequests", "aiDailyTokens", "aiDailyTotal", "aiFirstOutputTimeout"]) {
    assert.doesNotMatch(settings, new RegExp(token), token);
  }
  assert.doesNotMatch(consoleJs, /aiLimitBar|ai-card-double|doubleLimits/);
});

test("settings exposes admin service controls", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/settings.html"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "public/admin-settings.js"), "utf8");
  assert.match(html, /id="systemRuntime"/);
  assert.match(html, /id="systemRestart"/);
  assert.match(html, /id="systemShutdown"/);
  assert.match(script, /loadSystemInfo/);
  assert.match(script, /controlService/);
});

test("standalone request inspector supports composite filters and related sessions", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/requests.html"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "public/admin-requests.js"), "utf8");
  assert.match(html, /id="requestFilters"/);
  assert.match(html, /id="requestProtocol"/);
  assert.match(html, /id="requestTools"/);
  assert.match(html, /id="requestSession"/);
  assert.match(html, /id="requestRows"/);
  assert.match(script, /function matches\(/);
  assert.match(script, /requestInspection/);
  assert.match(script, /relatedOnly/);
  const assets = fs.readFileSync(path.join(ROOT, "src/http/public-assets.mjs"), "utf8");
  assert.match(assets, /"\/requests\.html"/);
  assert.match(assets, /"\/admin-requests\.js"/);
});

test("ticket request inspector exposes raw and normalized views", () => {
  const detail = fs.readFileSync(path.join(ROOT, "public/console-detail.js"), "utf8");
  const consoleJs = fs.readFileSync(path.join(ROOT, "public/console.js"), "utf8");
  assert.match(detail, /request-inspector/);
  assert.match(detail, /原始请求/);
  assert.match(detail, /归一化请求/);
  assert.match(consoleJs, /function renderRequestInspector/);
  assert.match(consoleJs, /requestInspection/);
  const protocol = fs.readFileSync(path.join(ROOT, "docs/protocol.md"), "utf8");
  assert.match(protocol, /\/v1\/inspect\/openai/);
  assert.match(protocol, /\/v1\/inspect\/anthropic/);
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
