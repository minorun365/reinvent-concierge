# Strands Agents + AgentCore Runtime ガイド

公式ドキュメントから取得した最新情報のサマリー。

## 重要: FastAPIではなくAgentCore SDKを使う

**AgentCore Runtimeにデプロイする場合、FastAPIは不要。**
`bedrock-agentcore` パッケージの `BedrockAgentCoreApp` を使用する（内部でStarletteを使用）。

---

## AgentCore SDKの基本構造

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent

app = BedrockAgentCoreApp()
agent = Agent()

@app.entrypoint
def invoke(payload):
    """エントリーポイント関数"""
    user_message = payload.get("prompt", "Hello!")
    result = agent(user_message)
    return {"result": result.message}

if __name__ == "__main__":
    app.run()
```

### ポイント
- `@app.entrypoint` デコレータでエントリーポイントを定義
- `app.run()` でサーバー起動（ポート8080）
- `/invocations` と `/ping` エンドポイントは自動で作成される

---

## ストリーミング対応版（参考コード: reference/amplify/agent.py）

```python
import os
import boto3
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp.mcp_client import MCPClient
from mcp.client.streamable_http import streamablehttp_client
from bedrock_agentcore.runtime import BedrockAgentCoreApp

app = BedrockAgentCoreApp()

AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")

@app.entrypoint
async def invoke_agent(payload, context):
    prompt = payload.get("prompt")
    tavily_api_key = payload.get("tavily_api_key")

    # Tavily MCPサーバーを設定
    mcp = MCPClient(lambda: streamablehttp_client(
        f"https://mcp.tavily.com/mcp/?tavilyApiKey={tavily_api_key}"
    ))

    # Boto3 sessionを作成（リージョンを明示的に指定）
    boto_session = boto3.Session(region_name=AWS_REGION)

    # BedrockModelを作成（Cross-Region Inference Profile使用）
    bedrock_model = BedrockModel(
        model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",  # us.プレフィックス
        boto_session=boto_session  # boto_sessionにリージョンが含まれている
    )

    # MCPクライアントを起動したまま、エージェントを呼び出し
    with mcp:
        agent = Agent(
            model=bedrock_model,
            tools=mcp.list_tools_sync()
        )

        # ストリーミングで応答を取得
        stream = agent.stream_async(prompt)
        async for event in stream:
            yield event

app.run()
```

### BedrockModelのポイント

| 項目 | 説明 |
|------|------|
| `model_id` | `us.`プレフィックス付き = Cross-Region Inference Profile |
| `boto_session` | リージョンを明示的に指定したboto3.Session |

### ストリーミングのポイント
- `async def` と `yield` でストリーミング対応
- `agent.stream_async(prompt)` でストリーミング取得
- MCPクライアントは `with` 文で管理

---

## contextパラメータ

`@app.entrypoint` のコールバック関数は `context` パラメータを受け取れる：

```python
@app.entrypoint
def invoke(payload, context):
    session_id = context.session_id  # セッションID
    # ...
```

---

## デプロイ方法

### 手動Docker + AWS CLI

```bash
# ECRリポジトリ作成
aws ecr create-repository --repository-name reinvent-concierge --region us-west-2

# ECRログイン
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 715841358122.dkr.ecr.us-west-2.amazonaws.com

# ビルド＆プッシュ（ARM64）
docker buildx build --platform linux/arm64 -t 715841358122.dkr.ecr.us-west-2.amazonaws.com/reinvent-concierge:latest --push .

# AgentCore Runtime更新
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id <runtime-id> \
  --agent-runtime-artifact containerConfiguration={containerUri=<ecr-uri>} \
  --authorizer-configuration '{...}' \
  --region us-west-2
```

---

## Dockerfile

```dockerfile
FROM --platform=linux/arm64 ghcr.io/astral-sh/uv:python3.11-bookworm-slim

WORKDIR /app

COPY pyproject.toml ./
RUN uv sync --no-cache

COPY main.py ./

EXPOSE 8080

# Observability用にopentelemetry-instrumentで起動
CMD ["opentelemetry-instrument", "uv", "run", "python", "main.py"]
```

---

## requirements.txt

```
bedrock-agentcore
strands-agents
strands-agents[otel]
aws-opentelemetry-distro>=0.10.1
mcp
re-invent-2025-mcp
```

---

## MCPツール統合パターン

### リモートMCP（Tavily）

```python
from strands.tools.mcp.mcp_client import MCPClient
from mcp.client.streamable_http import streamablehttp_client

mcp = MCPClient(lambda: streamablehttp_client(
    f"https://mcp.tavily.com/mcp/?tavilyApiKey={api_key}"
))

with mcp:
    agent = Agent(
        model=bedrock_model,
        tools=mcp.list_tools_sync()
    )
```

### ビルトインretrieve（Bedrockナレッジベース）

```python
from strands.tools import retrieve

agent = Agent(
    model=bedrock_model,
    tools=[retrieve(knowledge_base_id="<kb-id>")]
)
```

---

## トラブルシューティング

### Docker ビルドが失敗する

**症状:** `no such file or directory: backend/requirements.txt`

**解決策:** プロジェクトルートからビルドしてください
```bash
# ❌ 間違い
cd backend && docker build -f Dockerfile .

# ✅ 正しい
docker buildx build -f backend/Dockerfile .
```

### ECR push が失敗する

**症状:** `denied: Your authorization token has expired`

**解決策:** ECRに再ログインしてください
```bash
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin \
  715841358122.dkr.ecr.us-west-2.amazonaws.com
```

### 認証エラー（403）が発生する

**症状:** `Authorization method mismatch`

**原因:** `--authorizer-configuration` を指定せずにデプロイしたため、認証タイプが `IAM許可` になっている

**解決策:** `--authorizer-configuration` を含めて再デプロイしてください

### Runtime が UPDATING のまま

**解決策:** 数分待ってからステータスを再確認
```bash
aws bedrock-agentcore-control get-agent-runtime \
  --region us-west-2 \
  --agent-runtime-id <runtime-id> \
  --query 'status' \
  --output text
```

---

## AgentCore Memory（会話履歴）

### 概要

AgentCore Memoryは、会話履歴を永続化するマネージドサービス。
Strands AgentsのSession Managerと統合して使用。

### メモリタイプ

| タイプ | 説明 |
|--------|------|
| **短期記憶（STM）** | セッション内の会話履歴（ターン単位） |
| **長期記憶（LTM）** | セッションをまたぐユーザー設定・事実の抽出 |

今回のアプリでは**短期記憶（STM）のみ使用**（画面リロードで履歴リセット）

### インストール

```bash
pip install 'bedrock-agentcore[strands-agents]'
```

### Session Manager作成（参考コード: reference/agentcore/memory.py）

```python
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager

def create_session_manager(
    memory_id: str,
    session_id: str,
    actor_id: str,
    region: str = "us-west-2"
) -> AgentCoreMemorySessionManager:
    """
    AgentCore MemoryのSessionManagerを作成

    Args:
        memory_id: AgentCore MemoryのID（AWSコンソールで作成）
        session_id: セッションID（UUID推奨、画面リロードで新規生成）
        actor_id: アクターID（Cognito subなどユーザー識別子）
        region: AWSリージョン
    """
    memory_config = AgentCoreMemoryConfig(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=actor_id
    )

    session_manager = AgentCoreMemorySessionManager(
        agentcore_memory_config=memory_config,
        region_name=region
    )

    return session_manager
```

### Agentへの統合

```python
from strands import Agent

session_manager = create_session_manager(
    memory_id="your-memory-id",
    session_id=session_id,  # フロントエンドから送信
    actor_id=actor_id       # Cognito subなど
)

agent = Agent(
    model=bedrock_model,
    tools=tools,
    session_manager=session_manager,  # ← これで会話履歴が自動保存
    trace_attributes={...}
)
```

### Memory IDの作成（みのるんが手動で実施）

AWSコンソールまたはboto3で作成：

```python
from bedrock_agentcore.memory import MemoryClient

client = MemoryClient(region_name="us-west-2")
memory = client.create_memory(
    name="ReinventConciergeMemory",
    description="re:Inventコンシェルジュの会話履歴"
)
memory_id = memory.get('id')
print(f"Memory ID: {memory_id}")
```

---

## Observability設定

### CloudWatch Transaction Search 有効化（1回のみ）

1. CloudWatch コンソールを開く
2. Application Signals > Transaction Search
3. "Enable Transaction Search" を選択

### trace_attributes設定（参考コード: reference/agentcore/observability.py）

```python
def create_trace_attributes(
    session_id: str,
    actor_id: str,
    gateway_url: str,
    memory_id: str,
    region: str
) -> dict:
    return {
        "session.id": session_id,
        "actor.id": actor_id,
        "gateway.url": gateway_url,
        "memory.id": memory_id,
        "region": region
    }
```

### Agentへの統合

```python
agent = Agent(
    model=bedrock_model,
    tools=tools,
    session_manager=session_manager,
    trace_attributes=create_trace_attributes(
        session_id=session_id,
        actor_id=actor_id,
        gateway_url=gateway_url,
        memory_id=MEMORY_ID,
        region=REGION
    )
)
```

---

## 参考リンク

- [Strands Agents 公式ドキュメント](https://strandsagents.com/latest/)
- [AgentCore Runtime ドキュメント](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
- [AgentCore SDK サンプル](https://github.com/awslabs/amazon-bedrock-agentcore-samples)
- [Starter Toolkit](https://github.com/aws/bedrock-agentcore-starter-toolkit)