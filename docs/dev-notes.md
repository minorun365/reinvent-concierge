# 開発メモ

## ツール使用UX実装

### イベント形式

Strands Agents + BedrockAgentCoreApp から返されるイベントには2種類の形式がある：

**1. Bedrock API形式（JSON）**
```json
{"event": {"contentBlockDelta": {"delta": {"text": "回答テキスト..."}}}}
{"event": {"contentBlockStart": {"start": {"toolUse": {"name": "search_sessions"}}}}}
```

**2. Strands内部形式（Pythonオブジェクト含む）**
```
"{'data': '...', 'agent': <strands.agent.agent.Agent object at 0x...>}"
```

### 解決策

バックエンドで `convert_event()` 関数を使い、フロントエンドが期待する形式に変換：

**入力**: 上記の様々な形式のイベント
**出力**: `{type: 'text', data: '...'}` または `{type: 'tool_use', tool_name: '...'}`

### ツール名マッピング（フロントエンド）

```typescript
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  retrieve: 'みのるんナレッジベース検索',
  tavily_search: 'Web検索',
  search_sessions: 'セッション検索',
  get_session_details: 'セッション詳細取得',
  search_speakers: 'スピーカー検索',
}
```

---

## Reference実装との比較

`/reference/frontend/` に参考実装がある。

| 項目 | Reference | 本プロジェクト |
|------|-----------|---------------|
| バックエンド | `yield event` のみ | `convert_event()` で変換 |
| 認証方式 | IAM署名（Lambda） | JWT（AgentCore Runtime） |
| フレームワーク | Next.js | Vite + React |

Reference では `yield event` だけで動作しているが、本プロジェクトでは Pythonオブジェクトがシリアライズできない問題があったため、変換関数を追加。

---

## トラブルシューティング

### IAM Role Validation Error

```
ValidationException: Role validation failed for 'arn:aws:iam::xxx:role/...'
```

**原因**: `update-agent-runtime` で指定した `--role-arn` が実際のRuntimeと異なる

**解決**: 現在のRuntime情報を取得して正しいロールARNを確認

```bash
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id <runtime-id> \
  --region us-west-2 \
  --profile sandbox
```

### 認証エラー（403）

**原因**: `--authorizer-configuration` を省略してデプロイした

**解決**: JWT認証設定を含めて再デプロイ

```bash
aws bedrock-agentcore-control update-agent-runtime \
  --authorizer-configuration '{"customJWTAuthorizer":{...}}'
```

### Tailwind CSS v4 の Typography プラグイン

```css
/* index.css */
@import "tailwindcss";
@plugin "@tailwindcss/typography";
```

v3の `@tailwind base;` 形式とは異なるので注意。

---

## 現在のRuntime状況

- **Runtime ID**: reinvent-S3AJ2uCrco
- **Version**: v11（2024-11-28更新）
- **Status**: UPDATING → READY（数分で完了）
