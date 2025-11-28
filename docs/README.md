# reInventエージェント

AWS re:Invent 2025 に関する質問に答える AI エージェント・チャットボット

[reinvent.minoruonda.com](https://reinvent.minoruonda.com/)

## 概要

期間限定のデモアプリとして開発。参加者が re:Invent 2025 のセッション情報や会場情報などを気軽に質問できる。

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | Vite + React + TypeScript + Tailwind CSS v4 |
| ホスティング | AWS Amplify Hosting |
| 認証 | Amazon Cognito（JWT認証） |
| バックエンド | Strands Agents + BedrockAgentCoreApp |
| ランタイム | Amazon Bedrock AgentCore Runtime |
| LLM | Claude Sonnet 4.5（Cross-Region Inference） |
| 会話履歴 | AgentCore Memory（短期記憶） |
| 監視 | CloudWatch GenAI Observability |

### 利用ツール（MCP）

1. **retrieve** - Bedrock ナレッジベース検索（re:Invent 公式情報）
2. **Tavily MCP** - Web検索（最新ニュース）
3. **re-invent-2025-mcp** - セッション・スピーカー情報検索

## ドキュメント一覧

| ファイル | 内容 |
|----------|------|
| [architecture.md](./architecture.md) | アーキテクチャ設計・構成図 |
| [deploy.md](./deploy.md) | デプロイ手順（ECR、AgentCore Runtime、Amplify） |
| [credentials.md](./credentials.md) | 認証情報・環境変数（gitignore済み） |
| [dev-notes.md](./dev-notes.md) | 開発メモ・トラブルシューティング |
| [strands-agentcore-guide.md](./strands-agentcore-guide.md) | Strands + AgentCore 技術ガイド |

## ディレクトリ構成

```
reinvent-concierge/
├── frontend/                # フロントエンド（Vite + React）
│   ├── src/
│   │   ├── App.tsx         # Cognito認証統合
│   │   └── components/
│   │       └── ChatInterface.tsx  # チャットUI
│   └── package.json
├── backend/                 # バックエンド（Strands Agent）
│   ├── main.py             # BedrockAgentCoreApp
│   ├── pyproject.toml
│   └── Dockerfile          # ARM64ビルド
├── docs/                    # ドキュメント
└── reference/               # 参考コード（gitignore済み）
```

## クイックスタート

### ローカル開発

```bash
# AWS SSO ログイン
aws sso login --profile=sandbox

# フロントエンド起動
cd frontend
npm install
npm run dev
```

### デプロイ

```bash
# バックエンド更新
cd backend
docker build --platform linux/arm64 -t reinvent-concierge:latest .
# → ECRプッシュ → AgentCore Runtime更新
# 詳細は docs/deploy.md を参照

# フロントエンド更新
git push origin main  # Amplify Hostingで自動デプロイ
```

## URL

- **本番**: https://d84l1y8p4kdic.cloudfront.net
- **GitHub**: https://github.com/minorun365/reinvent-concierge (private)

## 開発者

みのるん（[@minorun365](https://github.com/minorun365)）
