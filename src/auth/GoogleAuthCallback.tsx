import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { adminApi } from '../api/admin'
import { useSession } from '../auth/SessionContext'

export function GoogleAuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { refresh } = useSession()
  const [error, setError] = useState('')

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  useEffect(() => {
    if (errorParam) {
      setError(`Google sign-in error: ${errorParam}`)
      return
    }
    if (!code || !state) {
      setError('Missing authentication code or state parameter from Google.')
      return
    }

    adminApi
      .handleGoogleCallback(code, state)
      .then(async () => {
        await refresh()
        navigate('/chat', { replace: true })
      })
      .catch(caught => {
        setError(caught instanceof Error ? caught.message : 'Google authentication failed')
      })
  }, [code, state, errorParam, navigate, refresh])

  return (
    <div className="auth-page" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="auth-form-wrap" style={{ maxWidth: 420, textAlign: 'center', margin: 'auto' }}>
        <div className="ai-orb" style={{ margin: '0 auto 20px' }}>
          <div className="orb-core" />
          <div className="orb-ring ring-one" />
          <div className="orb-ring ring-two" />
        </div>
        <h2>{error ? 'Authentication Failed' : 'Completing Sign-In'}</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
          {error ? error : 'Authenticating with Google and establishing secure workspace session...'}
        </p>
        {error && (
          <div className="auth-error" role="alert" style={{ marginTop: 18 }}>
            <AlertTriangle size={15} /> {error}
          </div>
        )}
        {error && (
          <button
            type="button"
            className="button dark"
            style={{ marginTop: 16 }}
            onClick={() => navigate('/login', { replace: true })}
          >
            Back to login
          </button>
        )}
      </div>
    </div>
  )
}
