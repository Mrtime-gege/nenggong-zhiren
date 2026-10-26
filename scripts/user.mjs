#!/usr/bin/env node
/**
 * 能工智人 · 账号管理命令行。
 *
 * 所有路径来自 config.jsonc；不读取环境变量，也不从命令行接收密码。
 * 密码只在终端提示后输入；非交互运行时从标准输入读取。
 */

import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.mjs";
import { AuthService, AuthError } from "../src/auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.log(`能工智人 · 用户管理

  node scripts/user.mjs list
  node scripts/user.mjs add <username> [--role operator|admin]
  node scripts/user.mjs passwd <username>
  node scripts/user.mjs remove <username>

路径来自项目根目录 config.jsonc 的 storage.usersFile。
执行 add/passwd 时会提示输入密码；密码不会出现在命令历史里。
`);
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} 需要一个值。`);
  }
  args.splice(index, 2);
  return value;
}

function readStdinPassword() {
  try {
    return readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

function promptPassword(label) {
  if (!process.stdin.isTTY) return Promise.resolve(readStdinPassword());
  return new Promise((resolve, reject) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    const previousRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";

    const cleanup = () => {
      stdin.setRawMode(Boolean(previousRaw));
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("已取消。"));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= " ") value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command || command === "-h" || command === "--help") {
    usage();
    return;
  }

  const auth = new AuthService({
    usersFile: config.storage.usersFile,
    sessionTtlMs: config.auth.sessionTtlMs,
    sessionIdleMs: config.auth.sessionIdleMs,
    loginRateWindowMs: config.auth.loginRateWindowMs,
    loginIpMaxFailures: config.auth.loginIpMaxFailures,
    loginUserMaxFailures: config.auth.loginUserMaxFailures,
    secureCookies: false,
  });
  auth.init();

  try {
    if (command === "list") {
      const users = auth.listUsers();
      if (users.length === 0) {
        console.log("（暂无用户）");
        return;
      }
      for (const user of users) {
        console.log(`${user.username}\t${user.role}\t${new Date(user.createdAt).toISOString()}`);
      }
      return;
    }

    if (command === "add") {
      const role = takeFlag(args, "--role") || "operator";
      const username = args[0];
      if (!username) throw new Error("用法：add <username> [--role operator|admin]");
      const password = await promptPassword(`为 ${username} 输入密码（至少 12 位）：`);
      const user = auth.addUser(username, password, role);
      console.log(`已创建用户 ${user.username}（${user.role}）`);
      return;
    }

    if (command === "passwd") {
      const username = args[0];
      if (!username) throw new Error("用法：passwd <username>");
      const password = await promptPassword(`为 ${username} 输入新密码（至少 12 位）：`);
      auth.setPassword(username, password);
      console.log(`已更新 ${username} 的密码，现有会话已失效。`);
      return;
    }

    if (command === "remove") {
      const username = args[0];
      if (!username) throw new Error("用法：remove <username>");
      auth.removeUser(username);
      console.log(`已删除用户 ${username}。`);
      return;
    }

    throw new Error(`未知命令：${command}。可用命令：list/add/passwd/remove。`);
  } finally {
    auth.close();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof AuthError) {
    console.error(`错误（${error.code}）：${error.message}`);
  } else {
    console.error(`错误：${error.message}`);
  }
  process.exitCode = 1;
}
