# 0.6.0 本地全面测试报告

日期：2026-11-01（Asia/Shanghai）
代码基线：`0c1bc83`，另含本报告前完成的 AI 响应体超时修复
运行环境：Linux / Node.js v24.19.0
服务：`http://127.0.0.1:7355`，内部监听 `127.0.0.1:7356`
版本：`0.6.0`

## 1. 结论

本轮完成了自动化测试、静态检查、数据库完整性检查、桌面页面冒烟、移动端布局检查，以及 AI 自动/手动流程、管理员接管、调用方断开等专项回归。

结果：

```text
自动化：70 / 70 通过
静态语法检查：通过
SQLite quick_check：state.db / history.db 均为 ok
桌面页面：10 / 10 通过
移动端页面：8 / 8 无横向溢出
ETag 304：通过
```

没有遗留阻塞性功能缺陷。

## 2. 自动化测试

命令：

```bash
cd <repo-dir>
npm test
```

结果：

```text
tests 70
pass 70
fail 0
cancelled 0
skipped 0
duration_ms 20233.06854
```

完整输出：[test-output.txt](test-output.txt)

覆盖范围包括：

- 登录、Cookie、CSRF、相同错误文案、暴力破解限速；
- 用户管理、角色、模型权限、最后管理员保护；
- OpenAI 非流式/流式、usage、reasoning、拒答、JSON 模式和工具调用；
- Anthropic Messages 非流式/流式/tool_use；
- Idempotency 回放、活跃等待、冲突、SSE 重连、重启恢复；
- 会话聚合、首选回复员、同会话单轮次；
- 附件、图片重编码、PDF 页图、恶意附件拒绝；
- API Key 生命周期、配额、模型范围；
- 审计、历史、FTS5、CSV；
- AI 辅助权限、原生转发、工具提取、文本伪工具标记清理、引导提示词、AI 响应体超时；
- 安全边界：Origin/Host、开放重定向、路径遍历、CSRF、会话固定、请求体上限、代理 IP；
- 公开教程、管理页面资源、ETag compact 轮询。

## 3. 静态与存储检查

### 3.1 语法

对以下文件逐个执行 `node --check`：

- `server.mjs`
- `src/**/*.mjs`
- `public/*.js`
- `scripts/*.mjs`

结果：全部通过。

### 3.2 SQLite

```text
state.db   quick_check=ok   journal_mode=wal
history.db quick_check=ok   journal_mode=wal
```

确认 SQLite 状态库和历史库均处于 WAL 模式。

### 3.3 ETag

使用管理员会话请求：

```text
GET /op/api/tickets?compact=1
→ 200 + ETag

GET /op/api/tickets?compact=1
If-None-Match: <前一次 ETag>
→ 304，Content-Length: 0
```

## 4. 桌面页面冒烟

视口：1440 × 1000。

| 页面 | 状态 | 标题 | 页面错误 | 横向溢出 |
| --- | --- | --- | --- | --- |
| `/console/status` | 200 | 系统生命体征 | 无 | 无 |
| `/console` | 200 | 网页工作台 | 无 | 无 |
| `/console/users` | 200 | 用户管理 | 无 | 无 |
| `/console/models` | 200 | 模型 | 无 | 无 |
| `/console/keys` | 200 | 调用密钥 | 无 | 无 |
| `/console/usage` | 200 | 用量 | 无 | 无 |
| `/console/history` | 200 | 历史 | 无 | 无 |
| `/console/audit` | 200 | 审计 | 无 | 无 |
| `/console/settings` | 200 | 设置 | 无 | 无 |
| `/console/guide` | 200 | 新手教程 | 无 | 无 |

检查项：

- HTTP 200；
- 页面无 `pageerror`；
- 不出现“加载失败 / Not Found / Internal Server Error / undefined”；
- `document.scrollWidth <= innerWidth + 1`。

历史页在加载完成后显示归档条数和表格，没有停留在“检索中…”。

## 5. 移动端检查

视口：390 × 844。

### 5.1 登录页

- 密码显示/隐藏按钮存在；
- 页面 `scrollWidth = innerWidth = 390`；
- 登录卡片垂直居中；
- 无横向滚动。

### 5.2 工作台和管理页面

| 页面 | 横向溢出 | 结果 |
| --- | --- | --- |
| `/console/status` | 无 | 通过 |
| `/console` | 无 | 通过 |
| `/console/settings` | 无 | 通过 |
| `/console/models` | 无 | 通过 |
| `/console/users` | 无 | 通过 |
| `/console/history` | 无 | 通过 |
| `/console/audit` | 无 | 通过 |
| `/console/guide` | 无 | 通过 |

顶部导航在窄屏下使用横向滚动，属于预期交互。

工作台详情态下实测：

```text
composer top   = 682
composer bottom= 788
commandbar top = 798
viewport height= 844
```

回复框和命令栏均在首屏内。

## 6. AI 辅助专项

### 6.1 收到票据自动 AI

实测：

```text
创建票据
→ aiPending.status = running，source = auto_receive
→ 认领
→ 等待结果 ready
→ 自动填入草稿
→ toast: 已自动填入收到票据时的 AI 帮助，可修改后发送
```

调用方票据被正常完成，AI 内容先进入草稿而不是直接发送。

### 6.2 认领后自动 AI

临时开启管理员总开关和测试回复员个人开关：

```text
claim
→ aiPending.status = running，source = auto_claim
→ 输入框 disabled = true
→ placeholder = AI 辅助生成中，完成后自动填入…
→ 备注显示已用时 2 秒
→ toast: AI 辅助正在自动生成，完成后会填入草稿
```

等待完成后：

```text
status = ready
draft = OK
textarea disabled = false
toast = 已自动填入认领后的 AI 帮助，可修改后发送
```

测试后已恢复：

```text
autoReplyOnReceive = true
autoClaimEnabled = false
streamDelayMs = 26
```

### 6.3 手动 AI 与引导提示词

- 打开 AI 引导；
- 输入 500 字限制内的引导；
- 点击主按钮生成；
- AI 面板即时显示：

```text
AI 生成中…
已用时 0 秒 · 不会自动发送
```

- 计时持续刷新：0 → 5 → 14 → 24 → 27 秒；
- 完成后面板关闭，计时器清空；
- 草稿被新结果覆盖，等待人工确认。

引导请求体已通过自动化测试确认以独立 system 消息追加；本轮真实上游响应较慢，暴露了“超时只覆盖响应头”的问题，见第 10 节。

### 6.4 自动 AI 权限

已验证：

- 管理员总开关关闭时，回复员个人开关不可用并显示原因；
- 管理员开启后，回复员个人开关可用并成功保存；
- 管理员和回复员各自拥有独立开关；
- 没有 AI 功能的账号不会自动填入。

## 7. 接管、取消与断开专项

### 7.1 管理员接管

管理员查看其他回复员票据时：

```text
cmdTakeover visible = true
```

点击并确认后：

```json
{
  "claimedBy": "admin",
  "note": "管理员接管：e2e_op → admin"
}
```

原回复员继续 finish：

```text
403 not_ticket_owner
```

### 7.2 调用方主动断开

将宽限期临时设为 10 秒：

```text
调用方带 Idempotency-Key 请求
→ 认领
→ 调用方 abort
→ 10 秒后
→ state = cancelled
→ clientGone = true
```

服务重启后恢复的 queued/claimed/streaming 票据也会重新启动同一重连宽限期，避免重启后的孤立活跃票据长期不结束。

### 7.3 操作员取消

调用方仍在线时，操作员取消：

```text
调用方收到 500 JSON:
{"error":{"message":"The request was aborted by the upstream provider.",
          "type":"server_error","param":null,"code":"upstream_aborted"}}
```

说明调用方在线时存在明确的终止响应；调用方 socket 已关闭时无法再发送终止消息。

## 8. 真实浏览器操作

本轮不是只调用 API，而是用真实 Chromium 完成了以下用户路径。

### 8.1 登录与工具调用

1. 打开 `/login`，输入管理员账密登录；
2. 进入 `/console`，选中测试票据；
3. 点击「认领」；
4. 打开工具检查器；
5. 直接点击「添加工具调用」得到：

```text
参数.order_id 不能为空
```

6. 填写 `{"order_id":"A-100"}` 后添加成功；
7. 点击「发送工具调用并完成」；
8. 调用方真实收到：

```json
{
  "finish_reason": "tool_calls",
  "tool_calls": [{
    "function": {
      "name": "lookup_order",
      "arguments": "{\"order_id\":\"A-100\"}"
    }
  }]
}
```

### 8.2 AI 生成

1. 选中另一张测试票据并认领；
2. 打开「AI 引导」，填写：

```text
只回复 BROWSER-AI-OK
```

3. 点击 AI 生成；
4. 面板显示 `AI 生成中…` 和 `已用时 0 秒`；
5. 完成后草稿被结果覆盖，计时器停止；
6. 点击完成，调用方收到：

```json
{
  "content": "浏览器测试完成",
  "finish_reason": "stop"
}
```

### 8.3 管理员接管

1. 临时回复员 `browser_op` 认领票据；
2. 管理员在真实浏览器打开该票据；
3. 备注显示「由 browser_op 接待中。可点击下方「接管」继续处理。」；
4. 点击「接管」并确认；
5. 页面显示接管成功，票据 `claimedBy=admin`；
6. 内部备注自动写入：

```text
管理员接管：browser_op → admin
```

测试后临时用户和票据已清理。

### 8.4 移动端

- 390×844 登录页：图标 46×46 加载成功，页面无横向溢出，卡片居中；
- 工作台详情：回复框和命令栏均在首屏；
- 管理页面：无横向溢出，顶部导航按预期横向滚动。

## 9. 品牌图标

新增：

- `public/icon.svg`：可缩放主图标；
- `favicon.ico`：16/32/48 多尺寸；
- `icon-16.png` / `icon-32.png` / `icon-192.png` / `icon-512.png`；
- `apple-touch-icon.png`：180×180；
- `manifest.webmanifest`：PWA 名称、主题色和图标。

界面接入：

- 登录页使用 46px 图标；
- 控制台、管理页和教程顶栏使用 24px 图标；
- 状态圆点叠加为图标右下角在线徽标；
- 所有页面加入 favicon、apple-touch-icon 和 manifest。

浏览器验证：

```text
/login-mark 46×46 加载成功
/console .brand-icon 24×24 加载成功
statusDot 叠加于图标右下角
manifest name = 能工智人
/icon.svg content-type = image/svg+xml
```

## 10. 本轮发现并修复的问题

### 10.1 AI 超时未覆盖响应体

问题：

- `relayReply` 的超时计时器在 `fetch` 返回响应头后就被清理；
- 上游先返回响应头、后延迟发送 JSON 正文时，可绕过 20 秒超时；
- 实际观察到 AI 请求耗时 27.6 秒，超过配置的 20 秒。

修复：

- 超时计时器覆盖到 `response.json()` 完成；
- 新增 100ms 上游延迟正文测试，验证在 450ms 前以 `ai_timeout` 失败。

结果：

```text
AI relay timeout covers a delayed response body ... pass
tests 69 / pass 69
```

### 10.2 幂等断开票据长期不结束

问题：

- 带 `Idempotency-Key` 的已认领/流式票据断开后只进入 detached；
- 之前只有 queued 状态有重连清理计时器；
- 票据可能长时间保持 claimed/streaming。

修复：

- queued/claimed/streaming 断开后统一进入重连宽限期；
- 宽限期结束仍未重连则 `cancelled`、释放并发槽位。

### 10.3 操作员设置页无法保存

问题：

- 操作员设置页缺少 `prefAutoAiClaim`；
- 公共脚本读取该元素抛错，导致整页初始化和保存失败。

修复：

- 补齐开关；
- 加入空值保护；
- 自动保存和成功 toast 已实测。

### 10.4 重启恢复票据未启动宽限期

问题：

- 服务重启时，restore 逻辑会把 active 票据标记为 detached/restored；
- 之前只恢复队列超时或响应超时，没有恢复重连宽限期；
- 已断开连接但经过重启的票据可能继续显示为 active。

修复：

- 所有恢复的活跃票据统一 arm 重连宽限期；
- 重连时 attach 会清除该计时器；
- 宽限期结束仍未重连则 cancelled。

### 10.5 AI 正文夹带伪工具标记

问题：

- AI 正文可能包含 `[tool use: ...]`、`已调用工具`；
- 这些文本会随人工回复发给调用方。

修复：

- relay 输入和输出清理伪工具标记；
- 真实 `tool_calls` 保留；
- 自动化测试覆盖。

## 11. 数据清理

本轮测试后确认：

```text
用户：admin, testuser
autoReplyOnReceive: true
autoClaimEnabled: false
streamDelayMs: 26
临时回复员 e2e_op：已删除
临时测试票据：已取消或完成
```

测试票据会保留在最近历史中，直到保留期到期；没有修改真实用户密码或调用密钥。

## 12. 已知限制

以下不是本轮阻塞缺陷：

1. **真实 AI 输出具有上游随机性**：引导提示词会发送给上游，但不能保证模型严格遵循。
2. **AI 延迟取决于 MiMo 上游**：本轮实测 27 秒；超时修复已覆盖响应体，但上游首字节延迟仍可能接近配置上限。
3. **移动端只验收了 390×844 一个视口**：没有做多机型/横屏矩阵。
4. **没有做公网压力/浸泡测试**：本轮是本地功能和兼容性验收，不是容量测试。
5. **UI 拒答确认框仍以 API 验证为主**：无头浏览器确认框交互未作为标准自动化项。
6. **附件只覆盖已有自动化用例**：本轮没有重新生成所有媒体样本。

## 13. 最终结论

0.6.0 的自动化与本地手工验收均通过。测试期间发现的 AI 响应体超时和幂等断开清理问题已修复并补充测试。

本轮未发现需要阻止发布的功能性错误；剩余项均为外部模型行为、测试环境范围或既有产品限制。
