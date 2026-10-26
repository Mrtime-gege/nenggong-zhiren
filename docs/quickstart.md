# 启动与运行

本文只回答一件事：**怎么把能工智人跑起来、确认它正常、再安全地停掉或重开**。
架构、协议和安全细节见 [README](../README.md) 与 [deployment.md](deployment.md)。

## 1. 先决条件

- Linux / macOS / WSL；Windows 原生环境建议使用 WSL。
- Node.js **≥ 20**（验证使用 Node 24）。
- 不需要 `npm install`，项目没有第三方运行时依赖。
- 默认端口 **7355**；启动前确认没有被其他程序占用。

```bash
node -v
```

## 2. 最短启动流程

```bash
cd nenggong-zhiren
cp config.example.jsonc config.jsonc
```

编辑 `config.jsonc`，至少确认：

```jsonc
"host": "0.0.0.0",
"port": 7355
```

然后：

```bash
npm start
# 等价于 node server.mjs
```

程序只读取 `config.jsonc`。调用密钥不写在这里；启动并登录后，在网页右上角「调用密钥」
生成一个，再交给调用方。

启动成功时终端会显示：

```text
能工智人 (nenggong-zhiren) v0.4.0 listening on 0.0.0.0:7355
  login       http://127.0.0.1:7355/login
  console     http://127.0.0.1:7355/console
  LAN         http://<LAN-IP>:7355/login
  caller keys ...
  models      human-1, human-1-fast
  users       ...
  users file  users.json
```

浏览器打开 **`/login`**。首次启动（没有 `users.json`）会打印一次随机管理员密码：

```text
============================================================
  初始管理员账号已生成（只显示这一次，请立即保存并修改密码）
  username: admin
  password: XXXXXXXXXXXXXXXXXXXXXXX
============================================================
```

保存密码后登录。用户和密钥现在有独立页面：

- `/console/users`：添加回复员/管理员、改角色、重置密码；
- `/console/keys`：生成调用密钥，可指定自定义密钥，并设置过期时间、允许的模型、
  分钟/日/月请求配额和并发上限。

> 还没有调用密钥时服务仍能启动，但 `/v1/*` 会拒绝所有调用方；先生成一个密钥即可。

## 3. 首次启动会创建什么

| 文件/目录 | 内容 | 是否随包发布 |
| --- | --- | --- |
| `config.jsonc` | 监听地址、端口、超时、模型名等运行配置 | 可以，不含密钥 |
| `users.json` | 管理员/回复员的密码哈希、角色、创建时间 | 否，仅保留本机 |
| `api-keys.json` | 调用密钥哈希、名称、配额和使用时间 | 否，仅保留本机 |
| `state.json` | 已完成请求和幂等记录，用于重启恢复 | 否，仅保留本机 |
| `usage.json` | 各密钥的分钟/日/月请求计数 | 否，仅保留本机 |
| 日志 | 默认 stdout；建议重定向到项目目录外 | 否 |

票据、登录会话和幂等记录都在内存里；**重启进程会丢未完成票据和会话**，但用户文件保留。

管理员密码只保存哈希。忘记密码时用 CLI 重置：

```bash
node scripts/user.mjs passwd admin
```

如果服务正在运行，文件变化会被热重载；该账号旧会话失效，重新登录即可。

## 4. 三种运行方式

### 4.1 前台开发

```bash
npm start
```

适合本机调试；`Ctrl+C` 停止。修改代码后可用：

```bash
npm run dev
```

`--watch` 只会重启 Node 进程，不改变 `users.json` 的持久化。

### 4.2 后台 nohup

```bash
mkdir -p "$HOME/.local/state/nenggong-zhiren"
nohup node server.mjs >"$HOME/.local/state/nenggong-zhiren/server.log" 2>&1 &
echo $! >"$HOME/.local/state/nenggong-zhiren/server.pid"
```

看日志/停止：

```bash
tail -f "$HOME/.local/state/nenggong-zhiren/server.log"
kill "$(cat "$HOME/.local/state/nenggong-zhiren/server.pid")"
```

> 后台启动前确认 `config.jsonc` 已保存；程序不会从环境变量或启动参数读取运行配置。

### 4.3 systemd（生产推荐）

完整 unit、权限和反向代理见 [deployment.md](deployment.md)。最短流程：

```ini
[Unit]
Description=Nenggong Zhiren human provider
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nenggong
Group=nenggong
WorkingDirectory=/opt/nenggong-zhiren
ExecStart=/usr/bin/node /opt/nenggong-zhiren/server.mjs
Restart=on-failure
RestartSec=2
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/nenggong-zhiren
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nenggong-zhiren
sudo systemctl status nenggong-zhiren
journalctl -u nenggong-zhiren -f
```

停止/重启：

```bash
sudo systemctl stop nenggong-zhiren
sudo systemctl restart nenggong-zhiren
```

## 5. 启动后检查清单

```bash
# 1. 进程在监听
ss -ltnp | grep 7355

# 2. 健康检查
curl -fsS http://127.0.0.1:7355/healthz

# 3. 登录页可访问
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7355/login

# 4. 调用方 key 有效（在网页「调用密钥」里生成）
curl -fsS http://127.0.0.1:7355/v1/models \
  -H 'Authorization: Bearer <CALLER_KEY>'
```

然后在浏览器打开 `http://<LAN-IP>:7355/login`，登录后应该看到队列和底部命令栏。

## 6. 第一个真实请求

```bash
curl -N http://127.0.0.1:7355/v1/chat/completions \
  -H 'Authorization: Bearer <CALLER_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "human-1",
    "stream": true,
    "messages": [{"role": "user", "content": "你好，请介绍一下你自己"}]
  }'
```

请求会停在队列里，直到坐席在 `/console` 认领并完成。没有坐席回答时，
`queue.waitTimeoutMs` 后返回超时错误。

## 7. 停止与重启

| 方式 | 停止 | 重启 |
| --- | --- | --- |
| 前台 | `Ctrl+C` | 再执行 `npm start` |
| nohup | `kill $(cat .../server.pid)` | 重新执行 nohup |
| systemd | `systemctl stop nenggong-zhiren` | `systemctl restart nenggong-zhiren` |

重启会清空内存队列和会话；调用方会收到连接错误或超时，需要重试。`users.json` 不会丢。

## 8. 常见问题

### 端口被占用 `EADDRINUSE`

```bash
ss -ltnp | grep 7355
```

改 `config.jsonc` 的 `server.port`，或停止占用端口的进程。不要用 `kill -9` 解决所有问题，先确认进程归属。

### 启动后 `/v1` 全部 401

- 先在网页「调用密钥」里生成密钥；
- OpenAI 格式用 `Authorization: Bearer <key>`，Anthropic 格式用 `x-api-key: <key>`；
- 确认密钥没有在网页里被停用或删除。

### 登录页要求账号，但不知道密码

- `users.json` 存在时，首次随机密码不会再次打印；
- 用管理员 CLI 重置：`node scripts/user.mjs passwd admin`；
- 如果忘记了全部管理员密码，停止服务、备份 `users.json`，用 CLI 新建一个管理员
  （例如 `recovery-admin`），再用它登录并重置原管理员；不要直接删除用户文件，否则会
  丢失所有账号哈希。

### 登录被拒绝 `invalid_origin`

- 直接访问 `http://<LAN-IP>:7355/login` 并刷新页面；
- 通过前置代理时，把实际 Host 加到 `config.jsonc` 的 `server.trustedHosts`；

### DSH 报 401 / 模型不可用

- DSH 的 `HUMAN_PROVIDER_KEY` 必须等于网页里生成的某个调用密钥；
- `baseURL` 必须是 `http://127.0.0.1:7355/v1`（包含 `/v1`）；
- 改完 DSH 配置后刷新模型选择器；详见 [DSH 集成](../integrations/dsh/README.md)。

### 权限错误 / 无法写入 users.json

```bash
ls -l users.json
chmod 600 users.json
```

运行用户必须对项目根目录有写权限；systemd 部署时检查 `ReadWritePaths`。

## 9. 安全提醒

- 默认是 **HTTP**；登录密码在局域网明文传输。公开使用前在 `config.jsonc` 的 `tls`
  里启用 HTTPS，或在前面放一层 HTTPS 代理。
- `users.json` 含密码哈希，仍按敏感文件处理；不要提交、不要打包公开。
- 调用方 key 和坐席密码分开管理；上线前替换所有示例值。
- 不要把 `7355` 直接暴露到公网；至少加防火墙、TLS 和访问控制。

更完整的部署、反向代理、备份和安全说明见 [deployment.md](deployment.md) 和
[security.md](security.md)。
