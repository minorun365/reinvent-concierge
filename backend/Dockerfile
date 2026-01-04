# CPUアーキテクチャとベースイメージを指定
FROM --platform=linux/arm64 ghcr.io/astral-sh/uv:python3.11-bookworm-slim

# 作業ディレクトリを指定
WORKDIR /app

# アプリのファイルをコピー
COPY pyproject.toml main.py ./

# 依存関係をインストール（opentelemetry-instrumentコマンドを使うため）
RUN uv sync

# ポートを公開
EXPOSE 8080

# アプリを起動
CMD ["uv", "run", "opentelemetry-instrument", "python", "-u", "main.py"]