# 安全测试记录（2026-10-30）

## 范围

本记录针对当前 0.6.0 服务、公开教程页、票据摘要修复和现有管理/回复员接口做只读安全回归。
没有使用生产管理员会话修改数据；认证后的边界由项目自带的临时测试项目覆盖。

## 自动化

```text
npm test
tests 51
pass 51
fail 0
```

测试覆盖登录/会话/CSRF/Origin/Host、管理员与回复员权限、票据模型可见性、附件所有权与恶意文件、
路径穿越、公开教程页开关、上传配额、幂等/SSE 重连、设置持久化和票据摘要元数据。

## 未登录 HTTP 探测

- `/op/api/settings`、`users`、`keys`、`models`、`history`、`audit`、`status`、`tickets`、`usage`、`operators`、`me`：全部 `401`；
- `/console`、`/console/settings`、`/console/users`、`/console/status`、`/console/history`、`/console/guide`：全部 `302` 到登录；
- `/guide`：公开开关开启时为 `200`；关闭时 `302` 到登录（自动化测试覆盖）；
- `/server.mjs`、`config.jsonc`、`users.json`、`api-keys.json`、`state.json`、`settings.json`、
  `usage.json`、`audit.log`、`.git`、`test/`、`docs/`、`public/` 源文件：全部 `404`；
- 路径穿越和编码穿越：`404`；
- 未知 API 不反射输入；未认证错误只返回通用认证错误；
- 未受信 `Host: evil.example`：`421`；
- `/guide` 的 `POST` 和 `OPTIONS`：`405`；
- 教程公开页查询字符串不改变响应，无内联脚本/表单，无实际部署地址、端口、模型名或密钥；
- 教程页/静态 CSS 带 `no-store`、`nosniff`、`DENY`、`no-referrer`、CSP 和 `noindex`。

## 结论

未发现新增的未授权信息暴露、权限绕过或动态注入面。  
以下按设计公开，不属于越权：`/healthz`、`/metrics`、`/provider`、`/openapi.json`，以及开关开启时的
`/guide` 与 `/guide.css` 公开静态页。
