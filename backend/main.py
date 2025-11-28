"""
re:Invent 2025 コンシェルジュ - バックエンド

Strands Agents + BedrockAgentCoreApp による AIエージェント。
AgentCore Runtime にデプロイして使用。
"""

import os
import boto3
import feedparser
from strands import Agent, tool
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from strands_tools import retrieve
from mcp import stdio_client, StdioServerParameters
from tavily import TavilyClient
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager

# AgentCoreランタイム用のAPIサーバーを作成
app = BedrockAgentCoreApp()

# 環境変数から設定を取得
AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "")
MEMORY_ID = os.environ.get("MEMORY_ID", "")

# モデルID（Claude Sonnet 4.5 Cross-Region Inference Profile）
MODEL_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

# システムプロンプト
SYSTEM_PROMPT = f"""あなたは AWS re:Invent 2025 のコンシェルジュです。
参加者からの質問に、日本語で端的に回答してください。

利用可能なツール：

1. retrieve - Bedrockナレッジベースから re:Invent 関連の情報を検索（knowledgeBaseId: {KNOWLEDGE_BASE_ID}）
2. re:Invent 2025 セッション検索ツール（search_sessions, get_session_details など）
3. tavily_search - Web検索で最新情報を取得
4. search_aws_updates - AWS What's New RSSフィードからキーワード検索（AWSの最新アップデート情報）

回答時のガイドライン：
- まず retrieve ツールで検索（knowledgeBaseIdは必ず "{KNOWLEDGE_BASE_ID}" を指定）
- セッションやキーノート、イベントの情報を聞かれたら、re:Inventセッション検索ツールを活用
- AWSサービスの最新アップデートや新機能の質問には search_aws_updates を使用
- 最新のニュースや公式サイトにない情報は tavily_search で検索
- 十分な情報が得られないときは、同じツールで別の検索をリトライしたり、複数のツール利用を試すなど試行錯誤してください
- 最終的に、なるべく簡潔で分かりやすい日本語で回答
"""


# Tavily Web検索ツール
@tool
def tavily_search(query: str) -> dict:
    """Web検索で最新情報を取得します。

    Args:
        query: 検索クエリ

    Returns:
        検索結果
    """
    if not TAVILY_API_KEY:
        return {"error": "TAVILY_API_KEY is not set"}
    tavily = TavilyClient(api_key=TAVILY_API_KEY)
    return tavily.search(query)


# AWS What's New 検索ツール
AWS_WHATS_NEW_RSS_URL = "https://aws.amazon.com/about-aws/whats-new/recent/feed/"


@tool
def search_aws_updates(keyword: str, max_results: int = 10) -> list:
    """AWS What's New RSSフィードからキーワード検索します。

    タイトルだけでなく、アップデート内容（summary）からもキーワードを検索します。

    Args:
        keyword: 検索キーワード（サービス名、機能名など）
        max_results: 取得する最大件数（デフォルト5件、最大10件）

    Returns:
        マッチしたアップデート情報のリスト（日付、タイトル、概要、リンク）
    """
    # 最大件数を制限
    max_results = min(max_results, 20)

    # RSSフィードをパース
    feed = feedparser.parse(AWS_WHATS_NEW_RSS_URL)

    if feed.bozo:
        return [{"error": "RSSフィードの取得に失敗しました"}]

    results = []
    keyword_lower = keyword.lower()

    for entry in feed.entries:
        title = entry.get("title", "")
        summary = entry.get("summary", "")

        # タイトルまたはサマリーにキーワードが含まれているかチェック
        if keyword_lower in title.lower() or keyword_lower in summary.lower():
            results.append({
                "published": entry.get("published", "N/A"),
                "title": title,
                "summary": summary[:300] + "..." if len(summary) > 300 else summary,
                "link": entry.get("link", "")
            })

            if len(results) >= max_results:
                break

    if not results:
        return [{"message": f"'{keyword}' に関するアップデートは見つかりませんでした"}]

    return results


def convert_event(event) -> dict | None:
    """Strandsのイベントをフロントエンド向けJSON形式に変換

    Bedrock API形式のみを処理し、重複を防ぐ。
    フロントエンドが期待する形式:
    - テキスト: {type: 'text', data: 'テキスト内容'}
    - ツール使用: {type: 'tool_use', tool_name: 'ツール名'}
    """
    try:
        if not hasattr(event, 'get'):
            return None

        # Bedrock API形式のみを処理（重複防止）
        inner_event = event.get('event')
        if not inner_event:
            return None

        # テキストデルタ
        content_block_delta = inner_event.get('contentBlockDelta')
        if content_block_delta:
            delta = content_block_delta.get('delta', {})
            text = delta.get('text')
            if text:
                return {'type': 'text', 'data': text}

        # ツール使用開始
        content_block_start = inner_event.get('contentBlockStart')
        if content_block_start:
            start = content_block_start.get('start', {})
            tool_use = start.get('toolUse')
            if tool_use:
                tool_name = tool_use.get('name', 'unknown')
                return {'type': 'tool_use', 'tool_name': tool_name}

        return None
    except Exception:
        return None


def create_session_manager(
    memory_id: str,
    session_id: str,
    actor_id: str,
    region: str = "us-west-2"
) -> AgentCoreMemorySessionManager:
    """AgentCore MemoryのSessionManagerを作成"""
    memory_config = AgentCoreMemoryConfig(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=actor_id
    )
    return AgentCoreMemorySessionManager(
        agentcore_memory_config=memory_config,
        region_name=region
    )


@app.entrypoint
async def invoke_agent(payload, context):
    """エージェント呼び出しエントリーポイント"""

    # ペイロードからパラメータを取得
    prompt = payload.get("prompt", "")
    session_id = payload.get("session_id", "default-session")

    # actor_id はCognitoのsubを使用（contextから取得可能な場合）
    actor_id = getattr(context, "user_id", "anonymous")

    # Boto3セッションを作成（リージョン指定）
    boto_session = boto3.Session(region_name=AWS_REGION)

    # BedrockModelを作成
    bedrock_model = BedrockModel(
        model_id=MODEL_ID,
        boto_session=boto_session
    )

    # Pythonツールリストを作成
    tools = []

    # 1. Bedrockナレッジベース（retrieve）
    tools.append(retrieve)

    # 2. Tavily Web検索（@toolで定義）
    tools.append(tavily_search)

    # 3. AWS What's New 検索（@toolで定義）
    tools.append(search_aws_updates)

    # 4. re-invent-2025-mcp（セッション情報） - MCPクライアント
    reinvent_mcp = MCPClient(
        lambda: stdio_client(StdioServerParameters(
            command="uvx",
            args=["re-invent-2025-mcp"],
            env=os.environ.copy()
        ))
    )

    # SessionManager作成（Memory IDが設定されている場合のみ）
    session_manager = None
    if MEMORY_ID:
        session_manager = create_session_manager(
            memory_id=MEMORY_ID,
            session_id=session_id,
            actor_id=actor_id,
            region=AWS_REGION
        )

    # trace_attributes（Observability用）
    trace_attributes = {
        "session.id": session_id,
        "actor.id": actor_id,
        "region": AWS_REGION,
    }
    if MEMORY_ID:
        trace_attributes["memory.id"] = MEMORY_ID

    # MCPクライアントを起動してエージェントを実行
    with reinvent_mcp:
        # MCPツールを取得
        mcp_tools = reinvent_mcp.list_tools_sync()
        all_tools = tools + mcp_tools

        agent = Agent(
            model=bedrock_model,
            system_prompt=SYSTEM_PROMPT,
            tools=all_tools,
            session_manager=session_manager,
            trace_attributes=trace_attributes
        )

        try:
            # ストリーミングで応答を取得
            async for event in agent.stream_async(prompt):
                converted = convert_event(event)
                if converted:
                    yield converted
        finally:
            # 明示的にクリーンアップ
            agent.cleanup()


# APIサーバーを起動
app.run()
