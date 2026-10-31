# 架构

## 0.6.0 分层

- **配置层**：`src/config.mjs` 只读取根目录 `config.jsonc`；不读取环境变量，也不接受运行参数。
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

- 票据写操作只允许当前认领人；管理员可以取消或转交，但不会绕过认领人直接编辑。
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

## 持久化边界

当前写入本地文件的数据：

- `users.json`：账号哈希、角色、MFA 状态；
- `api-keys.json`：调用密钥哈希、名称、配额和过期时间；
- `state.json`：活动/已完成票据、SSE 日志、认领状态和幂等记录快照；
- `state.json` / `state.json.journal`：旧版状态快照和 journal；SQLite 可用时作为首次迁移来源；
- `state.db`：票据、活动状态、附件元数据和幂等记录的 SQLite 状态库；没有 `node:sqlite` 时自动回退旧 JSON/journal；
- `history.db`：已完成票据的 SQLite/FTS5 索引；历史页和 CSV 导出优先走索引，Node 不支持 `node:sqlite` 时回退到内存筛选；
- `scripts/normalize-image.py`：可选的独立 PIL worker；上传的栅格图片在临时目录中重编码，限制 CPU/内存并剥离 EXIF；
- `scripts/render-pdf-page.py`：可选的 `pypdfium2` worker；按需把 PDF 单页渲染成 PNG，限制页数、尺寸、CPU、内存和并发；
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
