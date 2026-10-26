# 架构

## 一句话

浏览器里的坐席和 API 调用方共享同一个票据（ticket）状态机；服务端只负责排队、鉴权、
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
- `src/auth.mjs`：用户文件、scrypt 哈希、内存会话、CSRF、登录失败限速、热重载。
- `src/schema.mjs`：零依赖 JSON Schema 子集校验器。
- `public/console.*`：坐席控制台（无构建步骤，原生 ES modules）。
- `public/login.*`：登录页。
- `scripts/user.mjs`：账号 CLI。

## 请求生命周期

1. `POST /v1/chat/completions` 校验 `Authorization`、Host、Origin、请求体和模型。
2. 规范化 `messages`、图片附件、tools、`response_format`、停止符、max tokens。
3. 创建 ticket，状态 `queued`；非流式请求挂起，流式请求先不写响应头。
4. 坐席登录后通过 `/op/api/tickets` 看到票据，`claim` 把它变成 `claimed`。
5. 坐席 `chunk` 或 `finish`：
   - 非 JSON 模式：文本可以边写边流；
   - JSON 模式：文本先缓冲，`finish` 时校验后才发送；
   - 工具调用：参数按 schema 校验；
   - 拒答：设置 `refusal`，不发送 content。
6. `finish` 后状态 `done`，写 `finish_reason`、usage、`[DONE]`，释放并发槽。
7. 票据保留 `RETENTION_MS` 供控制台查看和幂等回放。

## 状态机

```text
queued ──claim──► claimed ──chunk/finish──► streaming ──finish──► done
  │                 │                          │
  │                 ├── release ──► queued     └── cancel ──► failed
  └── queue timeout / cancel ──► failed
```

- `content_filter` 是 `finish_reason`，不是 ticket 状态。
- `claimed` 可以一直不发送文本；`streaming` 表示至少推送过一个 SSE 数据块（或已开始流）。
- 客户端断开时，服务端会取消或丢弃票据，避免继续占用坐席。

## 并发与资源

- 每个调用方 key 最多 `MAX_CONCURRENT_PER_KEY` 个未完成票据。
- 队列超时 `QUEUE_TIMEOUT_MS`；坐席认领后超时 `RESPONSE_TIMEOUT_MS`。
- 每个票据的 SSE 发送串行化，避免并发写乱序。
- 心跳每 15 秒，防止反代把长连接当空闲连接断开。
- 所有状态在单进程内存；重启即丢失未完成票据和会话。

## 为什么 JSON 模式要缓冲

如果坐席边写边发，调用方可能先收到一段非法 JSON，再收到错误；这对依赖
`JSON.parse` 的客户端是破坏性的。因此 JSON 模式在 `finish` 之前不写 content；
校验失败时票据保持可编辑，草稿和已输入文本不丢。

## 为什么登录和调用方 key 分开

- 调用方 key 是机器对机器凭据，可轮换、可多把。
- 坐席会话是人的凭据，带 CSRF、Cookie、空闲超时和登录限速。
- 两者不共用，避免“拿到 API key 就能冒充坐席”或反过来。

## 持久化边界

当前只持久化用户文件 `users.json`（项目根目录，仅供本机）。票据、会话、登录失败计数、幂等记录都在内存。
这使实现简单、无外部依赖，但也意味着：

- 不能在多实例间共享队列；
- 重启后调用方会收到连接错误；
- 会话需要重新登录。

生产化方向：SQLite/Postgres 票据表、Redis 会话、对象存储附件、反向代理限流。
