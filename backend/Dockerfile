# AgentCore Runtime用Dockerfile (ARM64必須)
FROM --platform=linux/arm64 ghcr.io/astral-sh/uv:python3.11-bookworm-slim

WORKDIR /app

# 依存関係をインストール
COPY pyproject.toml ./
RUN uv sync --frozen --no-cache || uv sync --no-cache

# アプリケーションコードをコピー
COPY main.py ./

# AgentCore Runtimeが使用するポート
EXPOSE 8080

# Observability用にopentelemetry-instrumentで起動
CMD ["opentelemetry-instrument", "uv", "run", "python", "main.py"]
