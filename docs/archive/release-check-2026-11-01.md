# 0.6.0 发布前检查

日期：2026-11-01（Asia/Shanghai）
版本：`0.6.0`
代码基线：`7fc187c` + 发布清理提交

## 1. 真实浏览器操作

使用真实 Chromium 完成登录和坐席操作，不是只调用接口。

### 1.1 登录与工具调用

- 访问 `/login`，填写管理员账密并登录；
- 进入 `/console`，选中测试票据并点击「认领」；
- 打开工具检查器，直接添加空参数，页面显示：

```text
参数.order_id 不能为空
```

- 填写 `{"order_id":"A-100"}` 后添加成功；
- 点击「发送工具调用并完成」；
- 调用方真实收到 200：

```json
{
  "finish_reason": "tool_calls",
  "tool_calls": [{
    "id": "call_...",
    "type": "function",
    "function": {
      "name": "lookup_order",
      "arguments": "{\"order_id\":\"A-100\"}"
    }
  }]
}
```

### 1.2 AI 生成

- 选中另一张测试票据并认领；
- 打开 `AI 引导`，输入方向提示；
- 点击 `AI 生成`；
- 面板显示 `AI 生成中…` 和 `已用时 0 秒`；
- 生成完成，草稿被覆盖，计时器停止；
- 点击完成，调用方真实收到 200：

```json
{
  "content": "浏览器测试完成",
  "finish_reason": "stop"
}
```

### 1.3 管理员接管

- 临时回复员 `browser_op` 认领票据；
- 管理员在浏览器打开该票据；
- 页面显示「由 browser_op 接待中。可点击下方「接管」继续处理。」；
- 点击「接管」并确认；
- 页面变为 `claimedBy=admin`；
- 服务端写入内部备注：

```text
管理员接管：browser_op → admin
```

临时用户和票据已清理。

### 1.4 移动端

- 390×844 登录页：46×46 图标加载，页面无横向溢出，卡片居中；
- 工作台详情：回复框和命令栏在首屏；
- 管理页面：无横向溢出，顶部导航按预期横向滚动。

浏览器操作详细结果见 [local-full-test-2026-11-01.md](local-full-test-2026-11-01.md)。

## 2. 敏感信息检查

### 2.1 扫描命令

```bash
git grep -nE '管理员密码|API Key|私钥|DSH token|私有 LAN IP|本机绝对路径' -- .
rg -n --hidden -g '!.git/**' -g '!*.db*' 'BEGIN .*PRIVATE KEY|ghp_|AKIA|AIza|sk-[A-Za-z0-9_-]{20,}' .
python3 -c 'from PIL import Image; ...'  # PNG 元数据
strings public/icon-*.png public/favicon.ico
```

### 2.2 结果

- 未发现管理员明文密码；
- 未发现真实调用密钥；
- 未发现 DSH token；
- 未发现私钥、AWS/GitHub/Google key；
- 未发现测试用户密码；
- 图标 PNG 元数据为空；
- 图标二进制中没有用户名、路径、LAN IP 或密钥字符串。

### 2.3 发现的部署信息及处理

| 项目 | 处理 |
| --- | --- |
| `config.jsonc` 中的私有 LAN IP | 不再纳入 Git 跟踪；加入 `.gitignore`，保留在本机运行 |
| `docs/deployment.md` 中的私有 LAN IP | 改为 `<LAN-IP>` 占位符 |
| `docs/acceptance.md` 中的本机绝对路径 | 改为 `<repo-parent>` 占位符 |
| 测试报告中的本机绝对路径 | 改为 `<repo-dir>` 占位符 |
| 账号、密钥、状态、历史、审计、附件 | 已有 `.gitignore` 覆盖，不进入发布树 |

### 2.4 历史注意事项

私有 LAN IP 仍存在于旧提交 `17c0808` 的 `config.jsonc` 中。

- 当前发布树已不再包含它；
- 用 `git archive` 导出的发布包不包含它；
- 如果直接公开完整 `.git` 历史，需要另行做历史清理或只发布导出包。

## 3. 本轮新增发布文件

### 3.1 图标资产

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `public/icon.svg` | 2.0 KB | `e6685af0…aee63d` |
| `public/favicon.ico` | 2.5 KB | `c5c4d494…90c5` |
| `public/icon-16.png` | 718 B | `aa8315ac…3eb4c` |
| `public/icon-32.png` | 1.8 KB | `c48b1ee6…e57` |
| `public/icon-192.png` | 16 KB | `4fcc22b2…816b7` |
| `public/icon-512.png` | 51 KB | `0fdf8c80…cc0b9` |
| `public/apple-touch-icon.png` | 15 KB | `f6eba04e…c598` |
| `public/manifest.webmanifest` | 586 B | `edea83d1…a628` |

图标 PNG 均为 RGBA，无 EXIF/文本元数据；SVG 无外部引用、无脚本。

### 3.2 新增文档

- `docs/release-0.6.0.md`：0.6.0 更新说明；
- `docs/local-full-test-2026-11-01.md`：全面本地测试报告；
- `docs/release-check-2026-11-01.md`：本文件。

### 3.3 修改的发布接口

- 所有页面加入 favicon、apple-touch-icon、manifest；
- 登录页增加 46px 主图标；
- 控制台和管理页顶栏增加 24px 图标与在线状态徽标；
- `server.mjs` 增加图标/manifest 静态路由；
- `test/provider.test.mjs` 增加图标资源测试。

## 4. 发布确认

```text
自动化测试：70 / 70 通过
静态语法检查：通过
SQLite quick_check：ok
真实浏览器：通过
敏感信息扫描：无凭据/密钥命中
发布树：不含 config.jsonc、账号、密钥、数据库和附件
```

完整测试输出：[test-output.txt](test-output.txt)

版本说明：[release-0.6.0.md](release-0.6.0.md)

## 5. 残余风险

1. 真实 AI 输出由外部 MiMo 模型决定，不能保证严格遵循引导提示词。
2. 当前是单进程实现，不提供多节点 HA。
3. 移动端只验收 390×844 一个视口。
4. 未做公网压力/浸泡测试。
5. 完整 Git 历史中的旧 `config.jsonc` 私有 LAN IP 需要单独历史清理；发布时建议使用 `git archive` 导出的干净树。
