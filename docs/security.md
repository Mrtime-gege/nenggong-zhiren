# 安全模型

## 威胁模型

能工智人默认部署在**局域网**，面对的不是互联网陌生人，而是内网里可能被攻陷的终端、
误配置的浏览器、恶意网页和好奇/恶意的内部用户。重点防护：

1. 未登录者读取等待列表、接单、冒充回复员；
2. 跨站请求伪造（CSRF）和跨站登录；
3. 登录暴力破解、用户名枚举、时序侧信道；
4. 开放重定向、XSS、路径穿越、Host 头攻击；
5. 会话固定、Cookie 窃取/滥用；
6. 资源耗尽（超大请求、长连接、无限票据）；
7. 误把 HTTP 当 HTTPS、把兼容开关带进生产。

不假设攻击者已经拿到操作系统账号或 `users.json`。若主机被攻陷，本地文件、
进程内存和浏览器会话都不可信。

## 身份与密码

- 用户保存在项目根目录 `users.json`，文件 `0600`，原子写入；文件只保留在本机，包含账号哈希、角色和每个账号的个性化设置（不含密钥）。
- 密码使用 `scrypt`（N=16384, r=8, p=1）和每用户随机盐；只存哈希。
- 密码长度至少 8 位，最长 256 位；用户名 3–32 位小写字母/数字/`_`/`.`/`-`。
- 密码复杂度提示只作为建议：常见密码（如 `P@ssw0rld`、`12345678`）会被标弱，但仍可保存；8 位长度是硬性要求。
- 未知用户名仍执行一次 dummy scrypt，避免“用户不存在”比“密码错误”明显更快。
- 登录失败统一返回“用户名或密码错误”，不区分账号存在性。
- 首次启动：若无用户，创建管理员并生成随机密码，**只打印一次**；运行配置只来自 `config.jsonc`。
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
- 默认白名单：`127.0.0.1`、`localhost`、`[::1]` 及 `server.host` 为 `0.0.0.0` 时枚举到的
  LAN IPv4，均带端口；前置代理域名用 `server.trustedHosts` 追加。
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

- 每 IP：默认 5 分钟内最多 10 次失败；
- 每用户名：默认 5 分钟内最多 5 次失败；
- 超限返回 429 + `Retry-After`，不透露是 IP 还是用户名触发。
- 成功登录会清除该用户名失败计数，并减半该 IP 的失败计数。

## 浏览器安全

- 登录/控制台不加载任何第三方脚本；`script-src 'self'`。
- 所有用户/票据文本用 `textContent` 写入 DOM，不拼 `innerHTML`。
- 登录错误信息经过 HTML 转义，不回显用户名。
- 安全响应头：
  - `Content-Security-Policy`（普通页面 `frame-ancestors 'none'`，`object-src 'none'`，...）
  - `X-Frame-Options: DENY`
  - 仅 `/console/<page>?embed=1` 的管理子页面允许同源内嵌：`frame-ancestors 'self'` + `SAMEORIGIN`，供控制台内页面切换使用；跨站嵌入仍被拒绝。
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
| 每个调用方 key 并发 | 默认 4 |
| 队列等待 | 默认 2 小时（`queue.waitTimeoutMs`） |
| 回复员接单后完成 | 默认 2 小时（`queue.responseTimeoutMs`） |
| 登录失败计数 | 定时清理 |
| 已完成票据 | 30 分钟后回收 |
| 幂等记录 | 2000 条 / 30 分钟 |
| 每密钥每日上传 | 默认 200 MiB，可配 |
| 历史票据 | 最近 1000 张（`state.json`） |
| 附件单文件 | 10 MiB；每请求 5 个 |
| 附件保留 | 30 天；目录 0700 / 文件 0600 |
| 指标端点 | 聚合数值，不含聊天内容或密钥 |

## TLS

- 默认 HTTP，适合隔离内网；**HTTP 下登录密码明文过网**。
- 在 `config.jsonc` 的 `tls` 中设置 `enabled: true`、`certFile` 和 `keyFile` 可直接启用 HTTPS；Cookie 自动 `Secure`，加 HSTS。
- 或在 nginx/Caddy 终止 TLS：
  - 在 `config.jsonc` 里设置 `server.cookieSecure: true`
  - 在 `config.jsonc` 的 `server.trustedHosts` 里加入 `your.domain:port`
  - SSE 关闭缓冲、放大读超时
- 自签名证书仅限受控环境；生产用受信任证书。

## 残余风险（必须知情）

1. **默认 HTTP 无传输加密。** 这是最大的残余风险；生产必须启用 TLS 或反代 TLS。
2. **MFA 是可选 TOTP，不是强制策略。** 正确配置的验证器可降低密码泄露风险，但没有恢复码和一键重置流程；管理员需要保留本机恢复手段。
3. **模型级权限，不是完整 RBAC。** admin 可以管理账号、模型、API 密钥、设置、审计和状态；operator 只能看到并操作其「可回复模型」范围内的票据。空权限表示全部模型，没有更细的团队/项目隔离。
4. **没有自助密码找回 UI。** 忘记密码需要管理员在 Web 用户面板或 CLI 中重置。
5. **审计日志是本地追加文件，不是不可篡改账本。** 有文件系统权限的管理员可以修改或删除；高安全环境应转发到远端日志。
6. **单进程运行。** 当前 socket、登录会话和限速计数在内存；活动票据、认领状态、SSE 日志和幂等记录会从 `state.json` 恢复，但没有多实例 HA。重启后原 socket 不会恢复，带幂等键的调用方可以重连。
7. **人类会看到 prompt 和工具结果。** 需要隐私告知、数据分级和访问控制。
8. **JSON Schema 是子集。** `pattern`/`format`/`$ref` 等被忽略；不要用它们做安全校验。
9. **图片只做 URL/大小检查。** 未解码/扫描恶意图片；外链 URL 不代抓服务端，但会在坐席浏览器加载，可能暴露坐席 IP/时间。
10. **没有全局 API 请求速率限制。** 只有每 key 并发上限；恶意持有 key 者可长期刷票据。
11. **登录允许 `Origin: null`**，用于兼容无头浏览器/本地代理；普通跨站 Origin 会被拒绝，但登录 CSRF 仍有一个较窄的边界。
12. **文档和集成示例里的调用 key 都是占位值。** 上线必须生成独立的真实 key 并替换。

## 文件附件

- 只接受 UTF-8 文本、CSV、JSON、结构完整的 PNG/JPEG/GIF/WebP 和 PDF；
- HTML、SVG、Office、ZIP、可执行文件、未知二进制直接拒绝；
- 图片校验 magic、IHDR/SOF/SOI 结构和尺寸，限制 40MP；
- PDF 拒绝加密、JavaScript、OpenAction、Launch、EmbeddedFile、RichMedia、XFA；
- 文本/CSV/PDF 通过受保护的文本预览端点展示，使用 `text/plain` 和 CSP sandbox；
- 图片只从图片端点提供，带 `nosniff` 和 sandbox CSP；
- 原件只以 `Content-Disposition: attachment` 下载，不内联 PDF/文本原件；
- 附件按调用 key 的 SHA-256 隔离，跨 key 返回 404；
- 附件按保留期清理，上传、下载和预览写入审计。

## 监控与历史

- `/metrics` 是公开聚合指标端点；不包含聊天内容、用户名、密钥或票据 ID。生产环境建议通过反向代理限制来源。
- `/op/api/operators` 必须携带当前回复员可见的 `ticket`，只返回该票据模型可接单的账号，不返回 `allowedModels`。
- `/console/history` 仅管理员可访问；检索结果来自 `state.json`，受模型权限和管理员角色保护。
- 历史 CSV 导出由管理员主动触发，不写入临时文件。
- 会话 ID 可由调用方通过 `X-Session-Id` 等头提供；服务会按调用方隔离，不跨 key 合并。

## 应急

1. 停服务 / 从网络隔离。
2. 在网页「API 密钥」创建新密钥，通知调用方切换，再停用旧密钥。
3. 用 Web 用户面板或 CLI 改密码；改动账号的旧会话会失效。
4. 检查 `users.json` 是否被篡改；必要时从备份恢复。
5. 检查反代/防火墙日志中异常的 `/auth/login`、421/403/429。
6. 如果怀疑会话 token 泄露，重启进程即可清空全部内存会话。


## 公开新手教程页（`/guide`）

`/guide` 在管理员开启 `features.publicGuide`（默认开启）时是唯一不要求登录、但不属于登录流程的 HTML 页面；关闭后未登录请求会跳转登录。它只读取固定文件
`public/guide.html` 和 `public/guide.css`，不读取票据、账号、密钥、状态或附件，也不执行用户输入。登录用户访问 `/guide` 会跳转到 `/console/guide`，顶部导航以控制台子页面打开。

公开信息白名单：

- 产品定位、使用流程、角色说明和快捷键；
- OpenAI 兼容接口的公开路径（如 `/v1/chat/completions`）和通用 curl 占位示例；
- 通用安全提示；
- 指向公开登录页、工作台和教程本身的链接。

明确不公开：

- 实际 LAN 地址、内部端口和真实部署域名；
- 真实模型名、API Key、用户数据、票据内容和文件名；
- 状态文件、账号文件、审计文件路径；
- 运行时配置和任何 secret。

页面请求面的约束：

- 仅允许 `GET` / `HEAD`，其它方法返回 `405`；
- 固定文件路径，不接受路径或查询参数，查询字符串不参与渲染；
- 不返回 `Set-Cookie` 或 CORS 允许头；
- `no-store`、`X-Frame-Options: DENY`、`nosniff`、`no-referrer`、CSP 均沿用全局策略；
- `X-Robots-Tag: noindex, nofollow`；
- 只允许 Host 白名单，未受信任 Host 返回 `421`；
- 没有 JavaScript、表单、外链资源或 API 调用，因此没有新增动态注入面。

回归测试覆盖：公开 200、静态 CSS 200、页面不含实际部署地址/模型/端口/Key、无内联脚本或事件处理器、
查询字符串不反射、子路径 404、非 GET 方法 405、非受信 Host 421、无 Cookie/CORS。


## 请求内容与磁盘边界

除 HTTP body 上限外，用户可控的列表现在还有结构上限：

- 每个请求最多 256 条 `messages`；每条消息最多 512 个 content part；
- 每个请求最多 8 个图片 URL，所有图片 URL 字符串总计最多 2,000,000 字节；
- 每个请求最多 5 个已上传文件，单文件 10 MiB；每个调用密钥每天最多上传 200 MiB；
- 工具列表 128 个，单条工具说明 16 KiB，单次调用参数 64 KiB，tool_calls 32 个；
- 票据状态最多保留 1000 张，SSE/Anthropic 日志各最多 2000 条。

图片 URL 分为两类：

- `https://` / `http://`：服务端不会下载，只保存 URL 字符串；回复员浏览器按 URL 加载；
- `data:image/...`：作为字符串保存到票据状态，因此同时受数量、单 URL 长度和总字节上限约束。

文件附件由 `AttachmentStore` 按保留期清理；上传还有每密钥每日配额。
注意：附件总量仍可能随多个调用密钥和保留期增长，管理员应定期检查数据目录；审计日志目前是追加文件，没有自动轮转。


## 回复员协作数据

- 快捷回复由服务端 `templates.json` 保存（0600）；共享模板只有管理员可创建/修改/删除，个人模板按 owner 隔离；
- 模板只作为文本插入草稿，不自动发送；
- 内部备注只通过 `/op/api/tickets/:id/notes` 返回给已登录且有模型可见性的回复员，不进入调用方响应；
- 标签/优先级通过票据 meta API 修改，标签限制 8 个、每个 24 字符，服务端校验字符集；
- 备注正文不回写审计 detail，只记录操作事件；
- 回复员仍沿用现有 admin/operator 权限，没有新增角色。


## AI 辅助安全边界

- AI 默认关闭；管理员在设置中显式启用并配置 Endpoint、模型和 API Key；
- API Key 保存在独立 `ai-secrets.json`（0600），接口只返回是否配置和掩码提示，不返回明文；
- 每个回复员有通用功能开关 `features.aiAssist`，管理员可单独关闭；
- AI 请求只读取当前票据上下文，不读取其他票据、附件二进制、Cookie 或 API Key；
- 发送前脱敏 Bearer/Key/Cookie/私钥等模式；
- AI 不注册工具、不自动发送、不自动结束票据、不自动修改标签；
- 上游超时/错误/格式错误只返回建议失败，不改变票据；
- 每日请求/token 限额按回复员和全局统计，计数文件不保存 prompt 或回复正文；
- 审计只记录任务、票据、模型、耗时和 token，不记录正文。


## SQLite/FTS 历史索引

- `history.db` 只保存已完成票据的摘要、搜索文本和索引字段，不保存附件二进制；
- 文件权限 0600；
- 索引在历史查询前同步，删除只淘汰已不在当前 1000 张票据集合中的记录；
- 没有 `node:sqlite` 时自动回退到内存搜索，不影响主流程；
- FTS 查询使用参数化 SQL；关键字同时做 FTS 和 `LIKE` 兜底，避免短中文串因 trigram 限制漏检。


## 代理与客户端 IP

`server.trustedProxies` 为空时，登录限流和审计只使用 TCP `remoteAddress`。
只有请求来自配置的代理地址/网段时，才读取 `X-Forwarded-For`，并从代理边向内跳过可信代理，
取第一个不可信地址。这样普通客户端无法通过伪造 XFF 绕过登录限流。


## SQLite 状态库

SQLite 可用时，票据和幂等记录写入 `state.db`（0600）。首次启动如果 `state.db` 为空且存在旧
`state.json`，会导入一次；没有 `node:sqlite` 的环境回退到 JSON + journal。状态库不保存附件
二进制；附件元数据仍按附件存储配额和保留期管理。


## 媒体依赖策略

核心流程不依赖外部媒体工具。图片重编码和 PDF 页图默认关闭，属于显式可选项；启用后仍只
在独立临时目录中调用受限 worker，失败时回退原图/文字预览。AI 外部服务同样默认关闭。

## 图片重编码 worker

- 只处理通过文件头验证的 PNG/JPEG/GIF/WebP；
- 每次调用写入独立临时目录（0600/0700），输入和输出均为临时文件；
- Python 子进程限制 CPU 和虚拟内存，Node 侧有超时和 SIGKILL；
- 重新编码会去掉 EXIF/元数据，并把输出限制在附件大小上限内；
- worker 或 Pillow 不可用时回退原图，原有文件头/尺寸校验仍然生效；
- 该 worker 不访问网络，也不接受用户提供的命令或路径。


## PDF 页图预览

- PDF 页图按需渲染，不写入附件目录；
- 只允许已登录、对票据有可见性的回复员访问；
- 页号限制 1–200，单次渲染限制并发 2；
- 子进程限制 CPU/内存，Node 侧限制超时和输出大小；
- 缺少 `pypdfium2` 或渲染失败时返回明确错误，前端回退到文字预览和原文件下载；
- 上传时仍拒绝加密 PDF 和带 JavaScript/Launch/EmbeddedFile 等主动内容的 PDF。


## 上传入口

`/v1/files` 先把请求体流式写入 `os.tmpdir()` 下的独立目录，边写边检查大小上限；随后从临时
文件读取并进行文件头/预览校验。成功或失败都会清理临时目录。这样慢速/超大请求不会在内存里
无限累积，但附件预览阶段仍受 `attachments.maxBytes` 限制。
