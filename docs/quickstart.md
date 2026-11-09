# 启动与运行

本文覆盖启动、健康检查、正常停止和重启操作。架构、协议和安全细节见 [README](../README.md) 与 [deployment.md](deployment.md)。

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

程序只读取 `config.jsonc`。调用密钥不写在这里；启动并登录后，在顶部「API 密钥」
生成一个，再交给调用方。

启动成功时终端会显示：

```text
能工智人 (nenggong-zhiren) v0.6.4 listening on 0.0.0.0:7355
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

保存密码后登录。顶部导航是统一主页面，坐席和各管理功能都作为子页面切换：

主页面一级导航为：**坐席、概览、记录、管理、设置**。教程移到右上角帮助入口；旧地址保留兼容跳转。

概览、记录、管理使用统一二级 Hub；一级导航保持当前项高亮，二级菜单位于 Hub 标题右侧并使用独立的下划线选中态。首屏加载后会按空闲时间预载相邻二级页面，悬停或聚焦其他标签时按需预载；切换时复用已加载的 iframe。环境页不会自动预载，避免提前触发 worker 探测。静态 CSS/JS 使用 ETag 条件缓存，图片使用长缓存，减少重复打开页面的等待。

- `/console`：坐席工作台；
- `/console/overview`：管理员概览 Hub，包含实时状态、用量、环境三个标签；
- `/console/records`：管理员记录 Hub，包含历史票据、审计日志和请求检查；
- `/console/admin`：管理员管理 Hub，包含用户、模型、API 密钥；
- `/console/settings`：所有回复员可管理自己的个性化设置；管理员另外管理运行参数、功能开关、AI 辅助、安全和系统信息（含服务控制）；
- 坐席工作台支持快捷回复模板和票据转交；模板保存在当前浏览器。
- 坐席页采用会话中心布局：左侧队列，中间单一会话时间线，底部回复编辑区，右侧上下文（资料 / 当前发送 / 工具 / AI / 更多）。
- 「资料 → 请求详情」只显示协议、模型、请求大小、工具、消息、快照等关键字段，并提供「在请求检查中打开」；独立请求检查页支持结构图、折叠 JSON、字段跳转和同会话自动筛选。
- 管理员可在「设置 → 系统信息」查看进程状态、复制诊断信息，并重启或结束服务；结束服务不会自动拉起，生产环境应由 systemd 或容器托管。
- 回复草稿上方的快捷栏默认为「AI 生成 / AI 引导」，可在个性化设置中自由增删、排序和改名，最多 15 项；支持 AI 动作、页面跳转、信息显示（内存/运行时长/队列/AI 结果数）；配置只影响当前账号；
- 每次 AI 生成结果不再自动写入草稿或工具，而是作为独立卡片加入右侧 AI 子页；同一票据可以保留多张结果卡片，只能选中一张；卡片显示思考、正文和工具调用；
- AI 生成期间 AI 子页显示详细状态：请求阶段、动态已用时、任务类型、票据模型、输入消息数/字符数、`max_tokens`（如请求指定）、生成引导和开始时间；结果返回后状态隐藏并显示结果卡片；
- 每张 AI 结果卡片带独立「详情」，显示该次生成的状态、耗时、输入规模、正文/思考字符数、工具调用、结束原因和 token usage；卡片随票据持久化（最多 20 张），刷新或重启后仍可复盘；未认领票据也可查看，但填入/追加需先认领；不提供应用级每日/时长/字符限制或翻倍生成；
- AI 子页的「填入」会替换当前全部草稿和工具调用，「追加」会把选中结果追加到当前草稿和工具调用之后；生成期间输入框保持可编辑；
- 回复编辑区高度可拖动调整，并支持一键清空草稿、AI 结果和待发送工具；
- 可滚动会话右侧持续显示 VS Code 风格微缩总览，不随鼠标移入/移出隐藏；没有可滚动内容时自动隐藏，且不占用消息宽度；短会话微缩内容整体适配，长会话保持可滚动，宽视口滑块直接覆盖在微缩图上，底部可一键「回到最新」；
- 按 `Ctrl/Cmd+K` 可调整微缩布局、滑块显示和语义聚合；聚焦微缩条后可用方向键、PageUp/PageDown、Home/End 导航；会话与上下文之间的分隔条可调整宽度；
- 桌面按 `Ctrl/Cmd+K` 打开命令面板；票据标题行「收起队列」释放横向空间，命令面板可切换紧凑密度。
- 设置页按左侧分类切换到右侧子页面：个性化、运行参数、功能开关、AI 辅助、安全和系统信息；个性化中的「快捷栏」只影响当前账号。

### 可选媒体 worker

图片重编码和 PDF 页图预览不是主流程依赖。服务只检查 `config.jsonc` 的 `workers` 段中明确配置的路径，不会扫描目录：

```jsonc
"workers": {
  "python": "python3",
  "imageWorker": "scripts/normalize-image.py",
  "pdfWorker": "scripts/render-pdf-page.py",
  "probeTimeoutMs": 2500
}
```

- 图片 worker 需要 Python 3 + Pillow；缺失时跳过重编码，上传仍可用；
- PDF worker 需要 `pypdfium2`；缺失时 PDF 上传、文字预览和下载仍可用，页图预览不可用；
- 两个路径都可以改成外部绝对路径或留空禁用；
- 修改后重启服务，然后在管理员「环境」页查看探测结果。

这两个 Python 脚本不随服务自带，如要从其他目录使用，手动配置绝对路径即可。

### 坐席页布局

- **中间时间线**：调用方消息、上下文、已发送思考/正文和工具调用按时间顺序出现；
- **底部回复编辑区**：草稿、AI 生成/引导、清空和发送；
- **右侧上下文**：资料、工具、AI 建议、备注/路由；
- **左侧队列**：待认领、进行中、最近结束和筛选。

> 还没有调用密钥时服务仍能启动，但 `/v1/*` 会拒绝所有调用方；先生成一个密钥即可。

## 3. 首次启动会创建什么

| 文件/目录 | 内容 | 是否随包发布 |
| --- | --- | --- |
| `config.jsonc` | 监听地址、端口、超时、模型名等本地运行配置 | 不随包发布；从 `config.example.jsonc` 复制 |
| `users.json` | 管理员/回复员的密码哈希、角色、模型权限、创建时间 | 否，仅保留本机 |
| `api-keys.json` | 调用密钥哈希、名称、配额和使用时间 | 否，仅保留本机 |
| `state.db` | SQLite 状态库：票据、幂等记录、SSE 恢复数据 | 否，仅保留本机 |
| `history.db` | SQLite + FTS5 历史索引 | 否，仅保留本机 |
| `usage.json` | 各密钥的分钟/日/月请求计数与每日历史 | 否，仅保留本机 |
| `settings.json` | 设置页保存的覆盖值和功能开关 | 否，仅保留本机 |
| `audit.log` | 登录、账号、密钥、设置和票据操作 | 否，仅保留本机 |
| `models.json` | 运行时模型注册表，首次启动自动生成 | 否，仅保留本机 |
| 日志 | 默认 stdout；建议重定向到项目目录外 | 否 |

活动票据、认领状态和 SSE 日志会写入 SQLite `state.db`，历史索引写入 `history.db`，服务重启后恢复；登录会话和限速计数在内存。没有 `node:sqlite` 时回退旧状态文件。带 `Idempotency-Key` 的调用方可以重连未完成票据；用户、密钥、用量、设置、审计和历史保留。

管理员密码只保存哈希。忘记密码时用 CLI 重置：

```bash
node scripts/user.mjs passwd admin
```

如果服务正在运行，文件变化会被热重载；该账号旧会话失效，重新登录即可。

## 4. 三种运行方式

### 4.1 本机前台运行

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

# 4. 调用方 key 有效（在网页「API 密钥」里生成）
curl -fsS http://127.0.0.1:7355/v1/models \
  -H 'Authorization: Bearer <CALLER_KEY>'

# 5. 监控指标可读
curl -fsS http://127.0.0.1:7355/metrics | head
```

然后在浏览器打开 `http://<LAN-IP>:7355/login`，管理员登录后默认进入概览 Hub；坐席、概览、记录、管理和设置从顶部导航进入，教程在帮助入口。

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

文件附件示例：

```bash
curl -X POST http://127.0.0.1:7355/v1/files \
  -H 'Authorization: Bearer <CALLER_KEY>' \
  -H 'Content-Type: text/plain' \
  -H 'X-Filename: notes.txt' \
  --data-binary @notes.txt
```

把返回的 `file_...` 放进消息的 `file` 内容块即可。HTML、SVG、Office、ZIP 和未知二进制会被拒绝。

## 7. 停止与重启

| 方式 | 停止 | 重启 |
| --- | --- | --- |
| 前台 | `Ctrl+C` | 再执行 `npm start` |
| nohup | `kill $(cat .../server.pid)` | 重新执行 nohup |
| systemd | `systemctl stop nenggong-zhiren` | `systemctl restart nenggong-zhiren` |

重启会重新加载运行状态：活动票据会恢复，带相同 `Idempotency-Key` 的调用方可以重连；登录会话和限速计数仍需重新建立。用户、密钥、用量、设置、审计、活动票据和已完成/幂等快照都会保留。

## 8. 常见问题

### 端口被占用 `EADDRINUSE`

```bash
ss -ltnp | grep 7355
```

改 `config.jsonc` 的 `server.port`，或停止占用端口的进程。不要用 `kill -9` 解决所有问题，先确认进程归属。

### 启动后 `/v1` 全部 401

- 先在网页「API 密钥」里生成密钥；
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
- 改完 DSH 配置后刷新模型选择器；DSH 侧使用标准 OpenAI 兼容配置即可，不会随项目发布单独的集成示例。

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
