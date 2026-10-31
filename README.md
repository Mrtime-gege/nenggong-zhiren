<p align="center"><img src="public/icon.svg" width="96" height="96" alt="能工智人图标" /></p>

# 能工智人 · nenggong-zhiren

> 一个按 OpenAI 聊天接口格式对外提供服务的「人工回复」项目。
> 这里没有模型权重，真正动脑子的是一群会喝咖啡、会手抖、会在群里问“这个需求到底什么意思”的真人。

## AI 开发声明

**本项目由 AI 开发。** 代码、界面、文档和发布材料由 AI 生成，人工维护者负责提出需求、审查结果、验证运行和决定是否发布。项目本身不是 AI 模型，也不使用模型权重；它提供的是一种由真人接单回复的兼容接口。

> **不是 AI 中转站：**能工智人是人工回复工作台，不是 AI API 中转、模型代充或自动聊天服务。管理员可选开启的 AI 辅助只向回复员提供摘要、翻译和草稿建议，不会自动回复调用方。

## 先说人话

能工智人是一套**碳基回复服务**：前面看起来像常见的 AI 接口，后面坐着值班的人。调用方把
请求发进来，请求进入等待列表；真人接单、看上下文、写回复、点发送；调用方最后收到的是一份
正常的聊天回复，格式和普通大模型服务差不多。

它的“参数规模”取决于今天几个人值班，“推理速度”取决于奶茶配送，“上下文窗口”取决于交班
记录写得清不清楚，“幻觉率”取决于值班的人昨晚睡得好不好。**本项目由 AI 开发，但它运行时不是 AI 模型，也不应该在真实生产环境中冒充 AI。**

## 先读警告，不是段子

- 本项目适合局域网、教学演示、内部工具和「人在环」实验，**不适合真实生产环境**。
- **不要**把它包装成真实大模型供应商，也不要用它冒充任何模型服务对外提供能力。
- 让程序执行工具时，工具通常拥有**和发起请求的程序相同的权限**。一个恶意或有误的
  操作者/服务商，可以精心构造看起来正常的回复和工具调用，让程序读文件、执行命令、修改数据。
- 只在你信任操作者、能限制工具权限、能接受人工延迟的环境里使用。
- 不要用来源不明的服务地址、密钥或“模型”，也不要把有权限的程序随随便便接到陌生服务上。

## 能做什么

| 能力 | 状态 | 用大白话说 |
| --- | --- | --- |
| 聊天回复 | 支持 | 一次返回完整回复，或者边写边发 |
| 工具调用 | 支持 | 让调用程序执行外部操作，参数会按约定格式检查 |
| 结构化输出 | 支持 | 要求回复必须是带固定字段的数据，不合格就不会发出去 |
| 拒答 | 支持 | 明确表示不能回答，并告诉调用方原因类型 |
| 思考内容 | 支持 | 与正文共用编辑区，用快捷键决定发成思考还是正文 |
| 图片输入 | 支持 | 图片会显示在网页工作台，方便真人查看 |
| 文件附件 | 支持 | 文本、日志、JSON、CSV、PNG/JPEG/GIF/WebP、PDF；回复员在安全预览抽屉中查看 |
| 重复请求 | 支持 | 同一个请求编号再次发来，可以拿回原来的结果 |
| 用量与频率提示 | 支持 | 返回本次请求的用量和频率限制信息 |
| 多人登录 | 支持 | 管理员可以在网页里添加、重置、删除账号 |
| 局域网访问 | 支持 | 默认监听所有网卡，同网段浏览器可以打开 |
| 模型列表 | 支持 | 调用方可以查询当前声明的模型名 |
| 快捷回复 | 支持 | 模板保存在当前浏览器，插入时替换调用方/模型/票据变量 |
| 票据转交 | 支持 | 已认领且未开始流式发送的票据可以转给其他坐席 |
| 会话聚合 | 支持 | 同一请求会话的多张票据自动归组，并显示轮次和首选回复员 |
| 连续接待 | 支持 | 新票据优先提示给会话的原回复员，可一键继续接待 |
| 活动队列持久化 | 支持 | 运行中票据、SSE 日志和认领状态写入状态文件，重启后恢复 |
| 断线重连 | 支持 | 带 `Idempotency-Key` 的调用方可断开后重连，继续接收 SSE 或等待完成 |
| 可调工作区 | 支持 | 拖动面板边缘调整工具区、对话/输出比例；调整工具区时保持对话列宽度；双击恢复默认 |
| 运营审计 | 支持 | 登录、账号、密钥、设置和票据操作写入本地审计文件，可导出 CSV |
| 全局历史 | 支持 | 按会话、模型、状态、调用方、回复员、日期和全文检索，并导出 CSV |
| 监控指标 | 支持 | Prometheus `/metrics`，队列积压和最长等待可触发 webhook 告警 |
| 管理员 MFA | 支持 | 可选 TOTP，密码 + 6 位验证码登录 |
| 思考等级提示 | 支持 | `reasoning_effort` 作为回复员的工作深度提示显示在票据上 |
| 流式思考 | 支持 | OpenAI 流式请求可分段推送 `reasoning_content`，不必等完成 |
| 流式工具轮次 | 支持 | 思考推送后，可立即发送工具调用并以 `finish_reason=tool_calls` 结束本轮 |
| `/v1/responses` | 不支持 | 本项目只做聊天接口，不扩展另一套接口 |
| `logprobs` / `n>1` | 不支持 | 不提供逐词概率，也不支持一次返回多份候选 |

## 依赖策略

核心服务坚持“零外部媒体依赖即可运行”：

- 不需要 `npm install`，没有运行时 npm 依赖；
- 文本、JSON、CSV、PDF 文字抽取、图片文件头/尺寸校验、上传和预览兜底都由 Node 完成；
- AI 辅助是可选外部能力，默认关闭，需管理员配置；
- 图片重编码和 PDF 页图是可选增强，默认关闭；
- 可选增强只在显式开启时调用独立 Python worker；worker 不可用时回退原图/文字预览；
- 不自动安装依赖，不加载远程脚本，不把外部命令拼接进 shell。

可选依赖：

| 功能 | 依赖 | 开启方式 | 不可用时 |
| --- | --- | --- | --- |
| 图片重编码 | Python 3 + Pillow | `attachments.reencodeImages: true` | 保留原图，基础校验仍生效 |
| PDF 页图 | Python 3 + `pypdfium2` | `attachments.pdfPagePreview: true` | 只显示 PDF 文字预览，可下载原文件 |
| AI 建议 | OpenAI 兼容服务 | 管理员启用并配置 Endpoint/Key | 不显示 AI 工具条 / 接口明确报错 |

## 安装和启动

### 需要什么

- Node.js 20 或更高版本；
- Linux、macOS 或 Windows 的 WSL；
- 基础功能不需要安装第三方库，不需要先执行 `npm install`；
- 可选媒体增强：`Pillow`（图片重编码）、`pypdfium2`（PDF 页图），默认不启用。

检查版本：

```bash
node -v
```

### 最短启动

```bash
cd nenggong-zhiren
cp config.example.jsonc config.jsonc
```

打开 `config.jsonc`，按里面的注释改监听地址和端口。**不要把调用密钥写进配置文件**：
启动后登录网页，在顶部「API 密钥」里生成。

然后启动：

```bash
npm start
```

第一次启动时，如果目录里还没有 `users.json`，程序会自动创建一个管理员，并在终端里显示
一次随机密码。把它保存好；这个密码之后不会再显示。登录后先生成一个调用密钥，再把它交给
调用方或填到 DSH 的配置里。

打开浏览器：

```text
http://127.0.0.1:7355/login
```

登录后，顶部导航可以直接切换：

- **状态**：`/console/status`，以信号核心仪表盘查看进程、队列流、运行配置、存储文件和最近操作信号；管理员登录后默认进入这里；
- **坐席**：`/console`，处理等待中的请求；
- **教程**：`/console/guide`，登录后在控制台子页面查看调用方、回复员和管理员的新手教程；管理员可在设置中允许未登录访客访问 `/guide`；
- **用户管理**：`/console/users`，添加和编辑回复员/管理员、修改角色、重置密码、删除账号，并限制每个回复员可回复的模型；
- **模型**：`/console/models`，添加和删除对外模型名；删除前会检查调用密钥、回复员权限和未结束票据的引用；
- **API 密钥**：`/console/keys`，生成、编辑、轮换调用密钥，设置名称/自定义密钥/配额/模型范围/永不过期或具体到期时间；模型只能从「模型」页面启用项中多选；
- **用量**：`/console/usage`，按密钥、状态、模型、UTC 日期和多个密钥组合筛选，查看分钟/日/月用量、区间统计和趋势，并导出当前筛选结果；
- **历史**：`/console/history`，按会话、模型、状态、调用方、回复员、日期和全文检索已结束票据，并导出当前筛选结果；
- **审计**：`/console/audit`，查看登录、账号、密钥、设置和票据操作，支持 CSV 导出；
- **设置**：`/console/settings`，所有回复员可管理自己的个性化设置（浏览器通知、提示音、自动接单、排队提醒）；管理员另外管理运行参数、功能开关、AI 辅助配置和 MFA。

页面导航由 `public/navigation.js` 的页面清单统一生成，后续添加新页面只需增加一条配置和对应路由。

坐席工作台支持服务端共享/个人快捷回复、票据内部备注、标签/优先级和票据转交；标签与优先级用于队列排序和人工路由，转交时可带交接说明。转交只适用于已认领且尚未开始流式发送的票据。
列表页和设置页在窄屏下会自动改为单列布局。

### 流式思考与工具轮次

以 DSH 的 OpenAI 兼容接入为例，一轮完整的 agent 流程是：

1. 调用方发起带 tools 的流式请求；
2. 坐席认领后，在统一编辑区写内容，按 `Ctrl+Enter`（可自定义）作为思考发送；调用方会立即收到 `reasoning_content` 增量；
3. 同一编辑区继续写正文，按 `Shift+Enter`（可自定义）作为正文推送；
4. 在工具面板添加工具调用，点「发送工具调用」，本轮以 `finish_reason=tool_calls` 结束；
5. agent 执行工具后，再发一个带工具结果的请求；
6. 下一轮继续用同一个编辑区发思考/正文，最后按 `Ctrl+Shift+Enter`（可自定义）发正文并完成。

OpenAI Chat Completions 本身不会在一条响应里执行多轮工具；工具结果必须由客户端发起下一次请求。这不是服务端额外限制。Anthropic Messages 路径目前不输出 thinking block，但工具调用仍按 Anthropic `tool_use` 流式返回。

更完整的启动、后台运行、开机自启和排错说明见 [docs/quickstart.md](docs/quickstart.md)。

### 放到局域网里

默认会监听 `0.0.0.0:7355`，也就是同一网段的人可以用下面这种地址访问：

```text
http://你的局域网地址:7355/login
```

如果只想本机使用，把 `config.jsonc` 的 `server.host` 改成：

```jsonc
"host": "127.0.0.1"
```

默认是普通 HTTP，不是 HTTPS。局域网里也不要随便把端口暴露到公网；正式一些的环境请配置
HTTPS，具体做法见 [docs/deployment.md](docs/deployment.md)。

## 一次请求是怎么走完的

1. 调用程序把请求发到 `/v1/chat/completions`。
2. 请求进入网页工作台的等待列表，带上调用方、模型名、聊天内容和可用的工具。
3. 一位人工回复员点「接单」，其他人就不会再看到同一张单。
4. 回复员可以边写边发，也可以写完一次性发送；需要时还能添加工具调用。
5. 回复完成后，调用程序收到结果；带幂等键的连接如果中途断开，会在宽限期内保留票据，允许用同一请求重连。

等待太久或回复太久，都有超时设置。活动票据、SSE 日志、认领状态和幂等记录会写入运行状态文件，
进程重启后仍可恢复队列；带相同 `Idempotency-Key` 的调用方可以重新接上未完成的票据。账号和调用
密钥也会保留。

## 会话、重连与监控

### 会话聚合

调用方可以用请求头 `X-Session-Id`、`X-NGZR-Session-Id` 或 `X-Session-Affinity` 显式指定会话。未提供时，
服务会根据调用方、模型和首条用户消息生成稳定会话 ID。

同一会话的票据会在工作台详情中显示为一条会话带：轮次、同会话票据和首选回复员。回复员认领后，
后续新票据会带上“首选”提示，可从会话条直接继续接待。

### 断线重连

需要断线重连的调用方应发送 `Idempotency-Key`。同一请求体使用相同幂等键再次请求时：

- 如果原票据仍在等待，会加入同一张票据；
- 如果原连接已断开，会在宽限期内重新挂接；
- 如果原票据已经完成，会回放相同结果；
- 如果服务重启，会从状态文件恢复活动票据并允许同一幂等键重连。

### 监控指标

```text
GET /metrics
```

返回 Prometheus 文本格式的聚合指标，包括服务状态、运行时间、内存、各状态票据数、请求/完成/
失败计数、累计等待时间、最老等待、会话数和版本信息。指标不包含聊天内容或密钥。

工作台的票据轮询支持 `ETag`，并用 `compact=1` 返回轻量摘要；选中票据后再取完整详情。运行状态使用增量 journal，关键状态仍会立即落盘。

队列告警在 `config.jsonc` 的 `alerts` 段配置：

```jsonc
"alerts": {
  "webhookUrl": "",
  "queueDepth": 10,
  "oldestWaitMs": 60000,
  "cooldownMs": 300000
}
```

`webhookUrl` 留空时只记录状态页告警和审计事件；填写后以 JSON POST 发送告警。状态页会显示当前
队列积压/等待告警。

## 网页工作台怎么用

- **左边等待列表**：按“等待中 / 进行中 / 最近结束”分组，可以搜索调用方和内容，也可以只看
  某一类请求。
- **中间聊天记录**：看调用方发来的内容、系统提示、可用工具和历史上下文。
- **统一编辑区**：同一份文字用快捷键决定发成思考、正文还是“正文并完成”；工具调用在右侧检查器，只有接单后才会打开。
- **底部操作栏**：接单、分段发送、完成、放回、拒答、取消一直显示在底部，不用滑到页面底部找按钮。
- **快捷回复**：模板保存在服务端；管理员可创建共享模板，回复员可创建个人模板，插入时替换变量。
- **内部备注**：只给回复员看，不进入调用方响应；转交时可附带交接说明。
- **标签/优先级**：队列可以按标签搜索、按优先级排序，方便人工分派。
- **AI 辅助**：管理员启用并配置 API 后，回复员可用摘要、翻译和「生成回复」；生成回复可同时包含正文与工具调用，填入后由回复员确认一次发送。管理员可在用户管理中单独关闭某个账号的 AI 权限。
- **快捷键**：点击底部「快捷键」或按 `Ctrl+/` 可以自己录制组合键，保存在当前浏览器。

第一次用可以先打开 `/guide`（管理员允许未登录访问时），或在登录页点「第一次使用？查看新手教程」；登录后顶部「教程」会在控制台子页面打开。

建议按这个顺序：

1. 等列表里出现请求；
2. 点底部「接单」；
3. 在回复框里写内容；
4. 想边写边发就点「分段发送」，想直接结束就点「完成」。

## 账号管理

管理员登录后，可以直接在网页里操作：

- 添加普通回复员或管理员；
- 重置密码；
- 删除账号。

账号保存在项目根目录的 `users.json`，密码只保存 scrypt 哈希，不保存明文；每个账号的个性化设置也保存在该文件中（不含密钥），文件权限是 `0600`。
调用密钥保存在 `api-keys.json`，只保存哈希和名称，明文只在创建时显示一次；两个文件都只留在
本机，不要上传到公开位置。管理员可以在密钥上设置永不过期或具体到期时间、允许的模型、每分钟/日/月请求
配额和并发上限，也可以随时停用或删除。

也可以在命令行里管理：

```bash
node scripts/user.mjs list

node scripts/user.mjs add alice --role operator

node scripts/user.mjs passwd alice

node scripts/user.mjs remove alice
```

用户名只能用 3–32 位小写字母、数字、下划线、点和连字符，并且以字母或数字开头。密码至少
8 位；密码框聚焦时会用浮动提示显示常见弱密码和低复杂度检测结果。不能删除自己，也不能把
最后一个管理员删掉。

## 调用方式

### 地址和密钥

```text
http://127.0.0.1:7355/v1/chat/completions
```

调用方需要先在网页工作台的「调用密钥」里生成一个密钥。请求头带上它：

```http
Authorization: Bearer 你的调用密钥
```

一个密钥对应一个名称，方便区分调用方。停用后，使用它的请求会立即收到 401；删除后不可恢复。

### 普通回复

```bash
curl -s http://127.0.0.1:7355/v1/chat/completions \
  -H 'Authorization: Bearer 你的调用密钥' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "human-1",
    "messages": [{"role": "user", "content": "你好，请介绍一下你自己"}]
  }'
```

请求会停在等待列表里，直到有人接单并完成。

### 边写边发

在请求里加 `"stream": true`，回复会一段一段返回。如果只想看一次完整结果，就用默认的
一次性完整返回方式：

```bash
curl -N http://127.0.0.1:7355/v1/chat/completions \
  -H 'Authorization: Bearer 你的调用密钥' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "human-1",
    "stream": true,
    "messages": [{"role": "user", "content": "写一句欢迎语"}]
  }'
```

### 文件附件

先上传文件：

```bash
# 原始二进制上传
curl -X POST http://127.0.0.1:7355/v1/files \
  -H 'Authorization: Bearer 你的调用密钥' \
  -H 'Content-Type: text/plain' \
  -H 'X-Filename: service.log' \
  --data-binary @service.log
```

也支持 `multipart/form-data` 的单个 `file` 字段：

```bash
curl -X POST http://127.0.0.1:7355/v1/files \
  -H 'Authorization: Bearer 你的调用密钥' \
  -F 'file=@service.log;type=text/plain'
```

响应里的 `id` 用于消息引用：

```json
{
  "model": "human-1",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "请看看这个日志" },
        { "type": "file", "file": { "file_id": "file_..." } }
      ]
    }
  ]
}
```

Anthropic Messages 使用：

```json
{ "type": "document", "source": { "type": "file", "file_id": "file_..." } }
```

首期接受：

- UTF-8 文本、日志、JSON、CSV；
- 结构完整的 PNG/JPEG/GIF/WebP；
- PDF 文本抽取（扫描件可能没有文字，原件仍可下载）。

其他类型（HTML、SVG、Office、ZIP、可执行文件、未知二进制）会直接被拒绝。原文件不会内联到
控制台同源页面；文本/CSV/PDF 使用受保护的安全预览，图片使用经过结构和尺寸校验的 raster
图片端点，PDF 原文件只允许下载。附件按调用密钥隔离，详情见
[docs/attachments-plan.md](docs/attachments-plan.md)。

### 工具调用

调用方可以在请求里列出可用工具和参数格式。网页工作台会显示这些工具，人工回复员可以选择
一个，填好参数后发送。服务端会检查参数是否符合约定格式。

> 工具不是装饰。调用程序决定工具能做什么；如果它有文件、命令或网络权限，执行结果就可能
> 影响真实环境。不要把高权限程序接到不受信任的人或服务上。

完整字段和响应格式见 [docs/protocol.md](docs/protocol.md)。

### 结构化回复

如果希望回复一定是某个固定格式，可以在请求里要求结构化输出。服务端会在完成时检查；不合格
的回复不会直接发给调用方，而是留在控制台让人修改。

### 拒答

人工回复员可以选择拒答。调用程序会收到明确的拒答标记和结束原因，而不是一段假装正常的回答。

### Anthropic 格式

同一个服务也接受 Anthropic Messages 格式：

```bash
curl -s http://127.0.0.1:7355/v1/messages \
  -H 'x-api-key: 你的调用密钥' \
  -H 'anthropic-version: 2023-06-01' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "human-1",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

加 `"stream": true` 后会使用 Anthropic 的事件格式返回。Anthropic 的工具、图片和
`tool_result` 也会先转成统一的消息结构，再显示在网页工作台。

### 模型列表

```bash
curl -s http://127.0.0.1:7355/v1/models \
  -H 'Authorization: Bearer 你的调用密钥'
```

模型名首次启动时由 `config.jsonc` 的 `models.catalog` / `models.ids` 初始化，之后由「模型」页面维护并写入 `models.json`。API 密钥只能选择当前启用的模型；回复员没有权限的模型，其票据不会出现在该回复员的队列或票据接口中。

## 配置项

大部分情况下只需要改这几个：

| 配置 | 默认值 | 作用 |
| --- | --- | --- |
| `server.host` | `0.0.0.0` | 监听的地址；只想本机用就改成 `127.0.0.1` |
| `server.port` | `7355` | 网页和接口共用的端口 |
| `server.cookieSecure` | `"auto"` | 登录凭证是否只走 HTTPS；可选 `"auto"`、`true`、`false` |
| `queue.waitTimeoutMs` | `7200000` | 请求在等待列表里最多待多久（毫秒） |
| `queue.responseTimeoutMs` | `7200000` | 接单后最多等多久回复（毫秒） |
| `limits.maxConcurrentPerKey` | `4` | 每个调用密钥最多同时进行几个请求 |
| `models.ids` | `["human-1","human-1-fast"]` | 首次启动时初始化模型注册表 |
| `tls.enabled` | `false` | 是否由本程序直接提供 HTTPS |
| `tls.certFile` / `tls.keyFile` | 空 | 开启 HTTPS 时的证书和私钥路径 |
| `server.trustedHosts` | `[]` | 通过前置代理访问时额外允许的域名 |
| `storage.stateFile` | `state.json` | 活动/已完成请求、SSE 日志和幂等记录的运行快照 |
| `storage.usageFile` | `usage.json` | 各调用密钥的分钟/日/月用量计数 |
| `storage.settingsFile` | `settings.json` | 设置页保存的运行参数和功能开关 |
| `storage.auditFile` | `audit.log` | 登录、账号、密钥、设置和票据审计 |
| `storage.modelsFile` | `models.json` | 运行时模型注册表；首次启动从 `models.catalog` 初始化 |
| `storage.attachmentsDir` | `attachments` | 附件原件和元数据目录；自动 0700/0600 |
| `alerts.webhookUrl` | 空 | 队列告警 webhook；留空只记录状态和审计 |
| `alerts.queueDepth` / `oldestWaitMs` | `10` / `60000` | 积压数量和最老等待阈值 |
| `attachments.maxBytes` / `maxPerRequest` | `10485760` / `5` | 单文件和每请求附件上限 |
| `attachments.maxBytesPerKeyPerDay` | `209715200` | 每个调用密钥每日上传字节上限；0 为不限 |
| `attachments.maxStoreBytes` | `2147483648` | 整个附件目录总容量上限；达到后拒绝新上传 |
| `attachments.reencodeImages` | `false` | 可选：独立 Python/Pillow worker 重编码图片；默认关闭，失败回退原图 |
| `attachments.pdfPagePreview` | `false` | 可选：PDF 按需页图；需要 `pypdfium2`，默认关闭，关闭时只显示文字预览 |
| `aiAssist.maxConcurrent` | `4` | AI 同时处理多个票据的全局并发上限（1–16） |
| `aiAssist.autoReplyOnReceive` | `false` | 管理员：票据到达后自动请求 AI，结果暂存，认领后填入 |
| `aiAssist.autoReplyAfterSeconds` | `0` | 管理员：AI 结果就绪后无人认领多少秒自动直接回复；0 关闭 |

上传请求先流式写入 0600 临时文件，再校验/预览；临时目录在成功或失败后清理，避免请求体无限占用内存。

PDF 页图是可选能力，需要服务账号环境安装 `pypdfium2`；未安装或渲染失败时仍可查看 PDF 文字预览和下载原文件。
| `storage.historyFile` | `history.db` | SQLite/FTS5 历史索引；无 node:sqlite 时回退内存搜索 |
| `storage.stateDb` | `state.db` | 票据/幂等记录 SQLite 状态库；首次启动从 `state.json` 导入 |
| `server.trustedProxies` | `[]` | 仅这些代理地址的 `X-Forwarded-For` 会被采信 |
| AI 实测 | `mimo-v2.6-pro` | Xiaomi Token Plan，见 [兼容记录](docs/xiaomi-mimo-compatibility.md) |
| `attachments.maxImagesPerRequest` | `8` | 每个请求最多图片 URL 数量；防止一条请求塞入无限图片 |
| `attachments.maxImageUrlBytes` | `2000000` | 每个请求所有图片 URL 字符串总字节上限（含 data URL） |
| `attachments.retentionMs` | `30 天` | 附件保留和清理周期 |
| `features.auditLog` / `features.usageDashboard` | 见示例 | 审计日志和用量页面的功能开关 |
| `features.publicGuide` | `true` | 是否允许未登录访客访问 `/guide` 新手教程；登录用户始终可从顶部导航查看 |
| `audit.maxBytes` / `audit.keepFiles` | `10485760` / `5` | 审计日志单文件上限与保留轮转份数 |
| `models.catalog` | 内置模型卡 | 能力、上下文容量、最大输出和弃用标记 |

每一项允许的取值和效果都写在 [config.example.jsonc](config.example.jsonc) 的注释里。
真实密钥不写进配置文件，而是由管理员在网页里生成。

## 接到 DSH

DSH 可以用“兼容 OpenAI 的接口”方式接入。一个最小配置长这样：

```yaml
human-provider:
  displayName: 能工智人 / Human Provider（人工回复）
  api: openai-completions
  baseURL: http://127.0.0.1:7355/v1
  apiKeyEnv: HUMAN_PROVIDER_KEY
  models:
    - id: human-1
      name: Human 1
      contextWindow: 131072
      maxTokens: 8192
      reasoningEfforts:
        low: low
        high: high
        max: max
```

在网页里生成一个调用密钥，把 `HUMAN_PROVIDER_KEY` 配成它。人工回复没有模型推理预算，
`reasoningEffort` 会作为回复员的“工作深度”提示显示在票据上。更完整的说明见
[integrations/dsh/README.md](integrations/dsh/README.md)。

## 哪些事情不要做

- 不要在公开生产环境把它当成真实模型服务；
- 不要用别人的密钥，也不要把密钥发到群里；
- 不要在回复里写密码、身份证号、私钥等敏感内容；
- 不要让高权限程序自动执行来源不明的工具调用；
- 不要把默认 HTTP 直接暴露到公网；
- 不要期待它像真正的模型一样稳定、快速，能同时接待很多人。

## 已知限制

- 没有 `/v1/responses`、`logprobs`，也不支持一次给多份候选回复；
- 活动等待队列、登录会话和登录失败计数在内存里，重启会中断未完成请求；
- 设置、用量、审计和已完成/幂等记录会写入本地 JSON/日志文件；
- 管理员 MFA 是可选 TOTP，没有恢复码，也没有强制策略；没有企业统一登录或细粒度 RBAC；
- 没有多台机器自动接管；
- 默认只运行一个程序，适合小团队和局域网，不适合很多人同时使用；
- 图片只检查地址和大小，不负责检查文件内容是否安全。

## 接口与资料

- [OpenAPI 描述](docs/openapi.json)：可直接导入 Swagger Editor、Postman 或生成客户端。
- [OpenAI 请求示例](examples/curl-openai.sh)
- [Anthropic 请求示例](examples/curl-anthropic.sh)
- [更新记录](CHANGELOG.md)
- `GET /provider`：服务模式、模型卡、协议和限制；明确标注 `human-in-the-loop`。
- `/v1/models` 返回 `capabilities`、上下文容量、最大输出等模型卡字段。
- 每个响应都带 `X-NGZR-API-Version` 和 `X-Request-Id`。

## 文档和许可

- [启动与运行](docs/quickstart.md)
- [协议说明](docs/protocol.md)
- [安全说明](docs/security.md)
- [部署方式](docs/deployment.md)
- [项目结构](docs/architecture.md)
- [DSH 接入](integrations/dsh/README.md)

MIT License，详见 [LICENSE](LICENSE)。
