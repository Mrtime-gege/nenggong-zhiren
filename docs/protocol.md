# 协议兼容性

目标：对常见 OpenAI Chat Completions 客户端“看起来像”一个正常供应商；不伪装成
OpenAI 官方服务。

## 端点

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/healthz` | 无 | 最小健康检查，不泄露队列/用户信息 |
| GET | `/login` | 无 | 登录页 |
| POST | `/auth/login` | Origin | 表单或 JSON 登录 |
| POST | `/auth/logout` | Cookie + CSRF | 注销 |
| GET | `/auth/me` | Cookie | 当前用户、CSRF token、配置 |
| GET | `/console` | Cookie | 坐席控制台 |
| GET | `/v1/models` | Bearer | 模型列表 |
| GET | `/v1/models/{id}` | Bearer | 单模型 |
| POST | `/v1/chat/completions` | Bearer / x-api-key | OpenAI 对话补全 |
| POST | `/v1/messages` | x-api-key / Bearer | Anthropic Messages 格式 |
| GET | `/op/api/tickets` | Cookie | 票据列表 |
| POST | `/op/api/tickets/{id}/claim` | Cookie + CSRF | 认领 |
| POST | `/op/api/tickets/{id}/chunk` | Cookie + CSRF | 推送文本 |
| POST | `/op/api/tickets/{id}/finish` | Cookie + CSRF | 完成 / 工具调用 / 拒答 |
| POST | `/op/api/tickets/{id}/release` | Cookie + CSRF | 放回队列 |
| POST | `/op/api/tickets/{id}/cancel` | Cookie + CSRF | 取消 |

`/v1/responses` 未实现，返回 404。

调用密钥由管理员在网页「调用密钥」里生成，保存在数据文件中，不来自环境变量。

## `POST /v1/messages`

Anthropic Messages 请求：

```json
{
  "model": "human-1",
  "max_tokens": 256,
  "system": "可选系统提示",
  "stream": false,
  "messages": [
    {"role": "user", "content": "你好"}
  ],
  "tools": [
    {"name": "get_weather", "description": "查天气", "input_schema": {"type": "object"}}
  ]
}
```

- 认证头：`x-api-key: <调用密钥>` 或 `Authorization: Bearer <调用密钥>`。
- 非流式返回 `type: "message"`、`content` 区块、`stop_reason` 和 `usage.input_tokens/output_tokens`。
- `stream: true` 返回 Anthropic 事件：`message_start`、`content_block_start`、
  `content_block_delta`、`content_block_stop`、`message_delta`、`message_stop`。
- 工具调用在响应中表示为 `content: [{type:"tool_use", ...}]`，`stop_reason` 为 `tool_use`。
- 图片支持 `source.type: "base64"` 和 `source.type: "url"`。

## `POST /v1/chat/completions`

### 请求字段

| 字段 | 支持 | 备注 |
| --- | --- | --- |
| `model` | ✅ | 必须在 `config.jsonc` 的 `models.ids` 中 |
| `messages` | ✅ | system/user/assistant/tool；支持文本和图片 |
| `stream` | ✅ | SSE |
| `stream_options.include_usage` | ✅ | 最后一个 chunk 带 usage |
| `max_tokens` / `max_completion_tokens` | ✅ | 截断后 `finish_reason=length` |
| `stop` | ✅ | 字符串或字符串数组 |
| `tools` | ✅ | function tools，最多 128 个 |
| `tool_choice` | ✅ | auto/none/required/指定函数 |
| `parallel_tool_calls` | ✅ | false 时拒绝多工具 |
| `response_format` | ✅ | text/json_object/json_schema |
| `temperature` / `top_p` / `seed` | 忽略 | 人类输出没有采样参数 |
| `n` | ❌ | 仅 `1`；其他返回 `unsupported_n` |
| `logprobs` / `top_logprobs` | ❌ | 返回 `unsupported_logprobs` |
| `user` | 透传 | 只记录/展示，不作为身份 |
| `metadata` / `store` | 忽略 | 未实现 |

### 非流式响应

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1767225600,
  "model": "human-1",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "人类写的回复"
    },
    "logprobs": null,
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 18,
    "completion_tokens": 26,
    "total_tokens": 44,
    "prompt_tokens_details": {"cached_tokens": 0},
    "completion_tokens_details": {"reasoning_tokens": 0}
  },
  "system_fingerprint": "fp_..."
}
```

Token 数是基于字符的估算（CJK 按 1，其他按约 4 字符/token），**不是**真实 tokenizer；
不要用它做精确计费。

### 工具调用响应

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_...",
        "type": "function",
        "function": {"name": "get_weather", "arguments": "{\"city\":\"上海\"}"}
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

参数会先经过 JSON Schema 校验；失败时不会产生 tool_calls。

### 拒答

```json
{
  "choices": [{
    "message": {"role": "assistant", "content": null, "refusal": "无法协助这个请求。"},
    "finish_reason": "content_filter"
  }]
}
```

### 思考内容

- 非流式：`message.reasoning_content`
- 流式：`choices[0].delta.reasoning_content`
- usage：`completion_tokens_details.reasoning_tokens`

思考内容不计入 `content`。客户端不支持该字段时可以忽略。

## SSE 流

正常事件顺序：

```text
data: {"choices":[{"delta":{"role":"assistant","content":""}}]}
data: {"choices":[{"delta":{"reasoning_content":"..."}}]}        # 可选
data: {"choices":[{"delta":{"content":"..."}}]}
data: {"choices":[{"delta":{"tool_calls":[...]}}]}                # 可选
data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
data: {"choices":[],"usage":{...}}                                # include_usage
data: [DONE]
```

- 每 15 秒发送 `: keep-alive` 注释，防止代理超时。
- `Content-Type: text/event-stream; charset=utf-8`。
- 反代必须关闭响应缓冲（`X-Accel-Buffering: no`，nginx `proxy_buffering off`）。
- JSON 模式在 `finish` 校验通过前不发送 content；非法草稿不会泄漏。
- 拒答只发送 `refusal` delta。

## `response_format`

### `json_object`

坐席完成时，服务端 `JSON.parse` 文本；必须是对象。失败返回
`400 invalid_response_json`，票据保持可编辑。

### `json_schema`

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "answer",
      "strict": true,
      "schema": {}
    }
  }
}
```

校验器是 JSON Schema 子集，支持：

- `type`、`enum`、`const`
- `required`、`properties`、`additionalProperties`
- `items`、`minItems`、`maxItems`
- `minLength`、`maxLength`
- `minimum`、`maximum`
- `anyOf`、`oneOf`、`allOf`

忽略：`pattern`、`format`、`$ref`、`dependentSchemas` 等。不要把安全边界建立在被忽略的
关键字上。

## 图片

`messages[].content` 可以是：

```json
[
  {"type": "text", "text": "这张图里是什么？"},
  {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
]
```

附件会出现在坐席控制台的附件面板。服务端不解析图片内容，只校验 data URL 前缀和大小；
坐席需自行确认来源。外链 URL 不会被服务端主动抓取。

## `Idempotency-Key`

- 请求头，1–128 个 URL-safe 字符。
- 作用域：调用方 key + key 字符串。
- 同一请求体：返回原响应；流式请求按原 SSE 顺序回放。
- 不同请求体：409 `idempotency_key_conflict`。
- 记录 30 分钟；票据先被回收时返回 410 `idempotency_expired`。
- 只对 `/v1/chat/completions` 生效。

## 响应头

| 头 | 说明 |
| --- | --- |
| `x-request-id` | 每个请求的随机 ID |
| `x-ratelimit-limit-requests` | 每个调用方 key 的并发上限 |
| `x-ratelimit-remaining-requests` | 当前剩余并发槽 |
| `x-ratelimit-reset-requests` | 估算重置窗口（当前实现为 `1s`） |
| `Access-Control-Allow-Origin` | `/v1` CORS |
| CSP / X-Frame-Options / nosniff | 全站安全头 |

## 错误

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `invalid_json` | 请求体不是 JSON |
| 400 | `invalid_body` | 根不是对象 |
| 400 | `missing_model` / `model_not_found` | 模型缺失/未知 |
| 400 | `unsupported_n` | `n>1` |
| 400 | `unsupported_logprobs` | `logprobs:true` |
| 400 | `invalid_tool_arguments` | 工具参数 schema 不匹配 |
| 400 | `invalid_response_json` | JSON 模式校验失败 |
| 400 | `invalid_idempotency_key` | key 含非法字符 |
| 401 | `missing_api_key` / `invalid_api_key` | 调用方认证失败 |
| 401 | `login_required` | 坐席未登录 |
| 403 | `invalid_csrf` / `invalid_origin` | CSRF/Origin 失败 |
| 409 | `ticket_not_queued` / `ticket_closed` | 票据状态冲突 |
| 409 | `idempotency_key_conflict` | 幂等 key 复用但请求体不同 |
| 410 | `client_gone` | 调用方断开 |
| 413 | `payload_too_large` | 请求体超限 |
| 421 | `untrusted_host` | Host 不在白名单 |
| 429 | — | 登录/并发限速 |
| 503 | `queue_timeout` / `response_timeout` | 坐席超时 |

错误体格式：

```json
{
  "error": {
    "message": "…",
    "type": "invalid_request_error",
    "param": null,
    "code": "…"
  }
}
```

## 不做的事

- 不实现 `/v1/responses`。
- 不实现 `logprobs`、`n>1`。
- 不训练/调用模型。
- 不保证与 OpenAI 完全字节级一致；只保证常见客户端需要的形状。
