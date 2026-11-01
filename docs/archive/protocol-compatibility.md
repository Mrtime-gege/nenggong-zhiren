# 协议兼容检查（2026-10-30）

## 已支持

### OpenAI 兼容

- `POST /v1/chat/completions`
- `GET /v1/models`
- `Authorization: Bearer …`
- 普通 JSON 与 SSE 流式响应
- `stream_options.include_usage`
- `tools` / `tool_choice` / `parallel_tool_calls`
- `response_format`（JSON object / json_schema）
- 多轮消息、system/developer、工具结果、`tool_call_id`
- `max_tokens` / `max_completion_tokens`、`stop`、`user`
- `image_url`、`input_image`、`file` / `input_file`
- `Idempotency-Key` 完成重放、活动请求加入和断线重连
- 工具调用、拒答、思考内容、usage

### Anthropic Messages

- `POST /v1/messages`
- `x-api-key` / `anthropic-version`
- 普通 JSON 与 SSE 事件
- `system` 字符串/文本块数组
- `max_tokens`、`stop_sequences`
- `tools` / `tool_choice` / `tool_use` / `tool_result`
- `image` base64 / URL
- usage、`stop_reason`、错误结构
- 图片/文件会进入票据附件，回复员可在工作台查看

## 明确未支持

- OpenAI Responses API（`/v1/responses`）
- OpenAI Batches、Embeddings、Files 管理 API（仅有附件上传端点）
- OpenAI 旧版 `/v1/completions`
- Anthropic 旧版 `/v1/complete`
- Anthropic `count_tokens`
- `n > 1`、logprobs、audio、图片生成等
- 官方 SDK 的 beta 特性通常不会报错，但不会产生对应行为

## 本轮的额外检查

新增回归：

- OpenAI `input_image` 别名；
- Anthropic base64 图片输入；
- 图片附件必须标记为 `type: "image"`；
- 图片 URL 数量/总字节、messages 数量、content part 数量的上限；
- 协议错误仍然保持 OpenAI / Anthropic 各自的错误形状。

测试结果：

```text
tests 58
pass 58
fail 0
```

## 仍建议补的兼容测试

1. 用官方 `openai` 和 `@anthropic-ai/sdk` 做契约测试（仅开发依赖，不影响运行时零依赖）；
2. OpenAI Responses API 支持或明确返回 404 路由；
3. Anthropic `document` 文件块和 `tool_result` 内嵌图片；
4. OpenAI `input_file` 别名和 `image_url` 字符串简写；
5. 大模型客户端常见的 `n`、`logprobs`、`service_tier` 等字段的错误/忽略策略；
6. DSH 之外再验证一个真实 SSE 客户端在弱网下的重连恢复。

## 结论

当前 OpenAI Chat Completions 和 Anthropic Messages 的主路径、流式、工具、图片、附件和错误格式均有回归覆盖。
未发现本轮改动导致协议回归；主要兼容缺口是 OpenAI Responses API 和官方 SDK 契约测试，而不是现有两条主协议。
