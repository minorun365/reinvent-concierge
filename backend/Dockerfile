# AgentCore Runtime用Dockerfile (ARM64必須)
FROM --platform=linux/arm64 ghcr.io/astral-sh/uv:python3.11-bookworm-slim

WORKDIR /app

# アプリケーションファイルをコピー
COPY pyproject.toml main.py ./

# 依存関係をインストール（opentelemetry-instrumentコマンドを使うため）
RUN uv sync

# AgentCore Runtimeが使用するポート
EXPOSE 8080

# opentelemetry-instrument経由で実行（Observability有効化）
CMD ["uv", "run", "opentelemetry-instrument", "python", "-u", "main.py"]
