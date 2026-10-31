# 发布前流程

> 这是开发目录文档，不随公开运行包发布。版本号当前为 0.6.0 时也按本流程执行。

## 1. 冻结范围

- 确认本轮只包含计划内的功能；
- 不混入临时调试代码、测试密钥、真实用户文件；
- 更新 `CHANGELOG.md`；
- 版本号保持 `0.6.0`，除非明确决定升级。

## 2. 本地验证

```bash
npm test
npm start
```

检查：

- `/healthz`
- `/provider`
- `/openapi.json`
- OpenAI `/v1/chat/completions`
- Anthropic `/v1/messages`
- `/console`、`/console/users`、`/console/keys`

自动化通过后，再按 [testing.md](testing.md) 做页面检查。

## 3. 隐私扫描

```bash
# 不应出现在发布文件中的名字
git grep -nIE '/home/|/Users/|192\\.168\\.|sk-[A-Za-z0-9]{12,}' -- . ':!test' || true

# 只应看到示例和字段说明
git grep -nIE 'password|secret|token|api[_-]?key' -- README.md docs examples config.example.jsonc || true
```

人工确认：

- `git status --ignored` 中没有准备发布的私有数据；
- `users.json`、`api-keys.json`、`state.json`、`usage.json` 不在发布清单；
- `.git`、日志、证书、临时截图不在压缩包；
- 测试文件不进入发布包。

## 4. 生成干净发布目录

不要直接把开发工作区打包。使用白名单复制：

```text
server.mjs
src/
public/
scripts/user.mjs
package.json              # 去掉 test 脚本
config.example.jsonc
config.jsonc
README.md
CHANGELOG.md
SECURITY.md
LICENSE
docs/architecture.md
docs/protocol.md
docs/security.md
docs/deployment.md
docs/quickstart.md
docs/openapi.json
integrations/dsh/
examples/
```

明确不要复制：

```text
.git/
test/
docs/dev/
docs/verification.md
docs/security-scan.md
docs/test-output.txt
users.json
api-keys.json
state.json
usage.json
*.log
*.pem / *.key / *.crt
```

## 5. 验证下载包

在临时目录解压干净包：

```bash
tar -xzf nenggong-zhiren-0.6.0.tar.gz
cd nenggong-zhiren-0.6.0
cp config.example.jsonc config.jsonc
# 修改 HOST/PORT 等，不要写密钥
npm start
```

检查：

- `/healthz` 200；
- `/login` 200；
- `/provider` 200；
- `/openapi.json` 200；
- 首次启动生成 `users.json`；
- 登录后生成调用密钥；
- 发一个真实请求并完成。

验证后停止临时实例并删除临时目录。

## 6. 版本与标签

```bash
git status
git tag -a v0.6.0 -m "能工智人 v0.6.0"
git push origin main
git push origin v0.6.0
```

如果标签已存在，不要强推覆盖；先确认是否已经有 Release，再决定是否需要新版本号。

## 7. GitHub Release

在仓库 Releases → Draft a new release：

- Tag：`v0.6.0`
- 附件：
  - `nenggong-zhiren-0.6.0.tar.gz`
  - `nenggong-zhiren-0.6.0.tar.gz.sha256`
- 说明从 `CHANGELOG.md` 提取；
- 发布后再下载附件，核对 SHA-256 并启动一次。

## 8. 发布后检查

```bash
curl -fsS https://你的地址/healthz
curl -fsS https://你的地址/provider
```

检查登录、密钥、队列和最近请求。若失败：

- 先停止新实例；
- 保留日志和状态文件；
- 回滚到上一个可运行包；
- 不要把已知损坏的包继续放在 Release 首页。

## 9. 每次发布保留

- 版本号
- Git 提交和标签
- 发布包 SHA-256
- 验证时间
- 已知问题
- 回滚版本
