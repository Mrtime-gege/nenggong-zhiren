# 能工智人 · nenggong-zhiren

> 一个 OpenAI 兼容的「大模型」服务。模型权重不存在，真正生成回复的是登录后的坐席。

## 先说人话

能工智人是一套**碳基推理后端**：前面假装自己是 OpenAI，后面坐着一排会喝咖啡、会手抖、
会在群里问“这个需求到底什么意思”的人类。`POST /v1/chat/completions` 进来，票据进队列，
坐席认领、敲字、点完成，调用方收到标准的 `chat.completion` / SSE。工具调用、JSON、拒答、
思考内容、图片附件都能走，**但算力来自工位，不来自显卡**。

它的参数规模取决于今天几个人值班，推理速度取决于奶茶配送，上下文窗口取决于交班记录写得
清不清楚，幻觉率取决于坐席昨晚睡得好不好。唯一确定的是：**这不是 AI，别让它在生产环境装 AI。**

> ⚠️ **严肃警告，不是段子**
>
> - 本项目是局域网、教学和「人在环」实验，不是生产级模型服务；不要在真实生产环境使用。
> - **不要**把它包装成真实大模型供应商，也不要用它冒充 OpenAI 等模型对外提供服务。
> - 工具调用不是装饰：客户端执行工具时，工具通常拥有**和发起请求的程序相同的权限**。
>   恶意或有误的操作者/服务商可以精心构造看似正常的响应和工具调用，让客户端读文件、跑命令、
>   改数据。把它接到有权限的 Agent 上之前，先把权限关进笼子。
> - 只在你信任操作者、能限制工具权限、能接受人工延迟的环境里使用。

能工智人把 `POST /v1/chat/completions` 接到带账号、队列、流式输出和工具调用编辑器的人工
坐席控制台。调用方拿到标准 `chat.completion` / SSE，坐席在 Web 工作台里认领票据、输入回复
并完成请求。

发布包只包含运行所需程序、配置样例、账号管理工具和部署文档。

## 环境要求

- Node.js ≥ 20（使用 Node 24 运行）
- Linux、macOS 或 WSL
- 无需 `npm install`，没有第三方运行时依赖

```bash
node -v
```

## 最短启动

解压发布包后进入目录：

```bash
cd nenggong-zhiren-0.3.0
cp .env.example .env
```

编辑 `.env`，至少设置一个调用方 key：

```ini
HOST=0.0.0.0
PORT=7355
HUMAN_KEYS=replace-with-a-long-random-key:web
```

启动：

```bash
npm start
```

也可以直接在命令行传变量：

```bash
HUMAN_KEYS='replace-with-a-long-random-key:web' node server.mjs
```

首次启动会在项目根目录创建 `users.json`，并打印一次随机管理员密码：

```text
username: admin
password: XXXXXXXXXXXXXXXXXXXXXXX
```

保存密码，打开：

```text
http://127.0.0.1:7355/login
```

登录后在右上角「用户管理」添加坐席或管理员。

更完整的启动、后台运行、systemd、健康检查、停止重启和排错见
[docs/quickstart.md](docs/quickstart.md)。

## 运行方式

```bash
# 前台
npm start

# 后台
mkdir -p "$HOME/.local/state/nenggong-zhiren"
nohup node server.mjs >"$HOME/.local/state/nenggong-zhiren/server.log" 2>&1 &
echo $! >"$HOME/.local/state/nenggong-zhiren/server.pid"
```

生产环境推荐 systemd，unit、权限和反向代理示例见
[docs/deployment.md](docs/deployment.md)。

启动后检查：

```bash
curl -fsS http://127.0.0.1:7355/healthz
curl -fsS http://127.0.0.1:7355/v1/models \
  -H 'Authorization: Bearer replace-with-a-long-random-key'
```

## 账号管理

- 账号保存在项目根目录 `users.json`，只保存 scrypt 哈希，文件权限 `0600`。
- 管理员可在 Web 控制台添加、重置密码、删除账号。
- 也可以通过 CLI 管理：

```bash
node scripts/user.mjs list
NGZR_USER_PASSWORD='another-long-password' node scripts/user.mjs add alice --role operator
NGZR_USER_PASSWORD='new-long-password' node scripts/user.mjs passwd alice
node scripts/user.mjs remove alice
```

`users.json` 和 `.env` 只保留在本机，不要放进公开目录。

## 调用方 API

```http
Authorization: Bearer <HUMAN_KEYS 中的 key>
```

```bash
curl -N http://127.0.0.1:7355/v1/chat/completions \
  -H 'Authorization: Bearer replace-with-a-long-random-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "human-1",
    "stream": true,
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

主要能力：

- 流式 / 非流式对话；
- 工具调用、`tool_choice`、JSON Schema 参数校验；
- `response_format` JSON 对象/JSON Schema；
- 拒答、思考内容、图片输入；
- `Idempotency-Key` 回放；
- usage、`x-request-id`、限速响应头。

完整协议见 [docs/protocol.md](docs/protocol.md)。

## 接入 DSH

项目附带 DSH 的 `llm-pi-ai` 路由示例：

```yaml
human-provider:
  displayName: 能工智人
  api: openai-completions
  baseURL: http://127.0.0.1:7355/v1
  apiKeyEnv: HUMAN_PROVIDER_KEY
  models:
    - id: human-1
      name: Human 1
      contextWindow: 131072
      maxTokens: 8192
      reasoningEfforts: false
```

把 `HUMAN_PROVIDER_KEY` 配成 `HUMAN_KEYS` 中的 key。详见
[integrations/dsh/README.md](integrations/dsh/README.md)。

## 安全与运行边界

- 默认 HTTP 不加密传输；公开部署必须启用项目内置 TLS 或反向代理 HTTPS。
- `users.json` 和 `.env` 包含敏感信息，只保留本机。
- 调用方 key 与坐席密码分开管理，不要使用示例值。
- 票据、会话和幂等记录在内存中，进程重启会丢失未完成请求。
- 没有 MFA/SSO、细粒度 RBAC、持久化队列或高可用。

安全模型和残余风险见 [docs/security.md](docs/security.md)，部署建议见
[docs/deployment.md](docs/deployment.md)。

## 项目结构

```text
server.mjs              HTTP / 票据 / SSE / 协议入口
src/auth.mjs            账号、密码哈希、会话与 CSRF
src/schema.mjs          JSON Schema 子集校验
public/                 登录页与坐席控制台
scripts/user.mjs        账号管理 CLI
docs/                   启动、协议、安全、部署文档
integrations/dsh/       DSH 路由示例
```

## License

MIT，见 [LICENSE](LICENSE)。
