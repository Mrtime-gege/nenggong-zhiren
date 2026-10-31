# Xiaomi Token Plan / MiMo 兼容记录

## 已确认配置

- Provider：`xiaomi-token-plan-cn`
- API Base：`https://token-plan-cn.xiaomimimo.com/v1`
- Model：`mimo-v2.6-pro`
- API 形态：OpenAI Chat Completions
- DSH 环境密钥名：`XIAOMI_TOKEN_PLAN_CN_API_KEY`

## AI 辅助实测

通过管理员设置页/API 配置：

```json
{
  "endpoint": "https://token-plan-cn.xiaomimimo.com/v1",
  "model": "mimo-v2.6-pro"
}
```

对已完成票据执行 `summary` 任务：

```text
HTTP 200
provider_model: mimo-v2.6-pro
usage: inputTokens=3141, outputTokens=326
```

返回为正常文本摘要，说明 Endpoint、模型名和 Bearer 认证配置正确。

## 注意

- API Key 从未写入仓库、日志或本文档；
- 实测后已清除生产 AI Key 并把 AI 辅助恢复为关闭；
- 该模型上下文窗口很大，但 AI 辅助仍按管理员配置的 `maxInputChars` 截断；
- 如果供应商后续修改模型名，需在管理员设置中同步更新。
