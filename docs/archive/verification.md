# 验证记录

日期：2026-11-01（Asia/Shanghai）
主机：Linux / Node.js v24.19.0（内网测试机）
项目：`<repo>`

本文件记录**实际执行过**的验证，而不是设计目标。所有结论都附命令或证据文件；未覆盖的
部分在最后单独列出。

## 1. 自动化测试

命令：

```bash
npm test
```

结果：

```text
ℹ tests 70
ℹ pass 70
ℹ fail 0
ℹ duration_ms 20233.06854
```

完整输出：[test-output.txt](test-output.txt)

完整本地验收报告：[local-full-test-2026-11-01.md](local-full-test-2026-11-01.md)

覆盖：

| 测试 | 结果 |
| --- | --- |
| 登录页、CSP、未登录重定向 | ✅ |
| 登录、Cookie 属性、CSRF | ✅ |
| 错误密码/未知用户的同一错误 | ✅ |
| CLI 用户、多用户登录、最后管理员保护 | ✅ |
| Web 管理员添加/改密/删除用户、角色校验 | ✅ |
| `/v1/models`、限速头、request id | ✅ |
| 明确拒绝 `n>1` / `logprobs` / `/v1/responses` | ✅ |
| 非流式对话 | ✅ |
| SSE 流式、usage、`[DONE]` | ✅ |
| 工具参数 JSON Schema 校验 | ✅ |
| `response_format: json_object` 非法/修正 | ✅ |
| `response_format: json_schema` | ✅ |
| 流式幂等回放 | ✅ |
| 非流式 reasoning | ✅ |
| 拒答（流式/非流式） | ✅ |
| 流式 reasoning + reasoning_tokens | ✅ |
| 幂等：完成回放、活跃等待、冲突 | ✅ |
| 图片附件 | ✅ |
| 双坐席归属/冲突 | ✅ |
| Origin/Host/开放重定向/路径穿越 | ✅ |
| 会话固定、CSRF 登出、XSS 转义、请求体上限 | ✅ |
| 登录暴力破解限速 | ✅ |
| 账号文件热重载 | ✅ |
| 随机管理员一次性密码 | ✅ |
| API Key 生命周期、x-api-key 认证 | ✅ |
| Anthropic Messages 非流式 / 流式 / 工具 | ✅ |
| 密钥 RPM/日/月配额与模型范围 | ✅ |
| 完成请求跨重启幂等回放 | ✅ |
| 模型卡、/provider、OpenAPI | ✅ |
| 模型级输出速度及范围校验 | ✅ |
| 操作员设置自动保存与自动 AI 开关 | ✅ |
| AI 引导提示词传递 | ✅ |
| AI 文本伪工具标记清理 | ✅ |
| AI 超时覆盖延迟响应体 | ✅ |
| 品牌图标、favicon 和 manifest | ✅ |

## 2. 端到端验收

本版本没有独立的 `demo` npm 脚本。端到端链路由 `npm test` 中的 OpenAI / Anthropic / 工具 / 流式 / 幂等用例覆盖；另用真实 MiMo 上游完成了人工 AI 生成、收到票据自动 AI、认领后自动 AI 和管理员接管测试，详见完整报告。

## 3. 浏览器控制台

### 3.1 登录页

- 打开 `http://127.0.0.1:7355/login`，页面 200。
- 表单实际登录成功，跳转 `/console`，右上角显示登录用户。
- 截图：[login.png](login.png)

> 自动化说明：本机无头 Chromium/本地代理会提交 `Origin: null`，有时带
> `Sec-Fetch-Site: same-origin`，有时该头为空。登录 POST 对这两种情况放行；登出和
> `/op/api` 写操作仍要求同源标记和 CSRF。

### 3.2 工具调用

- 通过 API 发起带 `get_weather` schema 的请求。
- 控制台队列出现票据；点击认领。
- 在参数编辑器输入 `{"city":"北京"}`，添加工具调用，完成。
- 调用方收到 200，`finish_reason: "tool_calls"`，参数为 `{"city":"北京"}`。

### 3.3 管理员 Web 页面

- 顶部导航包含坐席、用户管理、API 密钥、用量、审计、状态和设置。
- 用户和密钥均为独立页面，新增/编辑复用同一表单，不再使用弹窗。
- 用量页按密钥展示分钟/日/月计数和每日趋势；审计页展示登录、账号、密钥、设置和票据操作；
  状态页展示队列、存储和最近审计；设置页按账号管理个性化设置；管理员管理运行参数、审计/用量开关和 MFA。
- 测试结束已删除临时用户；实际用户列表不写入仓库。
- 为不泄露账号信息，不保留用户管理截图。

### 3.4 JSON 模式

- 发起 `response_format: {"type":"json_object"}` 请求。
- 坐席输入 `not json` 点完成：服务端 400，票据保持认领状态，草稿保留。
- 坐席改成 `{"ok":true}` 再完成：调用方 200，`content` 为合法 JSON，`finish_reason: "stop"`。

### 3.5 工作台布局与工具添加

- 1440×960 下 `document.body.scrollHeight === innerHeight`，页面本身不滚动；
  对话历史、对外内容、工具面板各自内部滚动。
- 回复区固定在底部，工具面板在回复区右侧，最大高度受限并有独立滚动。
- 工具名筛选、自动 JSON 模板、必填提示、行内 JSON 错误、`Ctrl+Enter` 添加均已实测。
- 工具面板只在票被认领后显示，未认领时节省空间。
- 常驻命令栏按钮始终可见；选中票据后按状态启用。
- 队列搜索/「全部/待认领/进行中/最近」筛选实测。
- 快捷键：默认 `Ctrl+Enter` 完成；自定义完成键为 `Alt+G` 后命令栏标签和全局按键同步，
  再按一次完成票据；关闭面板并恢复默认。快捷键只写入当前浏览器 localStorage。

### 3.6 拒答（API）

浏览器确认框在无头模式下会阻塞自动化，因此 UI 拒答未做自动点击；同一路径已用 API 验证：

```bash
# 认领后
POST /op/api/tickets/<id>/finish
{"refusal":"无法协助这个请求。"}
```

调用方返回：

```json
{
  "choices": [{
    "message": {"role":"assistant","content":null,"refusal":"无法协助这个请求。"},
    "finish_reason": "content_filter"
  }]
}
```

## 4. DSH 实测

DSH 配置：

```yaml
nenggong-zhiren:
  displayName: 能工智人（人工回复）
  api: openai-completions
  baseURL: http://127.0.0.1:7355/v1
  apiKeyEnv: NENGGONG_ZHIREN_KEY
  models:
    - human-1
    - human-1-fast
```

凭据：`NENGGONG_ZHIREN_KEY` 是能工智人的调用方 key，不是坐席密码。
自定义 pi-ai 路由不能配置 `compat.sendSessionAffinityHeaders`；服务端通过消息前缀和会话 ID 识别会话。

实测步骤：

1. DSH 新建会话，模型选择 **Human 1**；
2. 发送：“请用 bash 工具运行 pwd，然后告诉我当前工作目录。”；
3. 能工智人收到两个请求：
   - 主请求，`67 tools`；
   - 会话标题请求，无 tools；
4. 坐席认领主请求，返回 `bash({"command":"pwd","description":"Print current working directory"})`；
5. DSH 执行 Bash，得到示例工作目录；
6. DSH 发工具续跑请求，坐席回复一个示例工作目录；
7. DSH 完成，显示 Bash 卡片和最终答案，并生成示例会话标题；
8. 主请求耗时约 22 秒（含人工响应）。

服务重启后（最新代码）又在同一 DSH 会话发送“请只回复：OK”，坐席回复 `OK`，
DSH 显示 `Completed in 8s`，确认热配置与重启后的 provider 仍然可用。

## 5. 局域网

正式实例使用 `config.jsonc`：

```jsonc
"server": { "host": "0.0.0.0", "port": 7355 },
"storage": { "usersFile": "users.json" }
```

验证：

```bash
curl -sS http://<LAN-IP>:7355/healthz
curl -sS -o /dev/null -w '%{http_code}\n' http://<LAN-IP>:7355/login
curl -sS -i -X POST http://<LAN-IP>:7355/auth/login \
  -H 'Origin: http://<LAN-IP>:7355' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'username=<admin-user>&password=<redacted>'
```

结果：

- `/healthz` → 200；
- `/login` → 200，页面为“能工智人”；
- 登录 → 303、`Set-Cookie: ngzr_session=...; HttpOnly; SameSite=Strict`；
- 浏览器地址 `http://<LAN-IP>:7355/login` 可访问。

> 该实例是 HTTP，不是 HTTPS；Cookie 没有 `Secure`。这是已知残余风险，见第 8 节。

## 6. 安全对抗（正式实例）

| 请求 | 结果 |
| --- | --- |
| `POST /auth/login` + `Origin: null`（opaque origin） | 303（登录例外） |
| `POST /auth/logout` + `Origin: null`（无同源标记） | 403 |
| `POST /auth/login` + `Origin: null` + `Sec-Fetch-Site: same-origin` | 303 |
| `GET /healthz` + `Host: evil.example` | 421 `untrusted_host` |
| 无 Bearer 访问 `/v1/models` | 401 `missing_api_key` |
| 未登录 `/console` | 302 `/login?next=%2Fconsole` |
| 未登录 `/op/api/tickets` | 401 |
| 错误密码 | 401，统一文案 |
| 缺 CSRF 的写操作 | 403 |
| 登出缺 CSRF | 403 |
| 连续错误登录 | 429 + `Retry-After` |
| 开放重定向 `//evil.example` | 只跳 `/console` |
| 路径穿越 | 404 |

正式实例的响应头包含：

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; ... frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Cache-Control: no-store
X-Request-Id: req_...
```

## 7. TLS

使用自签名证书在独立端口 7360 测试：

```bash
TLS_CERT=<path>/cert.pem \
TLS_KEY=<path>/key.pem \
PORT=7360 ... node server.mjs
```

结果：

```text
HTTP/1.1 303 See Other
Strict-Transport-Security: max-age=31536000; includeSubDomains
Set-Cookie: ngzr_session=<redacted>; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure
```

HTTPS 下自动 `Secure` Cookie 和 HSTS。该测试没有替换正式实例的 HTTP 监听；正式实例仍为
HTTP，生产应启用 TLS 或反代 TLS。

## 8. 未覆盖 / 已知限制

1. **未做公网暴露测试**：只在 loopback 和局域网验证，没有把 7355 暴露到公网做外部扫描。
2. **未做压力/浸泡测试**：没有验证数万并发、长时间心跳、内存增长曲线。
3. **MFA 可选、无恢复码，且没有细粒度 RBAC**：启用 TOTP 后仍需自行保存恢复手段；
   任何 operator 可看所有票据。
4. **正式实例是 HTTP**：登录密码在局域网明文传输；这是当前最大的残余风险。生产必须
   启用项目内置 TLS 或反代 TLS。
5. **opaque origin 的边界**：登录 POST 接受 `Origin: null`（无同源标记/同源标记）；
   登出和 `/op/api` 写操作仍拒绝无同源标记的 opaque origin。跨站标记全部拒绝。
6. **UI 拒答确认框未自动化**：API 路径已验证；浏览器确认框在无头模式下会阻塞。
7. **JSON Schema 子集**：`pattern`/`format`/`$ref` 等被忽略。
8. **单进程运行**：当前不提供多节点 HA；重启会中断现有连接，但持久化票据可在幂等请求重连时续接。
9. **审计是本地追加文件**：有文件系统权限的管理员可以修改；高安全环境应转发到远端日志。
10. **没有对图片内容做安全扫描**：只校验 URL 形状和请求体大小。
11. **没有全局 API 调用速率限制**：只有并发上限。
12. **默认调用方 key 是示例值**：正式部署必须更换。

以上限制不是隐藏缺陷，而是当前 0.x 单进程参考实现的范围。需要更高保证时，应叠加 TLS
反代、SSO、网络 ACL、集中审计、持久化队列和独立限流层。

## 9. 开源发布前的隐私清理

本轮已执行：

- 清理测试产生的临时目录、临时账号和临时密钥；
- 测试账号密码每次随机生成，不复用真实密码；
- 文档中的真实内网 IP、绝对路径、账号和调用密钥均改为占位符；
- 账号、密钥、状态、用量、设置和审计文件都在 `.gitignore` 中，不随仓库发布；
- 公开包不包含测试文件、内部验证记录和开发流程文档；
- 发布前执行密钥、路径、内网地址和用户数据扫描。

仓库内不包含可用的管理员明文密码或调用方 key。生产实例应使用独立强密码并定期轮换调用密钥。
