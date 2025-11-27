"""
re:Invent 2025 コンシェルジュ - バックエンド

Strands Agents + BedrockAgentCoreApp による AIエージェント。
AgentCore Runtime にデプロイして使用。
"""

import os
import boto3
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from strands_tools import retrieve
from mcp.client.streamable_http import streamablehttp_client
from mcp import stdio_client, StdioServerParameters
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
2. search_sessions, get_session_details, search_speakers - re:Invent 2025のセッション・スピーカー情報を検索
3. tavily_search, tavily_extract - Web検索で最新情報を取得・抽出

回答時のガイドライン：
- まず retrieve ツールで検索（knowledgeBaseIdは必ず "{KNOWLEDGE_BASE_ID}" を指定）
- セッションやキーノート、イベントの情報を聞かれたら、 search_sessions や get_session_details を使用
- 最新のニュースや公式サイトにない情報は tavily_search で検索
- 十分な情報が得られないときは、同じツールで別の検索をリトライしたり、複数のツール利用を試すなど試行錯誤してください
- retrieveツールで見つけた脚注URLが有用な場合、tavily_extractで内容を確認するなどの工夫もできます
- 最終的に、なるべく簡潔で分かりやすい日本語で回答
"""


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

    # ツールリストを作成
    tools = []

    # 1. Bedrockナレッジベース（retrieve）
    # retrieveはツールとしてそのまま渡し、knowledgeBaseIdはエージェント呼び出し時に指定
    tools.append(retrieve)

    # MCPクライアントのリスト（複数MCPを統合）
    mcp_clients = []

    # 2. Tavily MCP（Web検索）
    if TAVILY_API_KEY:
        tavily_mcp = MCPClient(lambda: streamablehttp_client(
            f"https://mcp.tavily.com/mcp/?tavilyApiKey={TAVILY_API_KEY}"
        ))
        mcp_clients.append(tavily_mcp)

    # 3. re-invent-2025-mcp（セッション情報）
    # StdioServerParametersを使ってuvx経由で起動
    reinvent_mcp = MCPClient(lambda: stdio_client(StdioServerParameters(
        command="uvx",
        args=["re-invent-2025-mcp"],
        env=os.environ.copy()
    )))
    mcp_clients.append(reinvent_mcp)

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
    if mcp_clients:
        # 複数のMCPクライアントをコンテキストマネージャーで管理
        # 簡略化のため、最初のMCPのみ使用（本番では複数統合を検討）
        with mcp_clients[0] as mcp:
            # MCPツールを追加
            mcp_tools = mcp.list_tools_sync()
            all_tools = tools + mcp_tools

            # エージェント作成
            agent = Agent(
                model=bedrock_model,
                system_prompt=SYSTEM_PROMPT,
                tools=all_tools,
                session_manager=session_manager,
                trace_attributes=trace_attributes
            )

            # ストリーミングで応答を取得
            async for event in agent.stream_async(prompt):
                converted = convert_event(event)
                if converted:
                    yield converted
    else:
        # MCPなしの場合
        agent = Agent(
            model=bedrock_model,
            system_prompt=SYSTEM_PROMPT,
            tools=tools,
            session_manager=session_manager,
            trace_attributes=trace_attributes
        )

        async for event in agent.stream_async(prompt):
            converted = convert_event(event)
            if converted:
                yield converted


# APIサーバーを起動
app.run()