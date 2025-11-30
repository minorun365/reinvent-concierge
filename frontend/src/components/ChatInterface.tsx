import { useState, useRef, useEffect, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isToolUsing?: boolean
  toolCompleted?: boolean
  toolName?: string
}

interface ChatInterfaceProps {
  sessionId: string
  accessToken: string
  userEmail?: string
}

// ツール名の日本語表示名マッピング
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  // Strands Retrieve
  retrieve: 'Strands Retrieve - みのるん特製ナレッジベース検索ツール',
  // Tavily Web検索（@toolで定義）
  tavily_search: 'Tavily Web検索ツール',
  // re:Invent MCP
  search_sessions: 're:Invent MCP - セッション全文検索ツール',
  search_services: 're:Invent MCP - AWSサービス検索ツール',
  get_session_details: 're:Invent MCP - セッション詳細取得ツール',
  list_categories: 're:Invent MCP - カテゴリ一覧取得ツール',
  get_sessions_by_service: 're:Invent MCP - サービス別セッション検索ツール',
  get_sessions_by_level: 're:Invent MCP - 難易度別セッション検索ツール',
  get_sessions_by_role: 're:Invent MCP - 職種別セッション検索ツール',
  get_sessions_by_industry: 're:Invent MCP - 業界別セッション検索ツール',
  get_sessions_by_segment: 're:Invent MCP - セグメント別セッション検索ツール',
  get_sessions_by_feature: 're:Invent MCP - 形式別セッション検索ツール',
  get_sessions_by_topic: 're:Invent MCP - トピック別セッション検索ツール',
  get_sessions_by_area_of_interest: 're:Invent MCP - 興味分野別セッション検索ツール',
  search_speakers: 're:Invent MCP - スピーカー検索ツール',
  // AWS What's New
  search_aws_updates: 'AWS What\'s New - AWSアップデート検索ツール',
}

// AgentCore Runtime設定（環境変数必須）
const AGENT_RUNTIME_ARN = import.meta.env.VITE_AGENT_RUNTIME_ARN
const AWS_REGION = import.meta.env.VITE_AWS_REGION || 'us-west-2'

export function ChatInterface({ sessionId, accessToken, userEmail }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    // アシスタントメッセージのプレースホルダー（思考中）
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isToolUsing: false,
      },
    ])

    try {
      // AgentCore RuntimeへのHTTPSリクエスト（JWT認証）
      const escapedAgentArn = encodeURIComponent(AGENT_RUNTIME_ARN)
      const url = `https://bedrock-agentcore.${AWS_REGION}.amazonaws.com/runtimes/${escapedAgentArn}/invocations?qualifier=DEFAULT`

      // baggageヘッダーでユーザー情報をトレースに伝播
      const baggageItems: string[] = []
      if (userEmail) {
        baggageItems.push(`userEmail=${encodeURIComponent(userEmail)}`)
      }
      baggageItems.push(`sessionId=${sessionId}`)

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
          ...(baggageItems.length > 0 && { 'baggage': baggageItems.join(',') }),
        },
        body: JSON.stringify({
          prompt: userMessage.content,
          session_id: sessionId,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('API error:', response.status, errorText)
        throw new Error(`API error: ${response.status}`)
      }

      // ストリーミングレスポンスの処理
      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('text/event-stream')) {
        // SSEストリーミング
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()

        if (!reader) {
          throw new Error('Response body is null')
        }

        let currentBuffer = ''
        let isInToolUse = false
        let toolUseMessageIndex = -1

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue

              try {
                const event = JSON.parse(data)

                // デバッグ: イベントの内容を確認
                console.log('Received event:', JSON.stringify(event, null, 2))

                // エラーイベント
                if (event.type === 'error') {
                  setMessages((prev) => {
                    const newMessages = [...prev]
                    newMessages[newMessages.length - 1] = {
                      ...newMessages[newMessages.length - 1],
                      content: `エラー: ${event.message}`,
                      isToolUsing: false,
                    }
                    return newMessages
                  })
                  continue
                }

                // ツール使用イベント
                if (event.type === 'tool_use') {
                  isInToolUse = true
                  const savedBuffer = currentBuffer
                  // バックエンドから送られるtool_nameを取得し、日本語表示名にマッピング
                  const toolName = event.tool_name || 'ツール'
                  const displayName = TOOL_DISPLAY_NAMES[toolName] || toolName

                  setMessages((prev) => {
                    const newMessages = [...prev]
                    if (savedBuffer) {
                      // 既存のテキストを確定 + ツールインジケーターを追加
                      newMessages[newMessages.length - 1] = {
                        ...newMessages[newMessages.length - 1],
                        content: savedBuffer,
                        isToolUsing: false,
                      }
                      toolUseMessageIndex = newMessages.length
                      newMessages.push({
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: '',
                        timestamp: new Date(),
                        isToolUsing: true,
                        toolCompleted: false,
                        toolName: displayName,
                      })
                    } else {
                      // テキストがない場合は思考中をツールインジケーターに置き換え
                      toolUseMessageIndex = newMessages.length - 1
                      newMessages[newMessages.length - 1] = {
                        ...newMessages[newMessages.length - 1],
                        content: '',
                        isToolUsing: true,
                        toolCompleted: false,
                        toolName: displayName,
                      }
                    }
                    return newMessages
                  })

                  currentBuffer = ''
                  continue
                }

                // テキストイベント
                if (event.type === 'text' && event.data) {
                  const newText = event.data
                  if (isInToolUse && currentBuffer === '') {
                    // ツール使用後の最初のテキスト - ツールを完了状態に
                    const savedToolIndex = toolUseMessageIndex

                    setMessages((prev) => {
                      const newMessages = [...prev]

                      // ツールインジケーターを完了状態に変更
                      if (savedToolIndex >= 0 && savedToolIndex < newMessages.length) {
                        newMessages[savedToolIndex] = {
                          ...newMessages[savedToolIndex],
                          toolCompleted: true,
                        }
                      }

                      // 新しいメッセージを追加
                      newMessages.push({
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: newText,
                        timestamp: new Date(),
                        isToolUsing: false,
                      })

                      return newMessages
                    })

                    currentBuffer = newText
                    isInToolUse = false
                    toolUseMessageIndex = -1
                  } else {
                    // 通常のテキスト蓄積
                    currentBuffer += newText
                    setMessages((prev) => {
                      const newMessages = [...prev]
                      newMessages[newMessages.length - 1] = {
                        ...newMessages[newMessages.length - 1],
                        content: currentBuffer,
                        isToolUsing: false,
                      }
                      return newMessages
                    })
                  }
                }
              } catch {
                // JSONパースに失敗した場合はテキストとして追加
                if (data.trim()) {
                  currentBuffer += data
                  setMessages((prev) => {
                    const newMessages = [...prev]
                    newMessages[newMessages.length - 1] = {
                      ...newMessages[newMessages.length - 1],
                      content: currentBuffer,
                      isToolUsing: false,
                    }
                    return newMessages
                  })
                }
              }
            }
          }
        }
      } else {
        // JSONレスポンス
        const data = await response.json()
        const responseText = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
        setMessages((prev) => {
          const newMessages = [...prev]
          newMessages[newMessages.length - 1] = {
            ...newMessages[newMessages.length - 1],
            content: responseText,
          }
          return newMessages
        })
      }
    } catch (error) {
      console.error('Error:', error)
      setMessages((prev) => {
        const newMessages = [...prev]
        newMessages[newMessages.length - 1] = {
          ...newMessages[newMessages.length - 1],
          content: 'エラーが発生しました。しばらくしてからもう一度お試しください。',
          isToolUsing: false,
        }
        return newMessages
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-violet-900 text-white p-4 shadow-md">
        <h1 className="text-xl font-bold">#reInventエージェント（非公式）</h1>
        <p className="text-sm opacity-90">みのるんがStrands & AgentCore & Amplifyで構築しています。</p>
      </header>

      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p className="text-lg mb-2">ようこそ👋</p>
            <p className="text-sm">
              AWS re:Invent 2025のセッション、会場情報、
              <br />
              旅程や準備Tipsなど何でも聞いてみてね！
              <br />
              <br />
              最近発表された新機能の解説もできます。
            </p>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                message.role === 'user'
                  ? 'bg-violet-700 text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}
            >
              {/* 思考中スピナー（アシスタントメッセージが空でツール使用中でない場合） */}
              {message.role === 'assistant' && !message.content && !message.isToolUsing && (
                <div className="flex items-center gap-2 text-gray-600 text-sm">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  思考中...
                </div>
              )}

              {/* ツール使用インジケーター */}
              {message.isToolUsing && (
                <div className={`flex items-center gap-2 text-sm ${message.toolCompleted ? 'text-green-600' : 'text-violet-600'}`}>
                  {message.toolCompleted ? (
                    <span className="inline-block w-4 h-4 text-green-600">✓</span>
                  ) : (
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  🔧 {message.toolName || 'ツール'}{message.toolCompleted ? 'を利用しました' : 'を利用しています...'}
                </div>
              )}

              {/* ユーザーメッセージ */}
              {message.role === 'user' && (
                <p className="whitespace-pre-wrap">{message.content}</p>
              )}

              {/* アシスタントメッセージ本文 */}
              {message.role === 'assistant' && message.content && !message.isToolUsing && (
                <div className="prose prose-sm max-w-none prose-headings:mt-3 prose-headings:mb-2 prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-table:my-2">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <form onSubmit={handleSubmit} className="p-4 bg-white border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="メッセージを入力..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-2 bg-violet-700 text-white rounded-lg hover:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            送信
          </button>
        </div>
      </form>
    </div>
  )
}