# 文件附件与安全预览方案（首期已实现）

## 0. 先确认核心原则：展示优先，不开放“任意文件”

附件功能的价值不在于“能上传”，而在于回复员能迅速看懂内容。因此不建议先做“任意文件上传 +
下载链接”：这会把 PDF/Office/压缩包解析器、浏览器插件、宏、压缩炸弹和 XSS 的安全面全部带进来，
而回复员仍然无法高效阅读。

建议原则：

1. **只接受有真实预览管线的类型**，不接受“上传后只能下载”的类型作为首期功能；
2. **永远不把原始文件内联到控制台同源页面**；
3. 回复员看到的是服务端生成的**安全预览产物**（文本片段、重编码图片、页面图片），不是原始二进制；
4. 原文件只在明确点击“下载原文件”时以附件形式返回；
5. 先用窄 allowlist 上线，再按真实需求扩展。

推荐分档：

| 类型 | 展示方式 | 首期建议 |
| --- | --- | --- |
| 文本 / 日志 / JSON / CSV | 转义后的文本查看器、表格、行号、搜索 | 支持 |
| PNG / JPEG / WebP / GIF | 服务端校验并重编码后的图片查看器 | 支持 |
| PDF | 隔离转换器生成页面图片 + 抽取文本 | 条件支持，需要外部转换器 |
| Office | 隔离转换器转 PDF/页面图片 | 二期，需沙箱 |
| ZIP | 仅列目录，不自动解压 | 二期或不做 |
| 未知二进制 | 不做在线预览 | 拒绝或仅作为显式下载 |

“显式下载”可以作为管理员/调用方明确开启的附加能力，但不应是首期附件的主要卖点。

## 1. 目标

让调用方除了图片之外，还能把日志、文本、CSV、PDF、压缩包和办公文档交给回复员查看，同时保证：

- 附件不能变成同源脚本执行入口；
- 不同调用密钥之间不能互相读取附件；
- 回复员只能看到自己模型范围内的附件；
- 附件生命周期可回收、可审计、可备份；
- 不引入运行时第三方依赖。

首期已实现文本/CSV/JSON、PNG/JPEG/GIF/WebP 和 PDF 文本预览；PDF 页面图片、Office、ZIP 和扫描件 OCR 仍在后续阶段。实现范围比本方案更窄，安全边界见文末。

## 2. 建议的 API 形态

### 2.1 上传

新增受 API key 保护的接口：

```http
POST /v1/files
Authorization: Bearer <CALLER_KEY>
Content-Type: multipart/form-data
```

字段：

- `file`：文件内容；
- `purpose`：`chat_attachment`；
- `expires_in`：可选，默认跟随票据生命周期。

响应：

```json
{
  "id": "file_...",
  "object": "file",
  "bytes": 12345,
  "filename": "service.log",
  "mime_type": "text/plain",
  "sha256": "...",
  "created_at": 1760000000,
  "status": "ready"
}
```

### 2.2 在消息里引用

OpenAI Chat Completions 扩展：

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "看看这个日志" },
    { "type": "file", "file": { "file_id": "file_..." } }
  ]
}
```

保留现有 `image_url`，图片仍可走原有路径。Anthropic Messages 使用对应的 `document` 块：

```json
{ "type": "document", "source": { "type": "file", "file_id": "file_..." } }
```

### 2.3 下载/预览

```http
GET /op/api/attachments/<file_id>?mode=meta
GET /op/api/attachments/<file_id>?mode=raw
GET /op/api/attachments/<file_id>?mode=text
```

- 只能由管理员或拥有该票据模型权限的回复员访问；
- 调用方只能通过 API key 访问自己上传的附件；
- 所有访问写审计。

## 3. 存储布局

```text
data/
  attachments/
    2026/10/28/
      <uuid>/
        blob
        meta.json
```

`meta.json` 只记录：

- 原始文件名（仅展示和审计，不参与路径拼接）；
- MIME、大小、sha256；
- 上传者 key 哈希、绑定票据、绑定时间；
- 扫描状态、扫描器版本；
- 原始尺寸/页数（可选）。

实际文件名始终使用随机 UUID；不使用用户文件名拼路径。

## 4. 安全边界

### 4.1 类型

默认允许：

- `image/png`、`image/jpeg`、`image/webp`、`image/gif`；
- `text/plain`、`text/csv`、`application/json`、常见日志扩展名；
- `application/pdf`；
- `application/zip`（只列目录，不自动解压）；
- 常见 Office 文档（只下载，不在页面内渲染）。

默认拒绝或特殊处理：

- `text/html`、`image/svg+xml`、JavaScript、可执行文件；
- 双扩展名；
- 压缩炸弹、超大解压比；
- 加密压缩包（预览时不尝试解密）。

### 4.2 响应头

所有附件响应：

```text
Content-Type: application/octet-stream  (非图片/文本)
Content-Disposition: attachment; filename="..."
X-Content-Type-Options: nosniff
Content-Security-Policy: sandbox
Cache-Control: private, no-store
```

图片和文本预览走独立受控端点，使用 `Content-Disposition: inline` 仅限可信类型；禁止 SVG 内联。

### 4.3 内容校验

- 读取 magic bytes，不信任扩展名和客户端 MIME；
- 图片重新编码/剥离 EXIF 后再提供缩略图（若引入图像库）；
- PDF 不启用页面内脚本，默认只提供下载或沙箱预览；
- ZIP 只读取中央目录并限制条目数量/名称长度；
- 可选 ClamAV 扫描 hook：`pending` → `clean` / `infected` / `error`；
- 扫描未通过的附件在坐席端显示隔离状态，不提供预览/下载。

### 4.4 权限

- 上传时记录调用方 key；
- 绑定票据时校验调用方和票据模型权限；
- 坐席访问时校验模型可见性；
- 管理员可审计/删除，但默认不能读取未绑定附件内容；
- 跨 key 的附件 ID 返回 404，不暴露是否存在。

## 5. 预览策略

| 类型 | 预览 | 备注 |
| --- | --- | --- |
| PNG/JPEG/WebP/GIF | 缩略图 + 原图 | 禁止 SVG、HTML |
| 文本/JSON/日志/CSV | 前 128 KiB 转义展示 | 超出部分提示下载 |
| PDF | 沙箱 iframe 或只下载 | 首期建议只下载，二期再开预览 |
| ZIP | 文件名/大小列表 | 不自动解压 |
| Office | 元信息 + 下载 | 不引入在线 Office 渲染 |
| 未知 | 元信息 + 下载 | 不猜测类型 |

## 6. 生命周期与配额

建议默认值：

- 单文件 10 MiB；
- 单请求 5 个附件、总计 25 MiB；
- 每调用 key 每日 200 MiB；
- 未绑定附件 24 小时后回收；
- 已绑定附件跟随票据保留期（例如 30 天）；
- 每次 GC 只删除超过保留期且无引用的文件；
- 备份时附件目录与 `state.json` 一起备份，恢复时校验 sha256。

所有限制写入配置，并在返回错误时给出明确错误码：

```text
file_too_large
too_many_files
unsupported_file_type
attachment_not_ready
attachment_quarantined
attachment_not_found
```

## 7. 坐席端交互

- 拖拽/粘贴上传，显示进度和类型；
- 附件 chip：文件名、大小、类型、扫描状态；
- 点击打开预览抽屉；
- 预览失败只显示“下载原文件”，不把原内容注入页面；
- 队列卡片显示附件数量；
- 票据详情里显示“附件”区，和文本消息分离；
- 删除附件需要二次确认并写审计。

## 8. 指标与审计

新增：

```text
ngzr_attachments_total{status="ready|quarantined|deleted"}
ngzr_attachment_bytes
ngzr_attachment_uploads_total
ngzr_attachment_previews_total
```

审计事件：

- `attachment.upload`
- `attachment.bind`
- `attachment.download`
- `attachment.preview`
- `attachment.quarantine`
- `attachment.delete`

审计不记录文件内容，只记录文件 ID、大小、类型和操作者。

## 9. 分阶段实施建议

### 阶段 A：最小可用

- `/v1/files` 上传；
- 消息 `file` / `document` 引用；
- 本地 UUID 存储；
- 图片、文本、CSV 预览；
- 大小/数量限制；
- 调用 key 和回复员权限隔离；
- 审计和 GC。

### 阶段 B：安全增强

- magic bytes 校验；
- PDF/Office 仅下载；
- ZIP 目录预览；
- 可选 ClamAV hook；
- 配额和每日统计。

### 阶段 C：规模化

- 对象存储（S3/兼容）；
- 缩略图任务队列；
- 多实例共享元数据；
- 签名 URL 和 CDN；
- 备份/恢复演练。

## 10. 需要确认的产品决策

1. 单文件上限用 10 MiB 还是更大？
2. 是否允许 ZIP/Office，还是首期只允许图片、文本、PDF？
3. 附件保留期跟随票据 30 天，还是单独配置？
4. 是否接入 ClamAV？
5. PDF 首期是否允许浏览器内预览，还是只允许下载？
6. 调用方是否需要“附件列表/删除”API？

在这些问题确认前，不建议直接把附件写入公开 API 或发布包。


## 11. 首期实现范围（当前代码）

- `POST /v1/files`：原始二进制或单文件 multipart 上传；
- 消息引用：OpenAI `file` / `input_file`，Anthropic `document`；
- 允许 UTF-8 文本/日志/JSON/CSV、结构完整的 raster 图片、PDF 文本抽取；
- HTML、SVG、Office、ZIP、可执行文件和未知二进制拒绝；
- PDF 不做页面渲染；只提供抽取文字和原文件下载；
- 图片校验 magic、结构和尺寸，原图通过受保护的图片端点显示；
- 原件不内联：文本/PDF 下载使用 `attachment` 和非同源可执行内容；
- 附件按调用 key 哈希隔离，API key 与回复员权限分别校验；
- `attachments/` 目录 0700，文件 0600，默认保留 30 天；
- 已加入恶意类型、伪造图片、活动 PDF、超大文件、路径和跨 key 测试。
