# 参考コード分析

`reference/` ディレクトリにある参考コードの詳細分析。

## ディレクトリ構成

```
reference/
├── DEPLOY.md           # AgentCoreデプロイ手順
├── o11y.md             # Observability設定ガイド
├── app/
│   ├── layout.tsx      # Next.js ルートレイアウト
│   └── page.tsx        # メインページ（認証+チャット）
└── components/
    ├── ChatInterface.tsx      # チャットUI
    └── ConfigureAmplify.tsx   # Amplify初期化
```

---

## 1. DEPLOY.md の要点

### デプロイフロー（5ステップ）

```bash
# 1. AWS SSO ログイン
aws sso login --profile sandbox

# 2. ECR ログイン
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# 3. Docker イメージのビルド＆プッシュ（ARM64必須）
docker buildx build --platform linux/arm64 -t <ecr-uri>:latest --push .

# 4. AgentCore Runtime 更新（--authorizer-configuration必須！）
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id <runtime-id> \
  --agent-runtime-artifact containerConfiguration={containerUri=<ecr-uri>} \
  --authorizer-configuration '{
    "customJWTAuthorizer": {
      "discoveryUrl": "https://cognito-idp.<region>.amazonaws.com/<user-pool-id>/.well-known/openid-configuration",
      "allowedClients": ["<app-client-id>"]
    }
  }'

# 5. デプロイ完了確認
aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id <runtime-id>
```

### 重要な注意点

- **--authorizer-configuration を省略すると、認証タイプがIAM許可に戻ってしまう**
- プロジェクトルートからDockerビルドを実行すること

---

## 2. o11y.md の要点

### Observabilityで確認できる情報

| カテゴリ | 具体例 |
|--------|------|
| トレース | エージェント実行フロー全体、LLM呼び出し、ツール実行 |
| メトリクス | レイテンシ、トークン使用量、エラー率 |
| ログ | 詳細な実行ログ |
| カスタム属性 | session.id, actor.id, gateway.url, memory.id, region |

### セットアップ手順

1. **CloudWatch Transaction Search 有効化**（AWS アカウント 1回のみ）
   - CloudWatch > Application Signals > Transaction Search > Enable

2. **依存パッケージ**
   ```
   bedrock-agentcore[strands-agents]
   strands-agents[otel]
   aws-opentelemetry-distro
   mcp
   ```

3. **trace_attributes設定**
   ```python
   agent = Agent(
       model="us.anthropic.claude-sonnet-4-5-20250929-v1:0",
       trace_attributes={
           "session.id": session_id,
           "actor.id": actor_id,
       }
   )
   ```

4. **Dockerでの起動コマンド**
   ```dockerfile
   CMD ["opentelemetry-instrument", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
   ```

---

## 3. page.tsx の要点

### Cognito認証 + 日本語翻訳

```tsx
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { I18n } from 'aws-amplify/utils';

// 日本語翻訳を設定
I18n.setLanguage('ja');
I18n.putVocabularies({
  ja: {
    'Sign In': 'サインイン',
    'Sign Up': 'アカウント作成',
    'Email': 'メールアドレス',
    'Password': 'パスワード',
    'Confirm Password': 'パスワード（確認）',
    'Create Account': 'アカウント作成',
    'Forgot your password?': 'パスワードをお忘れですか？',
    // ... その他の翻訳
  }
});
```

### カスタム同意文（SignUpヘッダー）

```tsx
<Authenticator
  components={{
    SignUp: {
      Header() {
        return (
          <div className="max-w-md mx-auto px-4 mb-2">
            <p className="text-sm text-gray-700 mb-2">
              アカウントを作成すれば、誰でもこのアプリを利用できます。
            </p>
            <p className="text-xs text-gray-600 bg-gray-50 p-3 rounded-md border border-gray-200 mb-1">
              登録されたメールアドレスは、アプリ利用時の認証のためだけに利用されます。
              本アプリの開発者（みのるん）以外にメールアドレスが知られることはありません。
              また、宣伝などの目的外利用もされません。
            </p>
          </div>
        );
      },
    },
  }}
>
```

### ヘッダー構成（サインアウトボタン）

```tsx
{user && (
  <div className="flex flex-col items-end gap-2">
    <button onClick={signOut} className="...">
      サインアウト
    </button>
  </div>
)}
```

**注意**: project.mdの要件では「ユーザーのメールアドレスは表示しない」

---

## 4. ChatInterface.tsx の要点

### SSEストリーミング処理

```tsx
const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (!line.trim() || !line.startsWith('data: ')) continue;
    const event = JSON.parse(line.slice(6)); // "data: " を除去

    if (event.type === 'tool_use') {
      // ツール使用インジケーター表示
    } else if (event.type === 'text') {
      // テキストをバッファに追加
    }
  }
}
```

### ツール使用インジケーター

```tsx
{message.isToolUsing && (
  <div className={`flex items-center gap-2 text-sm ${message.toolCompleted ? 'text-green-600' : 'text-blue-600'}`}>
    {message.toolCompleted ? (
      <span className="inline-block w-4 h-4">✓</span>
    ) : (
      <span className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></span>
    )}
    🔍 Tavily検索ツール{message.toolCompleted ? 'を利用しました' : 'を利用しています'}
  </div>
)}
```

### 思考中スピナー

```tsx
{message.role === 'assistant' && !message.content && !message.isToolUsing && (
  <div className="flex items-center gap-2 text-gray-600 text-sm">
    <span className="inline-block w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></span>
    思考中...
  </div>
)}
```

### メッセージタイプ定義

```tsx
interface Message {
  role: 'user' | 'assistant';
  content: string;
  isToolUsing?: boolean;
  toolCompleted?: boolean;
}
```

### Markdown レンダリング（react-markdown）

```tsx
import ReactMarkdown from 'react-markdown';

<ReactMarkdown
  components={{
    a: ({ ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
    code: ({ className, children, ...props }) => {
      const isInline = !className;
      return isInline ? (
        <code {...props} className="bg-gray-100 px-1 py-0.5 rounded">{children}</code>
      ) : (
        <code {...props} className="block bg-gray-100 p-2 rounded overflow-x-auto">{children}</code>
      );
    },
  }}
>
  {message.content}
</ReactMarkdown>
```

---

## 5. ConfigureAmplify.tsx の要点

```tsx
'use client';

import { Amplify } from 'aws-amplify';
import outputs from '@/amplify_outputs.json';

Amplify.configure(outputs, {
  ssr: true, // Next.js App Router でのSSR対応
});

export default function ConfigureAmplify({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

---

## 6. 参考コードとの相違点（今回の実装）

| 項目 | 参考コード | 今回の実装 |
|------|------------|------------|
| フレームワーク | Next.js (App Router) | Vite + React |
| 認証方式 | IAM署名（Lambda Function URL） | JWT OAuth（AgentCore Runtime） |
| バックエンド | Lambda Function URL | AgentCore Runtime |
| リージョン | us-east-1 / us-west-2 混在 | us-west-2 統一 |
| ツール表示 | Tavily検索のみ | 3種類のMCPツール |

---

## 7. 使用するnpmパッケージ（フロントエンド）

```json
{
  "dependencies": {
    "react": "^18",
    "react-dom": "^18",
    "aws-amplify": "^6",
    "@aws-amplify/ui-react": "^6",
    "react-markdown": "^9"
  },
  "devDependencies": {
    "vite": "^5",
    "@vitejs/plugin-react": "^4",
    "typescript": "^5",
    "tailwindcss": "^3",
    "autoprefixer": "^10",
    "postcss": "^8"
  }
}
```

---

## 8. 使用するPythonパッケージ（バックエンド）

```
strands-agents[otel]
bedrock-agentcore[strands-agents]
aws-opentelemetry-distro
mcp
re-invent-2025-mcp
```