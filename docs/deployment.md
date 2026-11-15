# 部署

> 快速启动和常见运行问题见 [quickstart.md](quickstart.md)。

## 目标形态

默认：

```text
LAN browser ──HTTPS/HTTP──► 能工智人 :7355 ◄──HTTP── OpenAI-compatible caller (DSH/curl)
```

- 回复员通过浏览器访问 `http://<LAN-IP>:7355/login`（或 HTTPS 域名）。
- 调用方（DSH、curl 或任意 OpenAI 兼容客户端）访问 `http://127.0.0.1:7355/v1`。DSH 是可选调用方，不是运行时依赖。
- 账号/密码哈希保存在项目根目录 `users.json`，文件权限 `0600`，仅保留在本机，
  不要随项目公开。
- 票据、会话和日志不随项目发布；日志建议写到项目目录外。

## 1. 直接启动

```bash
cd /opt/nenggong-zhiren
cp config.example.jsonc config.jsonc
# 编辑 config.jsonc：监听地址、端口、超时、模型名等
node server.mjs

# 或
npm start
```

首次启动若还没有 `users.json`，终端会打印一次随机管理员密码。把它保存到密码管理器，
登录后可在 Web「用户管理」里添加回复员或改密，并在「调用密钥」里生成调用密钥。

### Windows + WSL mirrored 网络

WSL 使用 `networkingMode=mirrored` 时，Windows 和 WSL 共用同一个 LAN IP。
Windows 本机访问自己的 LAN IP 不会经过 WSL 的入站路径，因此需要 Windows portproxy：

```powershell
netsh interface portproxy add v4tov4 `
  listenaddress=<LAN-IP> listenport=7355 `
  connectaddress=127.0.0.1 connectport=7356

netsh interface portproxy add v4tov4 `
  listenaddress=127.0.0.1 listenport=7355 `
  connectaddress=127.0.0.1 connectport=7356

Restart-Service iphlpsvc
```

对应配置：

```jsonc
"server": {
  "host": "127.0.0.1",
  "port": 7356,
  "trustedHosts": ["127.0.0.1:7355", "<LAN-IP>:7355"]
}
```

浏览器跨域调用 `/v1` 时，必须按实际前端 Origin 配置 `server.corsOrigins`；默认空数组不授权跨域读取。远程 Prometheus 抓取 `/metrics` 时配置 `server.metricsToken`。

局域网入口是 Windows 的 `7355`，WSL 内部监听 `7356`。
不要同时让 WSL 监听 `7355`，否则 Windows portproxy 无法绑定该端口。

## 可选媒体 worker

基础的上传、文字预览和图片预览不需要额外依赖。以下能力都是可选的，且**只探测
`config.jsonc` 中明确配置的路径**，不扫描项目树或主机目录。管理员也可以在
`/console/overview?tab=environment` 的「可选功能」卡片里查看状态、复制安装/卸载命令或直接安装/卸载 Python 依赖。

安装地址：

- Pillow：PyPI <https://pypi.org/project/Pillow/> · 原项目 <https://github.com/python-pillow/Pillow>
- pypdfium2：PyPI <https://pypi.org/project/pypdfium2/> · 原项目 <https://github.com/pypdfium2-team/pypdfium2>
- worker 脚本：<https://github.com/Mrtime-gege/nenggong-zhiren/tree/main/scripts>

页面上的「安装依赖」优先在项目根目录创建或复用 `.venv`，然后用 `.venv/bin/pip` 安装；
不会直接修改系统 Python。Kali/Debian 需要先安装 venv 模块：

```bash
sudo apt install python3-venv
```

也可以手工执行：

```bash
python3 -m venv .venv
.venv/bin/pip install Pillow pypdfium2
```

worker 会自动使用 `.venv/bin/python`，不需要修改 `workers.python`；该配置仍作为创建/修复
venv 的基础解释器。安装来源遵循本机 pip 配置；生产环境应使用可信索引或离线镜像。

如果宿主机无法创建 venv（例如缺少 `python3-venv`），页面会提示安装 venv 模块；不会自动改用系统 Python。
如已有独立的 Python 环境，可在「可选功能」页的「使用已有 Python 环境」填入解释器或环境目录，
检测通过后 worker 只读取该环境；安装/卸载仍只作用于项目 `.venv`，外部环境由用户自行管理。
也可以写入配置：

```jsonc
"workers": {
  "python": "python3",
  "externalPython": "/opt/my-python/bin/python",
  "imageWorker": "scripts/normalize-image.py",
  "pdfWorker": "scripts/render-pdf-page.py"
}
```

需要移除可选能力时，可以在环境页点「卸载依赖」，或手工执行：

```bash
.venv/bin/pip uninstall -y Pillow
.venv/bin/pip uninstall -y pypdfium2
```

卸载会影响使用同一 Python 环境的其他程序；生产环境优先使用专用 venv，避免影响系统包。
卸载成功后卡片会显示「缺少依赖 / 不可用」，这是预期状态，不是卸载失败；页面不会再展示 Python 的完整 traceback。

```jsonc
"workers": {
  "python": "python3",
  "externalPython": "",
  "imageWorker": "scripts/normalize-image.py",
  "pdfWorker": "scripts/render-pdf-page.py",
  "probeTimeoutMs": 2500
}
```

两个路径都可以改成外部绝对路径，或留空禁用。修改后重启服务，在管理员
`/console/overview?tab=environment` 页面查看探测结果和实际可用功能；旧 `/console/environment` 会兼容跳转。

### 图片重编码

需要 Python 3 与 Pillow：

```bash
.venv/bin/pip install Pillow
.venv/bin/python -c "import PIL"
```

PyPI：<https://pypi.org/project/Pillow/> · 原项目：<https://github.com/python-pillow/Pillow>

缺少 worker、Python 或 Pillow 时，上传仍可用，但图片不会被重新编码，服务端会记录跳过原因。
Python worker 脚本需从源码目录复制或配置外部路径；发布包不包含脚本，地址：
<https://github.com/Mrtime-gege/nenggong-zhiren/tree/main/scripts>。

### PDF 页图

需要可选的 `pypdfium2`：

```bash
.venv/bin/pip install pypdfium2
```

PyPI：<https://pypi.org/project/pypdfium2/> · 原项目：<https://github.com/pypdfium2-team/pypdfium2>

生产账号必须能执行配置的 `python3` 并导入该包。systemd 的 `ProtectHome=true` 可能阻止
用户级 site-packages；此时建议创建专用 venv，并在 unit 中设置 `PATH`/`PYTHONPATH`，
或安装到可读的系统位置。

没有 `pypdfium2` 时，PDF 上传、文字抽取和下载仍可用，页图接口返回
`503 pdf_preview_unavailable`，前端回退为文字预览。

### SQLite

Node 24 自带 `node:sqlite`；如果运行环境没有该模块，状态和历史会自动回退到旧 JSON/内存
路径。不要同时手工编辑 `state.db` 和 `state.json`，SQLite 可用时以 `state.db` 为准。

## systemd

```ini
# /etc/systemd/system/nenggong-zhiren.service
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

# 数据与用户文件权限
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/nenggong-zhiren
CapabilityBoundingSet=
AmbientCapabilities=
LockPersonality=true
MemoryDenyWriteExecute=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /opt/nenggong-zhiren --shell /usr/sbin/nologin nenggong
sudo chown -R nenggong:nenggong /opt/nenggong-zhiren
sudo systemctl daemon-reload
sudo systemctl enable --now nenggong-zhiren
sudo systemctl status nenggong-zhiren --no-pager
curl -s http://127.0.0.1:7355/healthz
```

`ProtectSystem=strict` 下只有 `ReadWritePaths` 可写；如果启用 TLS 且证书在
`/etc/letsencrypt`，需要额外只读挂载或把证书复制到可读路径。

常用命令：

```bash
sudo systemctl stop nenggong-zhiren
sudo systemctl restart nenggong-zhiren
sudo systemctl status nenggong-zhiren
journalctl -u nenggong-zhiren -f
```

## 2. TLS

### 2.1 Node 直接 TLS

编辑 `config.jsonc` 的 `tls` 段：

```jsonc
"tls": {
  "enabled": true,
  "certFile": "/etc/letsencrypt/live/ai.example.internal/fullchain.pem",
  "keyFile": "/etc/letsencrypt/live/ai.example.internal/privkey.pem"
}
```

启动日志会显示 `https://...`，Cookie 自动加 `Secure`，响应带 HSTS。
自签名证书仅限受控环境；浏览器需要信任链。

### 2.2 nginx 终止 TLS（推荐）

```nginx
server {
    listen 443 ssl http2;
    server_name ai.example.internal;

    ssl_certificate     /etc/letsencrypt/live/ai.example.internal/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ai.example.internal/privkey.pem;

    client_max_body_size 4m;

    location / {
        proxy_pass http://127.0.0.1:7355;
        proxy_http_version 1.1;
        proxy_set_header Host $host:$server_port;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE：必须关闭缓冲
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
        add_header X-Accel-Buffering no;
    }
}
```

服务端配置：

```jsonc
"server": {
  "cookieSecure": true,
  "trustedHosts": ["ai.example.internal:443"]
}
```

`cookieSecure` 也可以保持 `"auto"`：只有在直接启用 TLS 或反代正确传递 HTTPS 时才会加 `Secure`。

> 注意：`proxy_set_header Host $host:$server_port;` 在 443 端口可能产生
> `ai.example.internal:443`；如果反代用 80/443 默认端口，也可以用 `$host`，但要确保
> `server.trustedHosts` 要与实际 Host 完全一致。

防火墙只放行 443（以及必要的 80 用于 ACME），不要放行 7355：

```bash
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp
sudo ufw deny 7355/tcp
```

## 3. 账号

```bash
# 添加回复员（会提示输入密码）
node scripts/user.mjs add alice --role operator

# 改密（会让该用户旧会话以及所有会话失效）
node scripts/user.mjs passwd alice

# 列表 / 删除
node scripts/user.mjs list
node scripts/user.mjs remove alice
```

不能删除自己或最后一个管理员。账号文件变化会被运行中的服务检测到；只有被改密/改角色/
删除的账号旧会话失效，管理员新增用户时不会被踢下线。

## 4. 调用方 key

调用密钥由管理员在网页「调用密钥」里生成。生成后复制给调用方；服务端只保存哈希。

- 不要使用示例 key、默认 key 或团队成员共用的 key 上生产。
- 轮换：在网页「API 密钥」创建新密钥，通知调用方切换，再停用旧密钥。
- key 会以掩码形式出现在启动日志，不会完整打印。
- 每个 key 的票据并发由密钥的 `limits.maxConcurrent` 指定，未设置时继承 `limits.maxConcurrentPerKey`；它不是全局并发数。
- 每个 key 的上传/下载并发由 `limits.maxUploadConcurrency` / `limits.maxDownloadConcurrency` 指定，默认 2，单进程全局上限 4；上传前会按 `Content-Length` 预检每日配额。

## 5. DSH

编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`，把 `llm-pi-ai` 的
`human-provider.baseURL` 指向：

```yaml
baseURL: http://127.0.0.1:7355/v1
```

credentials 中：

```yaml
HUMAN_PROVIDER_KEY: sk-prod-web
```

DSH 会热重载。然后在模型选择器里选 Human 1（或 Human 1 Fast）。

人工模型可以声明 `low` / `high` / `max` 工作深度；能工智人把 `reasoning_effort` 显示在票据上，
但不会伪造模型推理。DSH 会同时发“主请求”和“会话标题”请求；控制台会分别标注目的。
工具续跑会再发一次带 tool result 的请求。

## 6. 健康检查与监控

```bash
curl -fsS http://127.0.0.1:7355/healthz
```

`/healthz` 只返回服务名、版本、uptime，不泄露队列、用户或 key。`/metrics` 默认仅管理员会话可读；配置 `server.metricsToken` 后可用 `Authorization: Bearer <token>` 供 Prometheus 抓取。指标包括：
服务状态、运行时间、内存、票据状态计数、请求/完成/失败、累计等待、最老等待、会话数和版本。
指标不包含聊天内容或密钥；建议只在反向代理/内网限制访问。

```bash
# 管理员 Cookie 会话
curl -fsS -b 'ngzr_session=<session>' http://127.0.0.1:7355/metrics
# 或使用配置的 metricsToken
curl -fsS -H 'Authorization: Bearer <metrics-token>' http://127.0.0.1:7355/metrics
```

队列告警在 `config.jsonc` 的 `alerts` 中配置：

```jsonc
"alerts": {
  "webhookUrl": "",
  "queueDepth": 10,
  "oldestWaitMs": 60000,
  "cooldownMs": 300000
}
```

`webhookUrl` 留空时只记录状态页告警和审计；填写后发送 JSON POST。状态页会显示当前告警。

建议监控：

- HTTP 5xx / 401 / 403 / 421 / 429；
- 进程存活；
- 项目根目录 `users.json` 权限；
- 磁盘（日志/未来持久化）；
- TLS 证书到期。

日志在 stdout；用 systemd journald：

```bash
journalctl -u nenggong-zhiren -f
```

`logging.content: true` 会记录 prompt 内容，默认关闭；开启前确认隐私合规。

## 7. 备份与恢复

- 备份 `users.json`（密码哈希/角色/MFA 状态，按敏感文件处理）；
- 备份 `api-keys.json`（密钥哈希、配额、过期时间）；
- 备份 `state.db`（活动票据、认领、SSE 日志和幂等记录；原始快照最多 256 KiB、消息正文最多 512 KiB）、`history.db`（历史索引）、`usage.json`、`settings.json`、`models.json`、`templates.json`、`audit.log`；
- 备份 `attachments/`（原件和元数据；按敏感数据保护，权限 0700/0600）；
- SQLite 可用时 `state.json` 只是旧版迁移来源；重启后活动队列从 `state.db` 恢复，调用方可凭 `Idempotency-Key` 重连；
- 登录会话、CSRF token 和限速计数仍在内存，重启后需重新登录；
- `restart-status.json` 只记录最近一次重启的请求/就绪/失败时间和 PID，可选备份；
- 恢复账号/密钥文件后重启，或让用户文件热重载生效（会清空受影响账号的会话）。

## 8. 服务控制

管理员可以在「设置 → 系统信息」查看 PID、运行时长、Node 版本、监听地址、内存和票据状态，并执行重启、结束服务和复制诊断信息。

- 重启会启动一个延迟绑定的新进程；旧进程按 TLS/host 和实际端口探测 `/healthz`，20 秒内未就绪会记录失败并回滚旧监听；连接会短暂中断；
- 结束服务只停止当前进程，不会自动拉起；
- 生产环境应由 systemd、Docker 或其他进程管理器托管，避免只依赖页面按钮；
- 两种操作都需要管理员会话和 CSRF token，并写入审计日志；
- 重启探针支持 HTTPS 和非回环绑定；失败时旧进程尝试重新监听，避免直接停机。

## 9. 端口与网络

| 端口 | 用途 | 暴露建议 |
| --- | --- | --- |
| 7355 | 本服务 | 仅 LAN / 反代；不要直接公网 |
| 443 | 反代 TLS | LAN/公网按需 |
| 80 | ACME | 仅证书签发 |

如果回复员和 DSH 不在同一台机器，`server.host` 需要监听局域网地址；此时务必启用 TLS 和防火墙。
如果全部在本机，建议 `server.host` 使用 `127.0.0.1`，通过 SSH 隧道/反代访问，进一步缩小暴露面。

## 10. 发布包内容

发布包只包含 `release-whitelist.txt` 列出的文件，共 96 个：

- 运行必需：`server.mjs`、`package.json`、`src/` 下 35 个模块、`public/` 下 47 个页面/脚本/样式/图标、`docs/openapi.json`；
- 安装与运维：`config.example.jsonc`、`scripts/user.mjs`（账号 CLI）、`LICENSE`；
- 分发文档：`README.md`、`SECURITY.md`、`CHANGELOG.md`、`docs/quickstart.md`、`docs/protocol.md`、`docs/deployment.md`、`docs/security.md`、`docs/architecture.md`。

不进入发布包：`config.jsonc`、数据文件、`examples/`、`integrations/`、`test/`、`.github/`、`release-whitelist.txt`、`scripts/build-release.mjs`、媒体 worker 的 Python 脚本。

> 注意：`config.example.jsonc` 默认 `workers.imageWorker` / `workers.pdfWorker` 指向 `scripts/normalize-image.py` 和 `scripts/render-pdf-page.py`，但这两个脚本不随发布包提供。发布包开箱时对应能力探测为不可用；需要图片重编码或 PDF 页图时，从源码提供脚本或改成外部绝对路径，也可以留空禁用。
