#!/usr/bin/env sh
# 把三个变量换成你的地址、模型和网页里生成的调用密钥。
BASE_URL="${BASE_URL:-http://127.0.0.1:7355}"
MODEL="${MODEL:-human-1}"
API_KEY="${API_KEY:?请先设置 API_KEY}"

curl -N "$BASE_URL/v1/messages" \
  -H "x-api-key: $API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"max_tokens\": 256,
    \"stream\": true,
    \"messages\": [{\"role\": \"user\", \"content\": \"你好\"}]
  }"
