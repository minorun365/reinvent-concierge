# AgentCore Runtime用Dockerfile (ARM64必須)
FROM --platform=linux/arm64 ghcr.io/astral-sh/uv:python3.11-bookworm-slim

WORKDIR /app

# アプリケーションファイルをコピー
COPY pyproject.toml main.py ./

# AgentCore Runtimeが使用するポート
EXPOSE 8080

# uv runで直接実行（依存関係は自動インストール）
CMD ["uv", "run", "python", "main.py"]
