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
- **Version**: v14（2024-11-28更新）
- **Status**: READY

---

## AgentCore Observability 設定

### 問題
CloudWatch GenAI Observability にトレースが表示されない。

### 原因
Dockerfileの `CMD` が単純な `python main.py` だったため、OpenTelemetry の自動インストルメンテーションが有効になっていなかった。

### 解決策

**1. 必要なパッケージを pyproject.toml に追加**

```toml
dependencies = [
    "strands-agents[otel]>=0.1.0",      # Strands がトレースを生成
    "aws-opentelemetry-distro>=0.10.1", # トレースを CloudWatch に送信
]
```

**2. Dockerfile で `opentelemetry-instrument` コマンドを使用**

```dockerfile
# 変更前
CMD ["uv", "run", "python", "main.py"]

# 変更後
RUN uv sync
CMD ["uv", "run", "opentelemetry-instrument", "python", "-u", "main.py"]
```

### opentelemetry-instrument が自動で行うこと

- OTEL 設定の読み込み
- Strands、Bedrock 呼び出し、ツール実行の自動インストルメント
- CloudWatch へのトレース送信

### 前提条件

1. **CloudWatch Transaction Search を有効化**（アカウントごとに1回）
   - CloudWatch コンソール → Application Signals → Transaction Search
   - 有効化後、約10分でトレースが表示可能に

2. **trace_attributes をエージェントに設定**（任意だが推奨）

```python
agent = Agent(
    model=bedrock_model,
    trace_attributes={
        "session.id": session_id,
        "actor.id": actor_id,
        "region": AWS_REGION,
    }
)
```

### 確認方法

CloudWatch コンソール → GenAI Observability → Bedrock AgentCore タブ

- **Agents View**: エージェント一覧
- **Sessions View**: セッション一覧
- **Traces View**: トレース詳細（タイムライン、ツール呼び出し）

### 参考リンク

- [AgentCore Observability Get Started](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-get-started.html)
- [Strands Agents Observability](https://strandsagents.com/latest/documentation/docs/user-guide/observability-evaluation/observability/)

---

## Cognito認証UI カスタマイズ

### ログイン画面へのメッセージ追加

Amplify UI の `Authenticator` コンポーネントは `components` prop でヘッダー・フッターをカスタマイズできる：

```tsx
<Authenticator
  components={{
    Header() {
      return (
        <div className="text-center py-4">
          <h1>タイトル</h1>
          <p>サブタイトル</p>
        </div>
      )
    },
    Footer() {
      return (
        <p>メールアドレスの利用目的など...</p>
      )
    },
  }}
>
```

### Amplify環境変数の設定

Amplify Hosting でデプロイしたアプリに環境変数を設定するには：

```bash
aws amplify update-app \
  --app-id <app-id> \
  --environment-variables \
    VITE_USER_POOL_ID=<user-pool-id>,\
    VITE_USER_POOL_CLIENT_ID=<client-id>,\
    VITE_AGENT_RUNTIME_ARN=<arn>,\
    VITE_AWS_REGION=us-west-2 \
  --region us-west-2 --profile sandbox
```

設定後、再デプロイが必要。

### Amplify UI テーマカラーのカスタマイズ（試行錯誤中）

デフォルトのコバルトブルーをバイオレット系に変更する試み：

```css
/* index.css */
[data-amplify-authenticator] {
  --amplify-colors-primary-80: #6d28d9;
  --amplify-components-button-primary-background-color: #6d28d9;
  --amplify-components-button-primary-hover-background-color: #5b21b6;
  /* ... */
}
```

**現状**: CSS変数を設定しても反映されない場合がある。
**調査中**: セレクタの詳細度、Tailwind CSSとの競合、または変数名の違いの可能性。

参考: [Amplify UI CSS Variables](https://ui.docs.amplify.aws/react/theming/css-variables)

---

## iOS Safari 対応

### Dynamic Island / ノッチ対応

iPhone 14 Pro以降の Dynamic Island やノッチに対応するには：

**1. index.html に `viewport-fit=cover` を追加**

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

**2. CSS で safe-area-inset を使用**

```css
/* index.css */
@supports (padding: max(0px)) {
  .safe-area-top {
    padding-top: max(0.5rem, env(safe-area-inset-top));
  }
}
```

**3. ヘッダー要素にクラスを適用**

```tsx
<div className="safe-area-top bg-violet-950 ...">
```

### オーバースクロール時の背景色

スマホで画面端をスワイプした時に見える背景色を制御：

```html
<!-- index.html -->
<body class="bg-violet-950">
```

これで上方向にオーバースクロールした時、ヘッダーと同じ色が見える。

---

## スピナーの実装

### CSSボーダースピナーの問題

```css
/* 一般的なCSSスピナー */
border-2 border-gray-400 border-t-transparent rounded-full animate-spin
```

この方法はスマホ（特にiOS Safari）でいびつに見えることがある。

### SVGスピナー（推奨）

デバイス間で一貫した見た目を得るにはSVGを使用：

```tsx
<svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
</svg>
```

**利点**:
- ベクター形式なのでどの解像度でも綺麗
- 完全な円として描画される
- デバイス間で一貫した見た目

---

## Observability でユーザー情報を伝播

### baggage ヘッダーの使用

OpenTelemetry の `baggage` ヘッダーを使用して、フロントエンドからバックエンドにユーザー情報を伝播できる：

```tsx
// ChatInterface.tsx
const baggageItems: string[] = []
if (userEmail) {
  baggageItems.push(`userEmail=${encodeURIComponent(userEmail)}`)
}
baggageItems.push(`sessionId=${sessionId}`)

fetch(url, {
  headers: {
    'baggage': baggageItems.join(','),
  },
})
```

これにより、CloudWatch トレースでどのユーザーがどのリクエストを発行したか追跡可能。

---

## Favicon設定

Viteプロジェクトでfaviconを設定：

**1. public フォルダに配置**

```bash
mkdir -p frontend/public
# 画像をfavicon.icoとして保存
magick input.png -resize 32x32 frontend/public/favicon.ico
```

**2. index.html にリンクを追加**

```html
<link rel="icon" type="image/x-icon" href="/favicon.ico" />
