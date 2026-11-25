# デプロイ手順書

このドキュメントでは、re:Inventコンシェルジュのデプロイ手順を説明します。

> Note: 実際の認証情報やコピペ用コマンドは、gitignore済みの `docs/credentials.md` を参照してください。

## 前提条件

- AWS SSO にログイン済み
- Docker Desktop をインストール済み
- Node.js 20+ をインストール済み
- uv をインストール済み

```bash
aws sso login --profile=<your-profile>
```

---

## Step 1: ECRリポジトリ作成 & Dockerイメージプッシュ

### 1.1 ECRリポジトリ作成（初回のみ）

```bash
aws ecr create-repository \
  --repository-name reinvent-concierge \
  --region us-west-2 \
  --profile <your-profile>
```

### 1.2 ECRログイン

```bash
aws ecr get-login-password --region us-west-2 --profile <your-profile> | \
  docker login --username AWS --password-stdin \
  <your-account-id>.dkr.ecr.us-west-2.amazonaws.com
```

### 1.3 Dockerイメージビルド & プッシュ

```bash
cd backend

# ARM64でビルド
docker build --platform linux/arm64 -t reinvent-concierge:latest .

# タグ付け & プッシュ
docker tag reinvent-concierge:latest <your-account-id>.dkr.ecr.us-west-2.amazonaws.com/reinvent-concierge:latest
docker push <your-account-id>.dkr.ecr.us-west-2.amazonaws.com/reinvent-concierge:latest
```

---

## Step 2: AgentCore Memory 作成

AWSコンソールで AgentCore Memory を作成します。

1. Amazon Bedrock コンソールで AgentCore → Memory を開きます。
2. 「Create memory」をクリックします。
3. 次のように設定します。
   - Name: `ReinventConciergeMemory`
   - Description: `re:Inventコンシェルジュの会話履歴`
4. 作成後、Memory ID を控えて `docs/credentials.md` に記録します。

---

## Step 3: AgentCore Runtime 作成

### 3.1 Runtime 作成

AWSコンソールで AgentCore Runtime を作成します。

1. Amazon Bedrock コンソールで AgentCore → Runtimes を開きます。
2. 「Create runtime」をクリックします。
3. 次のように設定します。
   - Name: `reinvent`
   - Container Image: `<your-account-id>.dkr.ecr.us-west-2.amazonaws.com/reinvent-concierge:latest`
   - 環境変数:
     - `TAVILY_API_KEY`: <your-tavily-api-key>
     - `KNOWLEDGE_BASE_ID`: <your-knowledge-base-id>
     - `MEMORY_ID`: Step 2で作成したMemory ID
4. 作成後、Runtime ID を控えて `docs/credentials.md` に記録します。

### 3.2 環境変数 & 認証設定

Cognito User Pool の作成後、環境変数と認証を設定します。

```bash
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id <runtime-id> \
  --agent-runtime-artifact 'containerConfiguration={containerUri=<ecr-uri>}' \
  --role-arn '<service-role-arn>' \
  --network-configuration 'networkMode=PUBLIC' \
  --environment-variables 'TAVILY_API_KEY=<your-tavily-api-key>,KNOWLEDGE_BASE_ID=<your-kb-id>,MEMORY_ID=<your-memory-id>' \
  --authorizer-configuration '{"customJWTAuthorizer":{"discoveryUrl":"https://cognito-idp.us-west-2.amazonaws.com/<user-pool-id>/.well-known/openid-configuration","allowedClients":["<app-client-id>"]}}' \
  --region us-west-2 \
  --profile <your-profile>
```

必須の環境変数は次のとおりです。

| 変数名 | 説明 |
|--------|------|
| `TAVILY_API_KEY` | Web検索用の Tavily API キー |
| `KNOWLEDGE_BASE_ID` | Bedrock ナレッジベース ID |
| `MEMORY_ID` | AgentCore Memory ID |

> 具体的な値は `docs/credentials.md` を参照してください。

10秒ほどでデプロイが完了します。

---

## Step 4: Cognito User Pool 作成

AWSコンソールで Cognito User Pool を作成します。

1. Amazon Cognito → User Pools → Create user pool を開きます。
2. 次のように設定します。
   - Sign-in: Email
   - Password policy: デフォルト
   - MFA: Off
3. App client を作成します。
4. User Pool ID と App Client ID を控えて `docs/credentials.md` に記録します。

---

## Step 5: フロントエンド設定

### 5.1 .env.local 作成

```bash
cd frontend

cat > .env.local << 'EOF'
VITE_USER_POOL_ID=<user-pool-id>
VITE_USER_POOL_CLIENT_ID=<app-client-id>
VITE_AGENT_RUNTIME_ARN=<agent-runtime-arn>
VITE_AWS_REGION=us-west-2
EOF
```

### 5.2 ローカル動作確認

```bash
npm run dev
```

---

## Step 6: Amplify Hosting デプロイ

### 6.1 GitHub 連携

1. Amplify コンソールで「Host web app」を開きます。
2. GitHub を選択します。
3. リポジトリとブランチを選択します。

### 6.2 ビルド設定

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - cd frontend
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: frontend/dist
    files:
      - '**/*'
  cache:
    paths:
      - frontend/node_modules/**/*
```

### 6.3 環境変数設定

Amplifyコンソールで次の環境変数を設定します。

- `VITE_USER_POOL_ID`
- `VITE_USER_POOL_CLIENT_ID`
- `VITE_AGENT_RUNTIME_ARN`
- `VITE_AWS_REGION`

---

## トラブルシューティング

### ヘルスチェックエラー（424）

コンテナの起動に失敗している可能性があります。
- CloudWatch Logs の `/aws/bedrock-agentcore/runtimes/<runtime-id>` を確認します。
- Dockerfile がシンプルな構成になっているか確認します。

### 認証エラー（403）

- `--authorizer-configuration` が正しく設定されているか確認します。
- id token ではなく Cognito の access token を使用しているか確認します。

### IAM権限エラー（AccessDeniedException）

AgentCore Runtimeのサービスロールに必要な権限を追加します。

ナレッジベース用の bedrock:Retrieve
```json
{
    "Effect": "Allow",
    "Action": "bedrock:Retrieve",
    "Resource": "arn:aws:bedrock:us-west-2:<account-id>:knowledge-base/<kb-id>"
}
```

Memory用の bedrock-agentcore:ListEvents
```json
{
    "Effect": "Allow",
    "Action": "bedrock-agentcore:ListEvents",
    "Resource": "*"
}
```

LLM呼び出し用の bedrock:InvokeModel
```json
{
    "Effect": "Allow",
    "Action": "bedrock:InvokeModel*",
    "Resource": "arn:aws:bedrock:*::foundation-model/*"
}
```

Memory用の bedrock-agentcore:CreateEvent
```json
{
    "Effect": "Allow",
    "Action": "bedrock-agentcore:CreateEvent",
    "Resource": "arn:aws:bedrock-agentcore:us-west-2:<account-id>:memory/<memory-id>"
}
```

### MCP stdio_client エラー

`StdioServerParameters` を使用して正しく初期化します。

```python
from mcp import stdio_client, StdioServerParameters

mcp_client = MCPClient(lambda: stdio_client(StdioServerParameters(
    command="uvx",
    args=["your-mcp-package"],
    env=os.environ.copy()
)))
```

### ECR push が失敗する

```bash
# 再ログイン
aws ecr get-login-password --region us-west-2 --profile <your-profile> | \
  docker login --username AWS --password-stdin \
  <your-account-id>.dkr.ecr.us-west-2.amazonaws.com
```

### AgentCore Runtime更新時のIAMロール検証エラー

```
ValidationException: Role validation failed for 'arn:aws:iam::xxx:role/...'
Please verify that the role exists and its trust policy allows assumption by this service
```

原因は、`update-agent-runtime` コマンドで指定した `--role-arn` が、実際にRuntimeに設定されているロールと異なることです。

解決するには、現在のRuntime情報を取得して正しい `roleArn` を確認します。

```bash
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id <runtime-id> \
  --region us-west-2 \
  --profile <your-profile>
```

出力から `roleArn` の値をコピーし、`update-agent-runtime` コマンドの `--role-arn` に指定します。

> Note: AWSコンソールで作成したRuntimeには、`AmazonBedrockAgentCoreRuntimeDefaultServiceRole-xxxxx` のような自動生成ロールが割り当てられていることが多いです。

### Strands Agentsのストリーミングイベント

重要な点として、Strandsの `agent.stream_async(prompt)` から返されるイベントには `agent` オブジェクトへの参照などPythonオブジェクトが含まれるため、**そのまま `yield event` すると文字列化されてしまいます**。

BedrockAgentCoreAppでは、イベントをJSON化可能な辞書に変換してからyieldする必要があります。

```python
def convert_event_to_dict(event) -> dict:
    """Strandsのイベントオブジェクトを JSON化可能な辞書に変換"""
    result = {}

    if hasattr(event, 'get'):
        # テキストデータ
        if event.get('data'):
            result['data'] = event.get('data')
        if event.get('delta') and isinstance(event.get('delta'), dict):
            delta_text = event.get('delta', {}).get('text')
            if delta_text:
                result['delta'] = {'text': delta_text}

        # ツール使用イベント
        if event.get('tool_use'):
            tool_use = event.get('tool_use')
            result['type'] = 'tool_use'
            result['tool_use'] = {
                'name': getattr(tool_use, 'name', None) or (tool_use.get('name') if hasattr(tool_use, 'get') else None),
                'id': getattr(tool_use, 'id', None) or (tool_use.get('id') if hasattr(tool_use, 'get') else None),
            }

        # ツール結果イベント
        if event.get('tool_result'):
            result['type'] = 'tool_result'
            result['tool_result'] = True

    if not result:
        return None
    return result

# 使用例
async for event in agent.stream_async(prompt):
    converted = convert_event_to_dict(event)
    if converted:
        yield converted
```

フロントエンドで受け取れるイベントは次のとおりです。

- `type: "tool_use"` はツール呼び出し開始で、`tool_use.name` でツール名を取得します。
- `type: "tool_result"` はツール呼び出し完了です。
- `data` / `delta.text` はテキストストリーミングです。

フロントエンドでこれらのイベントを解析すると、ツール使用中のUXを表示できます。

### フロントエンドのマークダウン整形

Tailwind CSS v4 では `@plugin` ディレクティブを使用します。

```css
/* index.css */
@import "tailwindcss";
@plugin "@tailwindcss/typography";
```

```tsx
// ChatInterface.tsx
import ReactMarkdown from 'react-markdown'

<div className="prose prose-sm max-w-none">
  <ReactMarkdown>{message.content}</ReactMarkdown>
</div>
```

### Observability（トレース）が表示されない

原因は、Dockerfile で `opentelemetry-instrument` コマンドを使用していないことです。

解決方法は次のとおりです。

1. `pyproject.toml` に必要なパッケージを追加します。

```toml
dependencies = [
    "strands-agents[otel]>=0.1.0",
    "aws-opentelemetry-distro>=0.10.1",
]
```

2. Dockerfile を修正します。

```dockerfile
# 依存関係をインストール
RUN uv sync

# opentelemetry-instrument 経由で実行
CMD ["uv", "run", "opentelemetry-instrument", "python", "-u", "main.py"]
```

3. アカウントごとに1回、CloudWatch Transaction Search を有効化します。
   - CloudWatch コンソール → Application Signals → Transaction Search

4. 再ビルドしてデプロイします。

> 詳細は `docs/dev-notes.md` の「AgentCore Observability 設定」セクションを参照してください。

---

## 更新時のデプロイ

### バックエンド更新

1. ECR にログインします。
2. Docker イメージをビルドしてプッシュします。
3. AgentCore Runtime を更新します。

```bash
# 1. ECRログイン
aws ecr get-login-password --region us-west-2 --profile <your-profile> | \
  docker login --username AWS --password-stdin \
  <your-account-id>.dkr.ecr.us-west-2.amazonaws.com

# 2. ビルド & プッシュ
cd backend
docker build --platform linux/arm64 -t reinvent-concierge:latest .
docker tag reinvent-concierge:latest <your-account-id>.dkr.ecr.us-west-2.amazonaws.com/reinvent-concierge:latest
docker push <your-account-id>.dkr.ecr.us-west-2.amazonaws.com/reinvent-concierge:latest

# 3. Runtime更新（全パラメータ必須）
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id <runtime-id> \
  --agent-runtime-artifact 'containerConfiguration={containerUri=<ecr-uri>}' \
  --role-arn '<service-role-arn>' \
  --network-configuration 'networkMode=PUBLIC' \
  --environment-variables 'TAVILY_API_KEY=<your-tavily-api-key>,KNOWLEDGE_BASE_ID=<your-kb-id>,MEMORY_ID=<your-memory-id>' \
  --authorizer-configuration '{"customJWTAuthorizer":{"discoveryUrl":"https://cognito-idp.us-west-2.amazonaws.com/<user-pool-id>/.well-known/openid-configuration","allowedClients":["<app-client-id>"]}}' \
  --region us-west-2 \
  --profile <your-profile>
```

> 具体的な値は `docs/credentials.md` を参照してください。

### フロントエンド更新

```bash
# Git push で自動デプロイ（Amplify Hosting）
git add .
git commit -m "Update frontend"
git push origin main
```
