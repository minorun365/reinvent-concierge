import { useEffect, useState } from 'react'
import { Amplify } from 'aws-amplify'
import { Authenticator } from '@aws-amplify/ui-react'
import { fetchAuthSession } from 'aws-amplify/auth'
import '@aws-amplify/ui-react/styles.css'
import { ChatInterface } from './components/ChatInterface'

// Amplify設定の読み込み（デプロイ後に生成されるファイル）
// 開発中はダミー設定を使用
const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID || 'dummy-user-pool-id',
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || 'dummy-client-id',
    },
  },
}

Amplify.configure(amplifyConfig)

function App() {
  const [sessionId] = useState(() => crypto.randomUUID())
  const [accessToken, setAccessToken] = useState<string>('')

  useEffect(() => {
    const getToken = async () => {
      try {
        const session = await fetchAuthSession()
        // JWT認証ではaccessTokenを使用
        const token = session.tokens?.accessToken?.toString()
        if (token) {
          setAccessToken(token)
        }
      } catch (error) {
        console.error('Error fetching auth session:', error)
      }
    }

    getToken()
  }, [])

  return (
    <Authenticator
      loginMechanisms={['email']}
      signUpAttributes={['email']}
      formFields={{
        signIn: {
          username: {
            label: 'メールアドレス',
            placeholder: 'メールアドレスを入力',
          },
          password: {
            label: 'パスワード',
            placeholder: 'パスワードを入力',
          },
        },
        signUp: {
          email: {
            label: 'メールアドレス',
            placeholder: 'メールアドレスを入力',
          },
          password: {
            label: 'パスワード',
            placeholder: 'パスワードを入力',
          },
          confirm_password: {
            label: 'パスワード（確認）',
            placeholder: 'パスワードを再入力',
          },
        },
      }}
    >
      {({ signOut, user }) => (
        <div className="h-screen flex flex-col">
          {/* ユーザー情報バー */}
          <div className="bg-gray-800 text-white px-4 py-2 flex justify-between items-center text-sm">
            <span>ログイン中: {user?.signInDetails?.loginId}</span>
            <button
              onClick={signOut}
              className="px-3 py-1 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
            >
              ログアウト
            </button>
          </div>
          {/* チャットインターフェース */}
          <div className="flex-1">
            <ChatInterface sessionId={sessionId} accessToken={accessToken} />
          </div>
        </div>
      )}
    </Authenticator>
  )
}

export default App
