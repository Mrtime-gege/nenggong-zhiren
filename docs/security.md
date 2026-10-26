# 安全模型

## 威胁模型

能工智人默认部署在**局域网**，面对的不是互联网陌生人，而是内网里可能被攻陷的终端、
误配置的浏览器、恶意网页和好奇/恶意的内部用户。重点防护：

1. 未登录者读取队列、认领票据、冒充坐席；
2. 跨站请求伪造（CSRF）和跨站登录；
3. 登录暴力破解、用户名枚举、时序侧信道；
4. 开放重定向、XSS、路径穿越、Host 头攻击；
5. 会话固定、Cookie 窃取/滥用；
6. 资源耗尽（超大请求、长连接、无限票据）；
7. 误把 HTTP 当 HTTPS、把兼容开关带进生产。

不假设攻击者已经拿到操作系统账号或 `users.json`。若主机被攻陷，本地文件、
进程内存和浏览器会话都不可信。

## 身份与密码

- 用户保存在项目根目录 `users.json`，文件 `0600`，原子写入；文件仅供本机保存。
- 密码使用 `scrypt`（N=16384, r=8, p=1）和每用户随机盐；只存哈希。
- 密码长度 12–256；用户名 3–32 位小写字母/数字/`_`/`.`/`-`。
- 未知用户名仍执行一次 dummy scrypt，避免“用户不存在”比“密码错误”明显更快。
- 登录失败统一返回“用户名或密码错误”，不区分账号存在性。
- 首次启动：若无用户，创建管理员并生成随机密码，**只打印一次**；之后不再依赖环境变量。
- 管理员可以在 Web 控制台添加/改密/删除用户，也可用 CLI；不能删除自己或最后一个管理员。
- `users.json` 变化会触发热重载；只让被改密、改角色或删除的账号旧会话失效，管理员新增
  用户时不会被踢下线。

## 会话与 CSRF

- 登录成功后生成服务端随机会话 token，写入 `ngzr_session`：
  - `HttpOnly`
  - `SameSite=Strict`
  - `Path=/`
  - `Max-Age=12h`
  - HTTPS 时自动 `Secure`
- 会话上限 12 小时、空闲 2 小时；每个用户最多保留 5 个会话。
- CSRF token 每会话随机 32 字节，`/auth/me` 返回给同源控制台；所有写请求必须带
  `X-CSRF-Token`，服务端用常数时间比较。
- 登录响应总是生成新 token，不复用请求里带来的任意 `ngzr_session`，防会话固定。
- 登出销毁服务端会话并清 Cookie；缺少 CSRF 的登出返回 403。

## Origin 与 Host

- 所有请求先做 Host 白名单校验，不允许任意 `Host`，降低 DNS rebinding/缓存投毒面。
- 默认白名单：`127.0.0.1`、`localhost`、`[::1]` 及当前 `HOST=0.0.0.0` 时枚举到的
  LAN IPv4，均带端口；反向代理域名用 `TRUSTED_HOSTS` 追加。
- 登录、登出和 `/op/api` 写请求检查 `Origin`（以及 `Sec-Fetch-Site: cross-site`）。
  `/v1` 使用 Bearer key，不使用 Cookie，因此不把 Origin 当 CSRF 边界。
- `Origin: null` 的处理：
  - 登录 POST：允许 `Sec-Fetch-Site` 为空、`none` 或 `same-origin` 的 opaque origin；
    某些本地浏览器/代理会这样提交表单。登录不产生已认证写操作，Cookie 为
    `SameSite=Strict`，风险限于登录 CSRF；
  - 登出和 `/op/api` 写操作：只有 `Sec-Fetch-Site: same-origin` 才放行，其余拒绝；
  - 跨站标记（`cross-site`）一律拒绝；
- 开放重定向：`next` 只接受以单个 `/` 开头的站内路径；`//`、`/\`、控制字符和绝对
  URL 一律回退 `/console`。

## 登录限速

- 每 IP：5 分钟内最多 10 次失败；
- 每用户名：10 分钟内最多 5 次失败；
- 超限返回 429 + `Retry-After`，不透露是 IP 还是用户名触发。
- 成功登录会清除该用户名失败计数，并减半该 IP 的失败计数。

## 浏览器安全

- 登录/控制台不加载任何第三方脚本；`script-src 'self'`。
- 所有用户/票据文本用 `textContent` 写入 DOM，不拼 `innerHTML`。
- 登录错误信息经过 HTML 转义，不回显用户名。
- 安全响应头：
  - `Content-Security-Policy`（`frame-ancestors 'none'`, `object-src 'none'`, ...）
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Permissions-Policy` 禁用摄像头/麦克风/定位
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Resource-Policy: same-origin`
  - `Cache-Control: no-store`
  - HTTPS 时 `Strict-Transport-Security`
- 静态资源只从固定白名单读取，不拼接用户路径。
- 登录表单有 CSP `form-action 'self'`，不接受外部 action。

## 资源限制

| 面 | 限制 |
| --- | --- |
| `/v1` 请求体 | 2 MiB（可配） |
| 登录请求体 | 16 KiB |
| HTTP 请求接收 | 30 秒 |
| HTTP 请求头 | 15 秒 |
| 每个调用方 key 并发 | 4 |
| 队列等待 | 默认 5 分钟 |
| 坐席认领后完成 | 默认 15 分钟 |
| 登录失败计数 | 定时清理 |
| 已完成票据 | 30 分钟后回收 |
| 幂等记录 | 2000 条 / 30 分钟 |

## TLS

- 默认 HTTP，适合隔离内网；**HTTP 下登录密码明文过网**。
- 设置 `TLS_CERT` + `TLS_KEY` 可直接启用 HTTPS；Cookie 自动 `Secure`，加 HSTS。
- 或在 nginx/Caddy 终止 TLS：
  - 设置 `COOKIE_SECURE=1`
  - 设置 `TRUSTED_HOSTS=your.domain:port`
  - SSE 关闭缓冲、放大读超时
- 自签名证书仅限受控环境；生产用受信任证书。

## 残余风险（必须知情）

1. **默认 HTTP 无传输加密。** 这是最大的残余风险；生产必须启用 TLS 或反代 TLS。
2. **没有 MFA/SSO。** 密码泄露即可登录；建议结合网络 ACL、VPN、反代认证。
3. **没有细粒度 RBAC。** 任何 operator 能看到所有票据；admin/operator 目前只用于
   账号管理。
4. **没有自助密码找回 UI。** 忘记密码需要管理员在 Web 用户面板或 CLI 中重置。
5. **没有审计日志文件。** 目前只写 stdout；生产应接 journald/集中日志。
6. **单进程内存状态。** 重启丢票据/会话；没有 HA。
7. **人类会看到 prompt 和工具结果。** 需要隐私告知、数据分级和访问控制。
8. **JSON Schema 是子集。** `pattern`/`format`/`$ref` 等被忽略；不要用它们做安全校验。
9. **图片只做 URL/大小检查。** 未解码/扫描恶意图片；外链 URL 不代抓。
10. **没有全局 API 请求速率限制。** 只有每 key 并发上限；恶意持有 key 者可长期刷票据。
12. **默认调用方 key 是公开示例值。** 上线必须换。

## 应急

1. 停服务 / 从网络隔离。
2. 轮换 `HUMAN_KEYS`，重启；所有调用方更新 key。
3. 用 Web 用户面板或 CLI 改密码；改动账号的旧会话会失效。
4. 检查 `users.json` 是否被篡改；必要时从备份恢复。
5. 检查反代/防火墙日志中异常的 `/auth/login`、421/403/429。
6. 如果怀疑会话 token 泄露，重启进程即可清空全部内存会话。
