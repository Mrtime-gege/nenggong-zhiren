# 把能工智人接入 DSH

DSH 通过 `@deepseek-ai/dsh-llm-pi-ai` 插件接入自定义 OpenAI 兼容网关。能工智人暴露的是
`/v1/chat/completions`、`/v1/models`、标准工具调用、JSON 模式、拒答和思考内容，因此可以
直接作为一条 `llm-pi-ai` 路由。

## 1. 启动能工智人

```bash
cd nenggong-zhiren
# 先在网页 /console/keys 生成调用密钥，再把 key 填到 DSH 配置
QUEUE_TIMEOUT_MS=7200000 \
RESPONSE_TIMEOUT_MS=7200000 \
node server.mjs
```

首次启动会在日志里打印一次随机管理员密码；账号哈希保存在项目根目录 `users.json`。
确认：

```bash
curl -s http://127.0.0.1:7355/healthz
curl -s -H 'Authorization: Bearer <CALLER_KEY>' http://127.0.0.1:7355/v1/models
```

坐席从 <http://127.0.0.1:7355/login> 登录；账号用
`node scripts/user.mjs add <name>` 创建。

## 2. 加入 `llm-pi-ai` 路由

编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`，在已有的 `- id: llm-pi-ai` 条目的
`config.providers` 下加入 [`cordis.patch.snippet.yml`](cordis.patch.snippet.yml) 的内容。
关键点：

- `api: openai-completions`：自定义路由必须显式声明协议；
- `baseURL` 必须包含 `/v1`；
- `models` 必须显式列出，因为 `human-provider` 不在 pi-ai 的内置目录里；
- `apiKeyEnv` 只是凭据引用名，不是密钥本身；
- `timeoutMs` / `streamIdleTimeoutMs` 放大到 15 分钟，给人类坐席留出打字时间；
- 如果要让 DSH 把图片交给坐席，可在 model 条目加 `input: [text, image]`（能工智人支持
  `image_url`，但 DSH 只有在目录声明 image 时才会发图片）。

## 3. 保存凭据

推荐在 DSH Web GUI 的 **Settings → Models → Human Provider → API key** 填写
网页里生成的调用密钥。

也可以直接编辑 `$DSH_HOME/.credentials.yaml`，在 `refs:` 下加入：

```yaml
  HUMAN_PROVIDER_KEY: <CALLER_KEY>
```

保存后 DSH 会自动重载，通常不需要重启。把示例值替换成你自己的 key，不要提交
`.credentials.yaml` 或任何真实凭据。

## 4. 在 DSH 中选择模型

刷新 Web GUI → 打开模型选择器 → **Model → Human 1 / Human 1 Fast**。

DSH 的 `llm-pi-ai` 会把工具 schema、工具结果、`stream_options.include_usage` 和
`max_completion_tokens` 一起发过来；Human Provider 负责把这些交给坐席控制台，再把坐席的
文本/工具调用包装成标准 SSE 返回。

## 5. 实测链路（已验证）

```text
DSH 提示：请用 bash 工具运行 pwd，然后告诉我当前工作目录是什么。
  → Human Provider 票据（67 tools，tool_choice=auto）
  → 坐席返回 tool_call: bash({"command":"pwd","description":"Print current working directory"})
  → DSH 执行 bash，得到示例工作目录
  → 第二次请求带 tool result
  → 坐席返回文本，内容为示例工作目录
  → DSH 会话完成，展示 Bash 工具卡片和最终答案
```

同一轮里 DSH 还会发一个 **会话标题生成** 请求（无 tools）。坐席同样在控制台回答它；
否则会话标题会一直停在占位状态。

## 排查

- 模型选择器里没有 Human Provider：检查 DSH 的 `Settings → Models` 是否有该 provider 的错误；
  或调用 `POST /api/session/modelCatalog`（需要浏览器登录态）查看 `groups` / `failures`。
- Human Provider 显示但模型不可选：确认 `HUMAN_PROVIDER_KEY` 已配置，且 Human Provider 的
  `/v1/models` 可访问。
- 模型请求 401：DSH 发出的 key 已在网页里停用、删除或填错。
- 请求超时：Human Provider 的 `QUEUE_TIMEOUT_MS` / `RESPONSE_TIMEOUT_MS` 和 DSH 路由的
  `timeoutMs` / `streamIdleTimeoutMs` 都要放大。
- DSH 报工具调用解析失败：确认 Human Provider 发送的是 `tool_calls` delta，并且最后是
  `finish_reason: "tool_calls"`。

## 安全

- 不要把 `/console` 和 `/op/api` 直接暴露公网；至少加 TLS、网络 ACL 和反代访问控制。
- 坐席登录密码与调用方 API Key 是两套凭据；生产环境不要用示例值。
- 人类坐席会看到完整的 prompt、工具 schema 和工具结果，需要隐私告知和访问审计。
- 默认 HTTP 不加密；生产请用项目内置 TLS 或反代 TLS，并设置 `COOKIE_SECURE=1`。
