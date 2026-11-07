# 架构

## 0.6.3 分层

- **配置层**：`src/config.mjs` 只读取根目录 `config.jsonc`；不读取环境变量，也不接受运行参数。可选的 `workers` 段只声明 Python worker 路径。
- **数据层**：`src/data/models.mjs` 维护运行时模型注册表；`src/data/api-keys.mjs` 管理调用密钥、配额和模型范围；`src/data/usage.mjs` 保存分钟/日/月用量和每日历史；`src/data/state.mjs` 保存完成请求和幂等快照；`src/data/settings.mjs` 保存设置页覆盖值；`src/data/audit.mjs` 追加审计事件；`src/auth.mjs` 负责账号、模型权限、会话、MFA 和登录限速；`src/totp.mjs` 提供 TOTP。
- **协议层**：`src/protocol/common.mjs` 把不同接口的消息统一成 `{role, content, parts}`，新增消息类型只需增加 part 归一化/序列化逻辑；`openai.mjs` 和 `anthropic.mjs` 只负责各自协议。
- **业务层**：`server.mjs` 维护等待列表、接单、流式发送、票据动作授权和操作接口，不直接理解两种协议的原始字段。

## 一句话

浏览器里的回复员和 API 调用方共享同一个票据（ticket）状态机；服务端只负责排队、鉴权、
协议转换和把人的输入按节奏写成 SSE。

```text
┌──────────────┐   POST /v1/chat/completions    ┌─────────────────────────────┐
│ API caller   │ ─────────────────────────────► │  server.mjs                 │
│ (DSH/curl)   │ ◄───────────────────────────── │  ticket queue + SSE writer  │
└──────────────┘   chat.completion / SSE        │                             │
                                                │  ┌───────────────────────┐  │
┌──────────────┐   Cookie + CSRF /op/api/*      │  │ tickets Map           │  │
│ Operator     │ ─────────────────────────────► │  │  queued → claimed →   │  │
│ browser      │ ◄───────────────────────────── │  │  streaming → done     │  │
└──────────────┘   JSON operator actions        │  └───────────────────────┘  │
                                                │  ┌───────────────────────┐  │
                                                │  │ auth.mjs sessions     │  │
                                                │  │ schema.mjs validator  │  │
                                                │  └───────────────────────┘  │
                                                └─────────────────────────────┘
```

## 进程与模块

- `server.mjs`：HTTP 路由、票据状态机、SSE、协议校验、安全中间件。
- `src/auth.mjs`：用户文件、scrypt 哈希、内存会话、CSRF、TOTP MFA、登录失败限速、热重载。
- `src/schema.mjs`：零依赖 JSON Schema 子集校验器。
- `public/console.*`：网页工作台（无构建步骤的原生 JavaScript）。
- `public/login.*`：登录页。
- `public/navigation.js`：顶部页面清单。
- `public/settings.html`、`usage.html`、`audit.html`、`status.html`：管理页面。
- `scripts/user.mjs`：账号 CLI。
- `src/environment.mjs`：管理员环境页的受限能力探测，只检查配置路径和已知 Python 模块。
- `public/environment.html`、`admin-environment.js`：环境检查页。

## 请求生命周期

1. `POST /v1/chat/completions` 校验 `Authorization`、Host、Origin、请求体和模型。
2. 规范化 `messages`、图片附件、tools、`response_format`、停止符、max tokens。
3. 创建 ticket，状态 `queued`；非流式请求挂起，流式请求先不写响应头。
4. 回复员登录后通过 `/op/api/tickets` 看到票据，`claim` 把它变成 `claimed`。
5. 回复员 `chunk` 或 `finish`：
   - 非 JSON 模式：文本可以边写边流；
   - JSON 模式：文本先缓冲，`finish` 时校验后才发送；
   - 工具调用：参数按 schema 校验；
   - 拒答：设置 `refusal`，不发送 content。
6. `finish` 后状态 `done`，写 `finish_reason`、usage、`[DONE]`，释放并发槽。
7. 票据保留 `queue.retentionMs` 供控制台查看和幂等回放。

## 状态机

```text
queued ──claim──► claimed ──chunk/finish──► streaming ──finish──► done
  │                 │                          │
  │                 ├── release ──► queued     └── cancel ──► failed
  └── queue timeout / cancel ──► failed
```

- 票据正文、认领、发送、完成等写操作只允许当前认领人；管理员可以取消或转交，但不会绕过认领人直接编辑正文。
- 内部备注和标签/优先级按协作接口开放给对该模型有可见性的回复员；它们不进入调用方响应。
- `content_filter` 是 `finish_reason`，不是 ticket 状态。
- `claimed` 可以一直不发送文本；`streaming` 表示至少推送过一个 SSE 数据块（或已开始流）。
- 客户端断开时，服务端会取消或丢弃票据，避免继续占用回复员。

## 并发与资源

- 每个调用方 key 最多 `limits.maxConcurrentPerKey` 个未完成票据。
- 等待超时来自 `config.jsonc` 的 `queue.waitTimeoutMs`；接单后超时来自 `queue.responseTimeoutMs`。
- 每个票据的 SSE 发送串行化，避免并发写乱序。
- 心跳每 15 秒，防止反代把长连接当空闲连接断开。
- 所有状态在单进程内存；重启即丢失未完成票据和会话。

## 为什么 JSON 模式要缓冲

如果回复员边写边发，调用方可能先收到一段非法 JSON，再收到错误；这对依赖
`JSON.parse` 的客户端是破坏性的。因此 JSON 模式在 `finish` 之前不写 content；
校验失败时票据保持可编辑，草稿和已输入文本不丢。

## 为什么登录和调用方 key 分开

- 调用方 key 是机器对机器凭据，可轮换、可多把。
- 回复员会话是人的凭据，带 CSRF、Cookie、空闲超时和登录限速。
- 两者不共用，避免“拿到调用密钥就能冒充回复员”或反过来。

## 人工确认与个人偏好

- AI 生成只产生 `aiPending` 或浏览器内存中的结果卡片，不会自动填入草稿、工具或调用方响应；回复员必须显式点击「填入」或「追加」。
- 生成期间浏览器只维护 UI 运行状态（阶段、开始时间、输入规模、生成引导），服务端票据状态机不因状态面板变化；结果返回后状态面板隐藏并渲染 AI 卡片，运行详情仍可通过「详情」查看。
- AI relay 请求上游时使用流式响应，但不再暴露应用级输入/输出/每日配额和首包等待设置；程序完全独立运行，不读取 DSH。请求超时等内部默认值固化在项目代码中，管理员仍可管理 AI 开关、Endpoint、模型、API Key 和全局并发。上游失败时审计只记录错误阶段、错误码和状态，不记录正文或密钥。
- 自动 AI 只负责预生成，仍受账号权限、票据锁和全局并发保护，不进入调用方响应。
- 快捷栏是每账号的偏好设置，最多 15 项；服务端按角色过滤管理员专用动作/链接，前端只负责显示。

## 页面加载与缓存

- 代码资源 CSS/JS 使用 ETag 条件缓存（`max-age=0, must-revalidate`），图片使用长缓存；代码更新不会长期被旧缓存覆盖。
- 静态资源重复打开时只做条件请求，避免重复下载。
- 管理员 Hub 在首屏加载完成后只按空闲时间预载相邻二级页面；悬停或聚焦目标页时按需预载；不自动预载会触发 worker 探测的环境页。隐藏的同源 iframe 在切换时直接复用，不重新执行页面启动流程。
- 页面配置和 API 响应仍使用 `Cache-Control: no-store`，避免把权限或票据数据缓存到浏览器。
- AI 结果卡片的完整详情仍只保存在浏览器内存；服务端审计只保留模型、耗时、Token、工具调用数、结束原因和失败阶段等安全元数据。是否把完整卡片详情持久化到数据库仍是待决策项，避免在未确定隐私边界前保存正文。

## 持久化边界


当前写入本地文件的数据：

- `users.json`：账号哈希、角色、MFA 状态；
- `api-keys.json`：调用密钥哈希、名称、配额和过期时间；
- `state.db`：当前票据、活动状态、SSE 日志、认领状态和幂等记录的 SQLite 状态库；没有 `node:sqlite` 时回退旧 JSON/journal；
- `state.json` / `state.json.journal`：旧版状态快照和 journal；SQLite 可用时只作为首次迁移来源；
- `history.db`：已完成票据的 SQLite/FTS5 索引；历史页和 CSV 导出优先走索引，Node 不支持 `node:sqlite` 时回退到内存筛选；
- 外部 Python worker（默认参考 `scripts/normalize-image.py` 和 `scripts/render-pdf-page.py`）：由 `config.jsonc → workers` 指定绝对/相对路径；仅检测配置路径，发布包默认不携带脚本；图片 worker 负责临时重编码并剥离 EXIF，PDF worker 负责按需渲染单页；
- `usage.json`：分钟/日/月计数和每日历史；
- `settings.json`：设置页覆盖值；
- `audit.log`：登录、账号、密钥、设置和票据事件；
- `attachments/`：附件原件和元数据，目录权限 0700，文件 0600。

仍在内存中的数据：

- 当前网络连接和正在写入的 socket；
- 登录会话、CSRF token、登录失败计数；
- 当前进程内的并发占用。

因此：

- 不能在多实例间共享队列；
- 重启后活动票据会恢复，但原 socket 不会；带 `Idempotency-Key` 的调用方可以重连；
- 已完成请求和幂等记录可以恢复；
- 会话需要重新登录；
- 单进程运行，没有 HA。

生产化方向：SQLite/Postgres 票据表、Redis 会话、对象存储附件、反向代理限流。
