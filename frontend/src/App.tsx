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

// メールアドレスをマスク（@より左側を***に）
function maskEmail(email: string | undefined): string {
  if (!email) return ''
  const atIndex = email.indexOf('@')
  if (atIndex === -1) return '***'
  return '***' + email.slice(atIndex)
}

// ログイン済みユーザー用のチャットコンテナ
function AuthenticatedChat({ user, signOut }: { user: any; signOut?: () => void }) {
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
  }, [user]) // userが変わった時に再取得

  return (
    <div className="h-screen flex flex-col">
      {/* ユーザー情報バー - Dynamic Island対応 */}
      <div className="safe-area-top shrink-0 bg-violet-950 text-white px-4 py-2 flex justify-between items-center text-sm">
        <span>ログイン中: {maskEmail(user?.signInDetails?.loginId)}</span>
        <button
          onClick={signOut}
          className="px-3 py-1 bg-violet-800 hover:bg-violet-700 rounded transition-colors"
        >
          ログアウト
        </button>
      </div>
      {/* チャットインターフェース */}
      <div className="flex-1">
        <ChatInterface
          sessionId={sessionId}
          accessToken={accessToken}
          userEmail={user?.signInDetails?.loginId}
        />
      </div>
    </div>
  )
}

function App() {
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
      components={{
        Header() {
          return (
            <div className="text-center py-4">
              <h1 className="text-2xl font-bold text-white">
                #reInventエージェント（非公式）
              </h1>
              <p className="text-sm text-violet-200 mt-1">「Create Account」すれば誰でも利用できます！
                <br />
                <br />
                ※新規ユーザーが1日50人を超えると作成エラーになります。
                <br />
                その際は翌日までお待ちください🙏
              </p>
            </div>
          )
        },
        Footer() {
          return (
            <div className="text-center py-3 px-4">
              <p className="text-xs text-violet-300 leading-relaxed">
                登録されたメールアドレスは認証目的でのみ使用します。
                <br />
                第三者への提供や広告配信には使用しません。
              </p>
            </div>
          )
        },
      }}
    >
      {({ signOut, user }) => (
        <AuthenticatedChat user={user} signOut={signOut} />
      )}
    </Authenticator>
  )
}

export default App
