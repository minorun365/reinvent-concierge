# re:Inventコンシェルジュ - アーキテクチャ設計

## 概要

AWS re:Invent 2025に関する質問に答えるAIエージェント・チャットボット

## 技術スタック

### フロントエンド
- **フレームワーク**: Vite + React + TypeScript
- **ホスティング**: AWS Amplify Gen2
- **認証**: Amazon Cognito (マネージド認証画面)
- **UIライブラリ**: AWS Amplify UI React + Tailwind CSS

### バックエンド
- **エージェントフレームワーク**: Strands Agents
- **ランタイム**: Amazon Bedrock AgentCore Runtime
- **SDK**: `bedrock-agentcore` (BedrockAgentCoreApp) ※FastAPIではない
- **LLM**: Claude Haiku 4.5 (`us.anthropic.claude-haiku-4-5-20251001-v1:0`)
- **コンテナ**: Docker (ARM64) → ECR

### ツール（MCP）
1. **Tavily公式リモートMCP** - Web検索
2. **Strands公式ビルトイン「retrieve」** - Bedrockナレッジベース検索
3. **re-invent-2025-mcp** - re:Invent 2025セッション情報（ローカルMCP）
   - PyPI: https://pypi.org/project/re-invent-2025-mcp/
   - GitHub: https://github.com/manu-mishra/reinvent-mcp-2025
   - インストール: `pip install re-invent-2025-mcp` または `uvx re-invent-2025-mcp`
   - 機能: 1,843セッションの検索、スピーカー情報、レベル/形式フィルタリング

### 会話履歴
- **AgentCore Memory** + **Strands Session Manager**
  - 短期記憶（STM）: セッション内の会話履歴
  - 画面リロードで履歴リセット（session_idを新規生成）

### 監視
- **AgentCore Observability** → CloudWatch GenAI Observability

---

## アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────────────┐
│                           ユーザー                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    AWS Amplify Gen2                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Vite + React アプリケーション                                │   │
│  │  - Cognito認証 (メール+パスワード)                            │   │
│  │  - チャットUI (ストリーミング対応)                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │ JWT Token (OAuth)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Bedrock AgentCore Runtime                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Strands Agent (BedrockAgentCoreApp + Docker ARM64)          │   │
│  │  - Claude Haiku 4.5                                          │   │
│  │  - SSEストリーミング                                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                          │                                          │
│         ┌────────────────┼────────────────┐                        │
│         ▼                ▼                ▼                        │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐                  │
│  │ Tavily    │    │ Bedrock   │    │re-invent  │                  │
│  │ MCP       │    │ KB MCP    │    │-2025-mcp  │                  │
│  │(リモート)  │    │(retrieve) │    │(ローカル)  │                  │
│  └───────────┘    └───────────┘    └───────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│              CloudWatch GenAI Observability                          │
│  - トレース（エージェント実行フロー）                                 │
│  - メトリクス（レイテンシ、トークン使用量）                           │
│  - ログ                                                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## リージョン

**すべて us-west-2 (オレゴン) に統一**

---

## 認証フロー

1. ユーザーがアプリにアクセス
2. Cognito Managed Login画面を表示（日本語化済み）
3. メール+パスワードでサインイン/サインアップ
4. JWTトークンを取得
5. AgentCore RuntimeにJWTで認証してリクエスト

### Cognito日本語化

Managed Loginは `lang=ja` パラメータで日本語化可能：
```
https://<domain>/oauth2/authorize?lang=ja&response_type=code&client_id=<client_id>&redirect_uri=<url>
```

ただし、Amplify UIを使う場合は `I18n.putVocabularies()` で翻訳を設定（参考コードと同様）

---

## ストリーミング処理

### バックエンド（SSE形式）
```python
async def stream_response():
    async for event in agent.stream_async(message):
        if event.type == "text":
            yield f"data: {json.dumps({'type': 'text', 'content': event.text})}\n\n"
        elif event.type == "tool_use":
            yield f"data: {json.dumps({'type': 'tool_use', 'tool': event.tool_name})}\n\n"
```

### フロントエンド
- Server-Sent Events (SSE) でリアルタイム受信
- テキストバッファで蓄積・表示
- ツール使用時はインジケーター表示 → 完了でチェックマーク

---

## AgentCore Runtimeへのデプロイ

### 必須要件
- **プラットフォーム**: linux/arm64
- **エンドポイント**: `/invocations` (POST), `/ping` (GET)
- **ポート**: 8080

### 認証設定（重要！）
更新時に `--authorizer-configuration` を必ず指定：
```bash
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id <runtime-id> \
  --agent-runtime-artifact containerConfiguration={containerUri=<ecr-uri>} \
  --authorizer-configuration '{
    "customJWTAuthorizer": {
      "discoveryUrl": "https://cognito-idp.us-west-2.amazonaws.com/<user-pool-id>/.well-known/openid-configuration",
      "allowedClients": ["<app-client-id>"]
    }
  }'
```

---

## Observability設定

### 必要なパッケージ
```
bedrock-agentcore[strands-agents]
strands-agents[otel]
aws-opentelemetry-distro
```

### trace_attributes設定
```python
agent = Agent(
    model="anthropic.claude-haiku-4-5-20251001-v1:0",
    trace_attributes={
        "session.id": session_id,
        "actor.id": actor_id,
    }
)
```

### Dockerでの起動
```dockerfile
CMD ["opentelemetry-instrument", "uv", "run", "python", "agent.py"]
```

---

## ディレクトリ構成

```
reinvent-concierge/
├── frontend/                    # Amplify Gen2 + Vite + React
│   ├── src/
│   │   ├── App.tsx             # メインアプリ
│   │   ├── components/
│   │   │   ├── ChatInterface.tsx
│   │   │   └── ConfigureAmplify.tsx
│   │   └── main.tsx
│   ├── amplify/
│   │   ├── auth/               # Cognito設定
│   │   └── backend.ts
│   ├── package.json
│   └── vite.config.ts
├── backend/                     # Strands Agent
│   ├── main.py                # BedrockAgentCoreAppエントリーポイント
│   ├── requirements.txt
│   └── Dockerfile
├── docs/
│   ├── architecture.md         # このファイル
│   └── deploy.md               # デプロイ手順
├── project.md                   # プロジェクト要件
└── q-and-a.md                   # Q&A
```

---

## 環境変数・シークレット

### バックエンド（AgentCore環境変数）
| 変数名 | 説明 | 設定場所 |
|--------|------|----------|
| TAVILY_API_KEY | Tavily APIキー | AgentCore環境変数 |
| KNOWLEDGE_BASE_ID | Bedrockナレッジベース | コード内べた書きOK |

### フロントエンド
- `amplify_outputs.json` で自動設定（Cognito等）

---

## 次のステップ

1. **フロントエンド開発** - Amplify Gen2プロジェクト作成、認証UI、チャット画面
2. **バックエンド開発** - Strands Agent、BedrockAgentCoreApp、MCP統合
3. **ECRプッシュ** - Dockerイメージビルド
4. **GitHub作成** - リポジトリ作成、プッシュ
5. **手動設定（みのるん）** - ナレッジベース、AgentCoreランタイム作成