import { useState, useRef, useEffect, type FormEvent } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ChatInterfaceProps {
  sessionId: string
  accessToken: string
}

// AgentCore Runtime設定
const AGENT_RUNTIME_ARN = import.meta.env.VITE_AGENT_RUNTIME_ARN || 'arn:aws:bedrock-agentcore:us-west-2:715841358122:runtime/reinvent-S3AJ2uCrco'
const AWS_REGION = import.meta.env.VITE_AWS_REGION || 'us-west-2'

export function ChatInterface({ sessionId, accessToken }: ChatInterfaceProps) {
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

    // アシスタントメッセージのプレースホルダー
    const assistantMessageId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      },
    ])

    try {
      // AgentCore RuntimeへのHTTPSリクエスト（JWT認証）
      const escapedAgentArn = encodeURIComponent(AGENT_RUNTIME_ARN)
      const url = `https://bedrock-agentcore.${AWS_REGION}.amazonaws.com/runtimes/${escapedAgentArn}/invocations?qualifier=DEFAULT`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
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
                const parsed = JSON.parse(data)
                if (parsed.text) {
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: msg.content + parsed.text }
                        : msg
                    )
                  )
                }
              } catch {
                // テキストとして追加
                if (data.trim()) {
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: msg.content + data }
                        : msg
                    )
                  )
                }
              }
            }
          }
        }
      } else {
        // JSONレスポンス
        const data = await response.json()
        const responseText = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: responseText }
              : msg
          )
        )
      }
    } catch (error) {
      console.error('Error:', error)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: 'エラーが発生しました。しばらくしてからもう一度お試しください。',
              }
            : msg
        )
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-orange-600 text-white p-4 shadow-md">
        <h1 className="text-xl font-bold">re:Invent 2025 コンシェルジュ</h1>
        <p className="text-sm opacity-90">AWS re:Invent 2025 についてなんでも聞いてください</p>
      </header>

      {/* メッセージエリア */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p className="text-lg mb-2">ようこそ！</p>
            <p className="text-sm">
              AWS re:Invent 2025のセッション、スケジュール、会場情報など
              <br />
              何でもお気軽にお聞きください。
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
                  ? 'bg-orange-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.role === 'assistant' && isLoading && !message.content && (
                <span className="inline-block animate-pulse">...</span>
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
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            送信
          </button>
        </div>
      </form>
    </div>
  )
}
