<p align="center">
  <img src="public/icon-192.png" width="112" height="112" alt="能工智人图标" />
</p>

# 能工智人 · nenggong-zhiren

> 一个按 OpenAI 聊天接口格式对外提供服务的「人工回复」项目。
> 没有模型权重；真正接单的是坐在工作台后面的人。

**不是 AI 中转站。** 能工智人是人工回复工作台，不是 AI API 中转、模型代充或自动聊天服务。管理员可选开启的 AI 辅助只向回复员提供摘要、翻译和草稿建议，不会自动回复调用方。

## 30 秒理解

```text
调用方发 OpenAI / Anthropic 请求
        ↓
票据进入队列
        ↓
回复员在网页工作台认领
        ↓
人工编写回复 / 工具调用 / 思考内容
        ↓
调用方收到标准格式响应
```

适合：局域网、教学演示、内部工具、人在环实验。

不适合：冒充真实大模型供应商、无人值守自动客服、公网匿名开放服务。

## 快速开始

需要 Node.js 20+，基础功能不需要 `npm install`。

```bash
cd nenggong-zhiren
cp config.example.jsonc config.jsonc
node server.mjs
```

第一次启动若没有 `users.json`，终端会打印一次随机管理员密码。登录 `http://127.0.0.1:7355/login`，在「API 密钥」生成调用方 key。

发送第一个请求：

```bash
curl http://127.0.0.1:7355/v1/chat/completions \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"human-1","messages":[{"role":"user","content":"你好"}]}'
```

详细安装、工作台和首个真实请求见 [快速启动](docs/quickstart.md)。

## 能做什么

| 能力 | 说明 |
| --- | --- |
| 聊天回复 | 非流式或流式 SSE |
| 工具调用 | JSON Schema 参数校验；人工确认后返回 |
| 结构化输出 | `json_object` / `json_schema`，不合法不发送 |
| 图片与附件 | 工作台预览；危险格式拒绝 |
| 会话聚合 | 同一会话按轮次聚合，一个进行中轮次 |
| 断线重连 | `Idempotency-Key` 恢复 SSE 或等待完成 |
| AI 辅助 | 生成期间显示状态，结果卡片可查看本次详情；不设应用级每日/时长/字符限制，资源和模型边界由上游负责 |
| 自动 AI | 管理员开关；收到/认领后预生成卡片，不自动填入、不自动回复、不自动发送 |
| 导航 | 一级入口收敛为坐席、概览、记录、管理、设置；概览/记录/管理使用统一二级 Hub |
| 快捷栏 | 每个账号独立配置，最多 15 项；支持动作、页面跳转和信息显示 |
| 环境检查 | 管理员页只探测配置中指定的 Python worker 路径，不扫描其他目录 |
| 管理员接管 | 可接管回复员已认领、尚未流式发送的票据 |
| 可观测性 | 状态页、Prometheus `/metrics`、历史、审计、CSV |
| 页面性能 | 静态资源 ETag 缓存；管理 Hub 空闲预载二级页面 |

接口字段、流式事件、工具和错误格式见 [协议兼容性](docs/protocol.md) 与 [OpenAPI](docs/openapi.json)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [快速启动](docs/quickstart.md) | 安装、启动、工作台、首次请求、常见问题 |
| [协议兼容性](docs/protocol.md) | OpenAI / Anthropic、流式、工具、JSON、幂等 |
| [部署](docs/deployment.md) | 配置、局域网、TLS、DSH 接入、systemd、备份 |
| [安全模型](docs/security.md) | 威胁模型、鉴权、限制、残余风险 |
| [架构](docs/architecture.md) | 请求生命周期、状态机、持久化边界 |
| [更新记录](CHANGELOG.md) | 版本变更 |

历史测试、发布材料和内部开发文档不进入当前公开文档树；当前变更见 [CHANGELOG](CHANGELOG.md)。

## 开发与验证

```bash
npm test        # 74 个自动化用例
npm start       # 启动
```

项目不依赖构建步骤，浏览器端使用原生 HTML/CSS/JavaScript。测试覆盖 OpenAI/Anthropic、流式、工具、幂等、重连、附件、AI、SQLite、历史和权限边界。

未经明确要求，不要直接把本地改动推送到远端。

## 安全边界

- 工具调用参数会校验，但工具由调用方自己执行；不要在不受限环境给陌生工具授权。
- 本项目是单进程参考实现，不提供多节点 HA。
- 部署应使用独立账号/密钥、TLS、网络 ACL 和集中审计。
- 可选媒体 worker 默认按 `config.jsonc` 的明确路径探测；发布包不包含 Python 脚本，缺失时自动跳过图片重编码，PDF 页图预览显示不可用。
- 不要把管理员密码、调用密钥、`users.json`、`api-keys.json`、数据库或附件提交到仓库。

完整边界和处理建议见 [安全模型](docs/security.md)；漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## License

[MIT](LICENSE)
