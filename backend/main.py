"""
re:Invent 2025 コンシェルジュ - バックエンド

Strands Agents + BedrockAgentCoreApp による AIエージェント。
AgentCore Runtime にデプロイして使用。
"""

import os
import boto3
from strands import Agent
from strands.models import BedrockModel
from strands.tools import retrieve
from strands.tools.mcp.mcp_client import MCPClient
from mcp.client.streamable_http import streamablehttp_client
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager

# AgentCoreランタイム用のAPIサーバーを作成
app = BedrockAgentCoreApp()

# 環境変数から設定を取得
AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "RT8AH7FKCS")
MEMORY_ID = os.environ.get("MEMORY_ID", "reinvent2025-My6hDB5l3L")  # 後でみのるんが作成後に設定

# モデルID（Claude Haiku 4.5 Cross-Region Inference Profile）
MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

# システムプロンプト
SYSTEM_PROMPT = """あなたは AWS re:Invent 2025 のコンシェルジュです。
参加者からの質問に親切に日本語で回答してください。

利用可能なツール：
1. retrieve - Bedrockナレッジベースから re:Invent 関連の情報を検索
2. tavily_search - Web検索で最新情報を取得
3. search_sessions, get_session_details, search_speakers - re:Invent 2025のセッション・スピーカー情報を検索

回答時のガイドライン：
- セッション情報を聞かれたら、まず search_sessions や get_session_details を使用
- 一般的な re:Invent 情報は retrieve ツールで検索
- 最新のニュースや公式サイトにない情報は tavily_search で検索
- 簡潔で分かりやすい日本語で回答
- セッション情報には、タイトル、日時、会場、レベルを含める
"""


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
    if KNOWLEDGE_BASE_ID:
        tools.append(retrieve(knowledge_base_id=KNOWLEDGE_BASE_ID))

    # MCPクライアントのリスト（複数MCPを統合）
    mcp_clients = []

    # 2. Tavily MCP（Web検索）
    if TAVILY_API_KEY:
        tavily_mcp = MCPClient(lambda: streamablehttp_client(
            f"https://mcp.tavily.com/mcp/?tavilyApiKey={TAVILY_API_KEY}"
        ))
        mcp_clients.append(tavily_mcp)

    # 3. re-invent-2025-mcp（セッション情報）
    # ローカルMCPとしてインストール済みの場合
    try:
        from mcp.client.stdio import stdio_client
        import shutil

        # uvx がインストールされているか確認
        uvx_path = shutil.which("uvx")
        if uvx_path:
            reinvent_mcp = MCPClient(lambda: stdio_client(
                "uvx",
                ["re-invent-2025-mcp"]
            ))
            mcp_clients.append(reinvent_mcp)
    except ImportError:
        pass  # stdio_client がない場合はスキップ

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
                yield event
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
            yield event


# APIサーバーを起動
app.run()