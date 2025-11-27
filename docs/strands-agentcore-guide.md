# Strands Agents + AgentCore Runtime ガイド

## 基本構造

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

app = BedrockAgentCoreApp()

@app.entrypoint
async def invoke_agent(payload, context):
    prompt = payload.get("prompt")
    # ... Agent作成・実行
    async for event in agent.stream_async(prompt):
        yield event

app.run()
```

### ポイント
- `@app.entrypoint` デコレータでエントリーポイントを定義
- `app.run()` でサーバー起動（ポート8080）
- `/invocations` と `/ping` エンドポイントは自動作成

---

## BedrockModel設定

```python
import boto3
from strands.models import BedrockModel

boto_session = boto3.Session(region_name="us-west-2")

bedrock_model = BedrockModel(
    model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",  # Cross-Region Inference
    boto_session=boto_session
)
```

| 項目 | 説明 |
|------|------|
| `model_id` | `us.`プレフィックス = Cross-Region Inference Profile |
| `boto_session` | リージョンを明示的に指定 |

---

## MCPツール統合

### リモートMCP（Tavily）

```python
from strands.tools.mcp import MCPClient
from mcp.client.streamable_http import streamablehttp_client

mcp = MCPClient(lambda: streamablehttp_client(
    f"https://mcp.tavily.com/mcp/?tavilyApiKey={api_key}"
))

with mcp:
    agent = Agent(model=bedrock_model, tools=mcp.list_tools_sync())
```

### ローカルMCP（stdio）

```python
from mcp import stdio_client, StdioServerParameters

mcp = MCPClient(lambda: stdio_client(StdioServerParameters(
    command="uvx",
    args=["re-invent-2025-mcp"],
    env=os.environ.copy()
)))
```

### ビルトイン retrieve（ナレッジベース）

```python
from strands_tools import retrieve

agent = Agent(model=bedrock_model, tools=[retrieve])
# knowledgeBaseId はシステムプロンプトで指定
```

---

## AgentCore Memory

```python
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager

memory_config = AgentCoreMemoryConfig(
    memory_id=memory_id,
    session_id=session_id,
    actor_id=actor_id
)

session_manager = AgentCoreMemorySessionManager(
    agentcore_memory_config=memory_config,
    region_name="us-west-2"
)

agent = Agent(
    model=bedrock_model,
    tools=tools,
    session_manager=session_manager  # 会話履歴が自動保存
)
```

---

## Observability

CloudWatch GenAI Observability でエージェントのトレースを確認可能。

### 前提条件

1. **CloudWatch Transaction Search を有効化**（アカウントごとに1回）
   - CloudWatch コンソール → Application Signals → Transaction Search
   - 有効化後、約10分でトレースが検索可能に

2. **必要なパッケージ**

```toml
# pyproject.toml
dependencies = [
    "strands-agents[otel]>=0.1.0",      # Strands がトレースを生成
    "aws-opentelemetry-distro>=0.10.1", # CloudWatch に送信
]
```

### Agent に trace_attributes を設定

```python
agent = Agent(
    model=bedrock_model,
    trace_attributes={
        "session.id": session_id,
        "actor.id": actor_id,
        "region": "us-west-2",
    }
)
```

### 確認方法

CloudWatch コンソール → GenAI Observability → Bedrock AgentCore タブ

- **Agents View**: エージェント一覧とメトリクス
- **Sessions View**: セッション一覧（session.id でフィルタ可能）
- **Traces View**: トレース詳細（タイムライン、ツール呼び出し）

---

## Dockerfile

**重要**: Observability を有効にするには `opentelemetry-instrument` 経由で実行する必要がある。

```dockerfile
FROM --platform=linux/arm64 ghcr.io/astral-sh/uv:python3.11-bookworm-slim
WORKDIR /app
COPY pyproject.toml main.py ./

# 依存関係をインストール（opentelemetry-instrument を使うため）
RUN uv sync

EXPOSE 8080

# opentelemetry-instrument 経由で実行（Observability 有効化）
CMD ["uv", "run", "opentelemetry-instrument", "python", "-u", "main.py"]
```

**必須要件**:
- プラットフォーム: `linux/arm64`
- ポート: 8080
- エンドポイント: `/invocations`, `/ping`
- **Observability**: `opentelemetry-instrument` で起動

---

## デプロイ

```bash
# 1. ECRログイン
aws ecr get-login-password --region us-west-2 --profile sandbox | \
  docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-west-2.amazonaws.com

# 2. ビルド & プッシュ
docker build --platform linux/arm64 -t reinvent-concierge:latest .
docker tag reinvent-concierge:latest <ecr-uri>:latest
docker push <ecr-uri>:latest

# 3. Runtime更新（JWT認証設定を含める！）
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id <runtime-id> \
  --agent-runtime-artifact 'containerConfiguration={containerUri=<ecr-uri>}' \
  --role-arn '<service-role-arn>' \
  --network-configuration 'networkMode=PUBLIC' \
  --authorizer-configuration '{"customJWTAuthorizer":{...}}' \
  --region us-west-2
```

**重要**: `--authorizer-configuration` を省略すると認証タイプがIAMに戻る

---

## 参考リンク

- [Strands Agents 公式](https://strandsagents.com/latest/)
- [AgentCore Runtime ドキュメント](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/)
- [AgentCore SDK サンプル](https://github.com/awslabs/amazon-bedrock-agentcore-samples)
