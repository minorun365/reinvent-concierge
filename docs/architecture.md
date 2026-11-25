# アーキテクチャ設計

## 構成図

```
┌─────────────────────────────────────────────────────────────────────┐
│                           ユーザー                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    AWS Amplify Hosting                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Vite + React アプリケーション                                │   │
│  │  - Cognito認証 (メール+パスワード)                            │   │
│  │  - チャットUI (SSEストリーミング対応)                         │   │
│  │  - Tailwind CSS v4 + @tailwindcss/typography                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │ JWT Token (Cognito access_token)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Bedrock AgentCore Runtime                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Strands Agent (BedrockAgentCoreApp + Docker ARM64)          │   │
│  │  - Claude Sonnet 4.5 (Cross-Region Inference)                │   │
│  │  - SSEストリーミング応答                                      │   │
│  │  - AgentCore Memory (短期記憶)                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                          │                                          │
│         ┌────────────────┼────────────────┐                        │
│         ▼                ▼                ▼                        │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐                  │
│  │ Tavily    │    │ Bedrock   │    │re-invent  │                  │
│  │ MCP       │    │ KB        │    │-2025-mcp  │                  │
│  │(リモート)  │    │(retrieve) │    │(stdio)    │                  │
│  └───────────┘    └───────────┘    └───────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│              CloudWatch GenAI Observability                          │
│  - トレース（エージェント実行フロー）                                 │
│  - メトリクス（レイテンシ、トークン使用量）                           │
└─────────────────────────────────────────────────────────────────────┘
```

## リージョン

すべて **us-west-2 (オレゴン)** に統一しています。

## 認証フロー

1. ユーザーがアプリにアクセスする
2. Amplify UI Authenticator でサインイン画面を表示する
3. メールとパスワードでサインインまたはサインアップする
4. Cognito から JWT (access_token) を取得する
5. `Authorization: Bearer <token>` を使って AgentCore Runtime の認証を行う

## ストリーミング処理

### バックエンド（convert_event関数）

Strands Agentsからのイベントをフロントエンド向けのJSON形式に変換します。

```python
def convert_event(event) -> dict | None:
    # Bedrock API形式: event.event.contentBlockDelta.delta.text
    if event.get('event'):
        inner_event = event.get('event')
        if inner_event.get('contentBlockDelta'):
            delta = inner_event['contentBlockDelta'].get('delta', {})
            if delta.get('text'):
                return {'type': 'text', 'data': delta['text']}
        if inner_event.get('contentBlockStart'):
            start = inner_event['contentBlockStart'].get('start', {})
            if start.get('toolUse'):
                return {'type': 'tool_use', 'tool_name': start['toolUse'].get('name')}
    return None
```

### フロントエンド（SSE処理）

```typescript
// イベントタイプに応じて処理
if (event.type === 'tool_use') {
  // ツール使用インジケーター表示
  const displayName = TOOL_DISPLAY_NAMES[event.tool_name] || event.tool_name
}
if (event.type === 'text' && event.data) {
  // テキストをバッファに追加
  currentBuffer += event.data
}
```

## 環境変数

### バックエンド（AgentCore環境変数）

| 変数名 | 説明 |
|--------|------|
| TAVILY_API_KEY | Tavily APIキー |
| KNOWLEDGE_BASE_ID | Bedrockナレッジベース ID |
| MEMORY_ID | AgentCore Memory ID |

### フロントエンド（.env.local）

| 変数名 | 説明 |
|--------|------|
| VITE_USER_POOL_ID | Cognito User Pool ID |
| VITE_USER_POOL_CLIENT_ID | Cognito App Client ID |
| VITE_AGENT_RUNTIME_ARN | AgentCore Runtime ARN |
| VITE_AWS_REGION | AWSリージョン |

## 実装状況

| コンポーネント | 状態 | 備考 |
|---------------|------|------|
| フロントエンド | ✅ 完了 | Vite + React + Tailwind CSS v4 |
| バックエンド | ✅ 完了 | Strands Agent + BedrockAgentCoreApp |
| Cognito認証 | ✅ 完了 | JWT認証（access_token） |
| ナレッジベース | ✅ 完了 | ID: RT8AH7FKCS |
| AgentCore Memory | ✅ 完了 | ID: reinvent2025-My6hDB5l3L |
| AgentCore Runtime | ✅ 完了 | ID: reinvent-S3AJ2uCrco |
| Amplify Hosting | ✅ 完了 | 自動デプロイ設定済み |
| ツール使用UX | 🔄 実装中 | ツール名表示対応中 |
