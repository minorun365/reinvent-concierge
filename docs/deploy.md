# デプロイ手順書

このドキュメントでは、re:Inventコンシェルジュのデプロイ手順を説明します。

## 前提条件

- AWS SSO ログイン済み
- Docker Desktop インストール済み
- Node.js 20+ インストール済み
- uv インストール済み

```bash
aws sso login --profile=sandbox
```

---

## Step 1: ECRリポジトリ作成 & Dockerイメージプッシュ

### 1.1 ECRリポジトリ作成（初回のみ）

```bash
aws ecr create-repository \
  --repository-name reinvent-concierge \
  --region us-west-2 \
  --profile sandbox
```

### 1.2 ECRログイン

```bash
aws ecr get-login-password --region us-west-2 --profile sandbox | \
  docker login --username AWS --password-stdin \
  715841358122.dkr.ecr.us-west-2.amazonaws.com
```

### 1.3 Dockerイメージビルド & プッシュ

```bash
cd /Users/mi-onda/git/minorun365/reinvent-concierge

# ARM64でビルド & プッシュ
docker buildx build \
  --platform linux/arm64 \
  -t 715841358122.dkr.ecr.us-west-2.amazonaws.com/reinvent-concierge:latest \
  -f backend/Dockerfile \
  backend/ \
  --push
```

---

## Step 2: AgentCore Memory 作成（みのるんが実施）

AWSコンソールで AgentCore Memory を作成：

1. Amazon Bedrock コンソール → AgentCore → Memory
2. 「Create memory」をクリック
3. 設定：
   - Name: `ReinventConciergeMemory`
   - Description: `re:Inventコンシェルジュの会話履歴`
4. 作成後、Memory ID をメモ → `docs/credentials.md` に記録

---

## Step 3: AgentCore Runtime 作成（みのるんが実施）

### 3.1 Runtime 作成

AWSコンソールで AgentCore Runtime を作成：

1. Amazon Bedrock コンソール → AgentCore → Runtimes
2. 「Create runtime」をクリック
3. 設定：
   - Name: `reinvent-concierge-runtime`
   - Container Image: `715841358122.dkr.ecr.us-west-2.amazonaws.com/reinvent-concierge:latest`
   - 環境変数:
     - `TAVILY_API_KEY`: <your-tavily-api-key>
     - `KNOWLEDGE_BASE_ID`: <your-knowledge-base-id>
     - `MEMORY_ID`: （Step 2で作成したMemory ID）
4. 作成後、Runtime ID をメモ → `docs/credentials.md` に記録

### 3.2 認証設定（Cognito JWT）

Amplifyデプロイ後に Cognito 情報を取得してから設定：

```bash
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id <runtime-id> \
  --agent-runtime-artifact containerConfiguration={containerUri=715841358122.dkr.ecr.us-west-2.amazonaws.com/reinvent-concierge:latest} \
  --authorizer-configuration '{
    "customJWTAuthorizer": {
      "discoveryUrl": "https://cognito-idp.us-west-2.amazonaws.com/<user-pool-id>/.well-known/openid-configuration",
      "allowedClients": ["<app-client-id>"]
    }
  }' \
  --region us-west-2 \
  --profile sandbox
```

---

## Step 4: Amplify フロントエンドデプロイ

### 4.1 Amplify プロジェクト初期化

```bash
cd frontend

# Amplify CLI インストール（まだの場合）
npm install -g @aws-amplify/cli

# Amplify プロジェクト初期化
amplify init
```

### 4.2 認証（Cognito）追加

```bash
amplify add auth

# 設定:
# - Default configuration
# - Email でサインイン
# - No advanced settings
```

### 4.3 デプロイ

```bash
amplify push
```

### 4.4 Cognito 情報の確認

デプロイ後、`amplify_outputs.json` から以下を確認：

- User Pool ID
- App Client ID

これらを `docs/credentials.md` に記録し、Step 3.2 の認証設定を実行。

---

## Step 5: フロントエンド環境変数設定

### 5.1 .env.local 作成

```bash
cd frontend

cat > .env.local << 'EOF'
VITE_USER_POOL_ID=<user-pool-id>
VITE_USER_POOL_CLIENT_ID=<app-client-id>
VITE_API_URL=<agentcore-runtime-endpoint>
EOF
```

### 5.2 ローカル動作確認

```bash
npm run dev
```

---

## Step 6: Amplify Hosting デプロイ

### 6.1 GitHub 連携

1. Amplify コンソール → 「Host web app」
2. GitHub を選択
3. リポジトリ: `minorun365/reinvent-concierge`
4. ブランチ: `main`

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

Amplifyコンソールで環境変数を設定：

- `VITE_USER_POOL_ID`: <user-pool-id>
- `VITE_USER_POOL_CLIENT_ID`: <app-client-id>
- `VITE_API_URL`: <agentcore-runtime-endpoint>

---

## Step 7: カスタムドメイン設定（オプション）

1. Amplify コンソール → ドメイン管理
2. `reinvent.minoruonda.com` を追加
3. Route 53 で CNAME レコードを設定

---

## トラブルシューティング

### Docker ビルドが失敗する

```bash
# Docker Desktop が起動しているか確認
docker info

# ビルドキャッシュをクリア
docker buildx prune -f
```

### ECR push が失敗する

```bash
# 再ログイン
aws ecr get-login-password --region us-west-2 --profile sandbox | \
  docker login --username AWS --password-stdin \
  715841358122.dkr.ecr.us-west-2.amazonaws.com
```

### AgentCore Runtime が FAILED になる

1. CloudWatch Logs でエラーを確認
2. ECRイメージのアーキテクチャが ARM64 か確認
3. 必要なIAMロールが付与されているか確認

### 認証エラー（403）

`--authorizer-configuration` を指定せずにデプロイした場合に発生。
Step 3.2 の認証設定を再実行。

---

## 更新時のデプロイ

### バックエンド更新

```bash
# 1. ECRログイン
aws ecr get-login-password --region us-west-2 --profile sandbox | \
  docker login --username AWS --password-stdin \
  715841358122.dkr.ecr.us-west-2.amazonaws.com

# 2. ビルド & プッシュ
docker buildx build \
  --platform linux/arm64 \
  -t 715841358122.dkr.ecr.us-west-2.amazonaws.com/reinvent-concierge:latest \
  -f backend/Dockerfile \
  backend/ \
  --push

# 3. AgentCore Runtime 更新
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id <runtime-id> \
  --agent-runtime-artifact containerConfiguration={containerUri=715841358122.dkr.ecr.us-west-2.amazonaws.com/reinvent-concierge:latest} \
  --region us-west-2 \
  --profile sandbox
```

### フロントエンド更新

```bash
# Git push で自動デプロイ（Amplify Hosting）
git add .
git commit -m "Update frontend"
git push origin main
```
