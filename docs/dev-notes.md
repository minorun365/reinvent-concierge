# 開発メモ

## ツール使用UX実装

### イベント形式

Strands Agents + BedrockAgentCoreApp から返されるイベントには2種類の形式がある。

1. Bedrock API形式（JSON）
```json
{"event": {"contentBlockDelta": {"delta": {"text": "回答テキスト..."}}}}
{"event": {"contentBlockStart": {"start": {"toolUse": {"name": "search_sessions"}}}}}
```

2. Strands内部形式（Pythonオブジェクトを含む）
```
"{'data': '...', 'agent': <strands.agent.agent.Agent object at 0x...>}"
```

### 解決策

バックエンドで `convert_event()` 関数を使い、フロントエンドが扱う形式に変換する。

入力: 上記のさまざまな形式のイベント
出力: `{type: 'text', data: '...'}` または `{type: 'tool_use', tool_name: '...'}`

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

Reference では `yield event` だけで動いているが、本プロジェクトでは Pythonオブジェクトがシリアライズできない問題があったため、変換関数を追加した。

---

## トラブルシューティング

### IAM Role Validation Error

```
ValidationException: Role validation failed for 'arn:aws:iam::xxx:role/...'
```

原因: `update-agent-runtime` で指定した `--role-arn` が実際のRuntimeと異なる。

解決: 現在のRuntime情報を取得し、正しいロールARNを確認する。

```bash
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id <runtime-id> \
  --region us-west-2 \
  --profile sandbox
```

### 認証エラー（403）

原因: `--authorizer-configuration` を省略してデプロイした。

解決: JWT認証設定を含めて再デプロイする。

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

v3の `@tailwind base;` 形式とは異なるので注意する。

---

## 現在のRuntime状況

- Runtime ID: reinvent-S3AJ2uCrco
- Version: v14（2024-11-28更新）
- Status: READY

---

## AgentCore Observability 設定

### 問題
CloudWatch GenAI Observability にトレースが表示されない。

### 原因
Dockerfileの `CMD` が単純な `python main.py` だったため、OpenTelemetry の自動インストルメンテーションが有効になっていなかった。

### 解決策

1. 必要なパッケージを pyproject.toml に追加する

```toml
dependencies = [
    "strands-agents[otel]>=0.1.0",      # Strands がトレースを生成
    "aws-opentelemetry-distro>=0.10.1", # トレースを CloudWatch に送信
]
```

2. Dockerfile で `opentelemetry-instrument` コマンドを使う

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

1. CloudWatch Transaction Search を有効化する（アカウントごとに1回）
   - CloudWatch コンソール → Application Signals → Transaction Search
   - 有効化から約10分でトレースが表示されるようになる

2. trace_attributes をエージェントに設定する（任意だが推奨）

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

- Agents View: エージェント一覧
- Sessions View: セッション一覧
- Traces View: トレース詳細（タイムライン、ツール呼び出し）

### 参考リンク

- [AgentCore Observability Get Started](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-get-started.html)
- [Strands Agents Observability](https://strandsagents.com/latest/documentation/docs/user-guide/observability-evaluation/observability/)

---

## Cognito認証UI カスタマイズ

### ログイン画面へのメッセージ追加

Amplify UI の `Authenticator` コンポーネントは、`components` prop でヘッダーとフッターをカスタマイズできる。

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

Amplify Hosting でデプロイしたアプリには、次のコマンドで環境変数を設定する。

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

設定後は**再デプロイが必要になる**。

### Amplify UI テーマカラーのカスタマイズ

デフォルトのコバルトブルーをバイオレット系に変更する。

```css
/* index.css */
[data-amplify-authenticator] {
  --amplify-colors-primary-10: #f5f3ff;
  --amplify-colors-primary-20: #ede9fe;
  --amplify-colors-primary-40: #c4b5fd;
  --amplify-colors-primary-60: #a78bfa;
  --amplify-colors-primary-80: #6d28d9;
  --amplify-colors-primary-90: #5b21b6;
  --amplify-colors-primary-100: #4c1d95;
  --amplify-components-button-primary-background-color: #6d28d9;
  --amplify-components-button-primary-hover-background-color: #5b21b6;
  --amplify-components-button-primary-focus-background-color: #5b21b6;
  --amplify-components-button-primary-active-background-color: #4c1d95;
  --amplify-components-button-link-color: #7c3aed;
  --amplify-components-button-link-hover-color: #6d28d9;
  --amplify-components-tabs-item-active-color: #6d28d9;
  --amplify-components-tabs-item-active-border-color: #6d28d9;
  --amplify-components-tabs-item-focus-color: #6d28d9;
  --amplify-components-tabs-item-hover-color: #7c3aed;
  --amplify-components-fieldcontrol-focus-border-color: #7c3aed;
}
```

設定時のポイントは次の通り。
- セレクタには `:root` より詳細度の高い `[data-amplify-authenticator]` を使う
- `--amplify-colors-primary-*` でベースカラーを定義する
- ボタン、タブ、入力フィールドの各コンポーネントの色も個別に設定する

参考: [Amplify UI CSS Variables](https://ui.docs.amplify.aws/react/theming/css-variables)

---

## iOS Safari 対応

### Dynamic Island / ノッチ対応

iPhone 14 Pro以降の Dynamic Island やノッチには、次の手順で対応する。

1. index.html に `viewport-fit=cover` を追加する

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

2. CSS で safe-area-inset を使う

```css
/* index.css */
@supports (padding: max(0px)) {
  .safe-area-top {
    padding-top: max(0.5rem, env(safe-area-inset-top));
  }
}
```

3. ヘッダー要素にクラスを適用する

```tsx
<div className="safe-area-top bg-violet-950 ...">
```

### オーバースクロール時の背景色

スマホで画面端をスワイプしたときに見える背景色を制御する。

```html
<!-- index.html -->
<body class="bg-violet-950">
```

これで上方向にオーバースクロールしたとき、ヘッダーと同じ色が見える。

---

## スピナーの実装

### CSSボーダースピナーの問題

```css
/* 一般的なCSSスピナー */
border-2 border-gray-400 border-t-transparent rounded-full animate-spin
```

この方法はスマホ、特にiOS Safariでいびつに見えることがある。

### SVGスピナー（推奨）

どのデバイスでも見た目を揃えるにはSVGを使う。

```tsx
<svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
</svg>
```

SVGを使う利点は次の通り。
- ベクター形式なのでどの解像度でもきれい
- 完全な円として描画される
- デバイス間で見た目が揃う

---

## Observability でユーザー情報を伝播

### baggage ヘッダーの使用

OpenTelemetry の `baggage` ヘッダーを使うと、フロントエンドからバックエンドへユーザー情報を伝播できる。

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

CloudWatch トレースで、どのユーザーがどのリクエストを発行したかを追跡できるようになる。

---

## Favicon設定

Viteプロジェクトでfaviconを設定する。

1. public フォルダに配置する

```bash
mkdir -p frontend/public
# 画像をfavicon.icoとして保存
magick input.png -resize 32x32 frontend/public/favicon.ico
```

2. index.html にリンクを追加する

```html
<link rel="icon" type="image/x-icon" href="/favicon.ico" />
