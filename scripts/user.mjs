#!/usr/bin/env node
/**
 * 能工智人 · user administration CLI.
 *
 * Usage:
 *   node scripts/user.mjs list
 *   NGZR_USER_PASSWORD='...' node scripts/user.mjs add alice --role operator
 *   NGZR_USER_PASSWORD='...' node scripts/user.mjs passwd alice
 *   node scripts/user.mjs remove alice
 *
 * Web admin is the primary path; the CLI is for local administration/recovery.
 * `--password` is accepted for automation but lands in shell history.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthService, AuthError } from "../src/auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const usersFile = process.env.USERS_FILE || path.join(ROOT, "users.json");

function usage() {
  console.log(`能工智人 · 用户管理

  node scripts/user.mjs list
  NGZR_USER_PASSWORD='...' node scripts/user.mjs add <username> [--role operator|admin]
  NGZR_USER_PASSWORD='...' node scripts/user.mjs passwd <username>
  node scripts/user.mjs remove <username>

凭据文件：默认项目根目录 users.json（可用 USERS_FILE 覆盖路径）。
密码输入：NGZR_USER_PASSWORD 或 --password（Web 用户管理不需要命令行）。
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

function passwordFrom(args) {
  const direct = takeFlag(args, "--password");
  const password = direct ?? process.env.NGZR_USER_PASSWORD;
  if (!password) {
    throw new Error("缺少密码：设置 NGZR_USER_PASSWORD，或传 --password（不推荐）。");
  }
  return password;
}

function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (!command || command === "-h" || command === "--help") {
    usage();
    return;
  }

  const auth = new AuthService({ usersFile, secureCookies: false });
  auth.init();

  try {
    if (command === "list") {
      const users = auth.listUsers();
      if (users.length === 0) {
        console.log("（暂无用户）");
        return;
      }
      for (const user of users) {
        console.log(
          `${user.username}\t${user.role}\t${new Date(user.createdAt).toISOString()}`,
        );
      }
      return;
    }

    if (command === "add") {
      const role = takeFlag(args, "--role") || "operator";
      const username = args[0];
      if (!username) throw new Error("用法：add <username> [--role operator|admin]");
      const password = passwordFrom(args);
      const user = auth.addUser(username, password, role);
      console.log(`已创建用户 ${user.username}（${user.role}）`);
      return;
    }

    if (command === "passwd") {
      const username = args[0];
      if (!username) throw new Error("用法：passwd <username>");
      const password = passwordFrom(args);
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

    throw new Error(`未知命令：${command}`);
  } finally {
    auth.close();
  }
}

try {
  main();
} catch (error) {
  if (error instanceof AuthError) {
    console.error(`错误（${error.code}）：${error.message}`);
  } else {
    console.error(`错误：${error.message}`);
  }
  process.exitCode = 1;
}
