# 部署

> 只想尽快跑起来？先看 [quickstart.md](quickstart.md)。

## 目标形态

默认：

```text
LAN browser ──HTTPS/HTTP──► 能工智人 :7355 ──HTTP(loopback)──► DSH
```

- 回复员通过浏览器访问 `http://<LAN-IP>:7355/login`（或 HTTPS 域名）。
- DSH/调用方访问 `http://127.0.0.1:7355/v1`。
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

### systemd

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
- 每个 key 的并发上限是 `limits.maxConcurrentPerKey`，不是全局并发数。

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

`/healthz` 只返回服务名、版本、uptime，不泄露队列、用户或 key。
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
- 备份 `state.json`、`usage.json`、`settings.json`、`audit.log`；
- 活动队列和会话在内存，不备份；重启后活动请求中断，调用方需重试；
- 已完成请求和幂等记录会从 `state.json` 恢复；
- 恢复账号/密钥文件后重启，或让用户文件热重载生效（会清空受影响账号的会话）。

## 8. 端口与网络

| 端口 | 用途 | 暴露建议 |
| --- | --- | --- |
| 7355 | 本服务 | 仅 LAN / 反代；不要直接公网 |
| 443 | 反代 TLS | LAN/公网按需 |
| 80 | ACME | 仅证书签发 |

如果回复员和 DSH 不在同一台机器，`server.host` 需要监听局域网地址；此时务必启用 TLS 和防火墙。
如果全部在本机，建议 `server.host` 使用 `127.0.0.1`，通过 SSH 隧道/反代访问，进一步缩小暴露面。
