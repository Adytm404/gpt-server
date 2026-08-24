import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from 'lucide-react'
import { adminApi } from '../api/admin'
import '../styles/marketing.css'

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="OpsAI">
      <span />
      <span />
      <span />
      <span />
    </div>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    setStatusMessage('')

    try {
      const res = await adminApi.forgotPassword(email.trim())
      setStatusMessage(res.message || 'If an account exists, reset instructions have been sent.')
      setSubmitted(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to process request')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <NavLink to="/" className="auth-brand">
        <BrandMark />
        <span>OpsAI</span>
      </NavLink>

      <main className="auth-form-panel">
        <div className="auth-form-wrap">
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              marginBottom: 18,
              border: '1px solid #7657ff20',
            }}
          >
            <KeyRound size={22} />
          </div>

          <span className="page-eyebrow">Account Recovery</span>
          <h1 style={{ fontSize: 32, margin: '8px 0 10px' }}>Reset password.</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
            Enter your registered email address and we will send you a secure link to reset your account password.
          </p>

          {submitted ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                style={{
                  padding: '16px 18px',
                  background: '#f0fff4',
                  border: '1px solid #c6f6d5',
                  borderRadius: 12,
                  color: 'var(--green)',
                  fontSize: 13,
                  lineHeight: 1.5,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  textAlign: 'left',
                }}
              >
                <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>Check your inbox</strong>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#276749' }}>
                    {statusMessage}
                  </p>
                </div>
              </div>

              <div
                style={{
                  padding: '12px 14px',
                  background: '#fff',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  fontSize: 11,
                  color: 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Clock3 size={13} color="var(--accent)" /> Link expires in 1 hour
              </div>

              <NavLink to="/login" className="button dark auth-submit" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                Return to Sign In <ArrowRight size={14} />
              </NavLink>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label className="auth-field">
                <span>Email address</span>
                <div>
                  <Mail size={15} />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                  />
                </div>
              </label>

              {error && (
                <div className="auth-error" role="alert">
                  <AlertTriangle size={14} /> {error}
                </div>
              )}

              <button className="button dark auth-submit" disabled={loading} style={{ minHeight: 44, marginTop: 6 }}>
                {loading ? <><span className="tiny-spinner" /> Sending instructions...</> : 'Send reset link'}
              </button>
            </form>
          )}

          <p className="auth-switch" style={{ marginTop: 24 }}>
            Remembered your password? <NavLink to="/login">Sign in</NavLink>
          </p>
          <div className="auth-trust">
            <ShieldCheck size={12} /> Encrypted session / 256-bit Token Validation
          </div>
        </div>
      </main>

      <aside className="auth-visual">
        <div className="auth-grid" />
        <div className="auth-visual-copy">
          <span>IDENTITY PROTECTION / RECOVERY</span>
          <h2>Secure access.<br />Verified recovery.</h2>
          <p>Password reset links are cryptographically signed, single-use, and expire automatically after 60 minutes.</p>
        </div>
        <div className="auth-operation">
          <header>
            <span><i /> RECOVERY PROTOCOL</span>
            <b>CREDENTIAL VAULT</b>
          </header>
          <div>
            <i><Check size={12} /></i>
            <span><b>Zero plain-text storage</b><small>Argon2id cryptographic hashing</small></span>
          </div>
          <div>
            <i><Check size={12} /></i>
            <span><b>Session revocation</b><small>Active sessions invalidated on password update</small></span>
          </div>
          <div>
            <i><Check size={12} /></i>
            <span><b>Single-use link validation</b><small>SHA-256 token digest verification</small></span>
          </div>
          <footer><ShieldCheck size={11} /> STRICT ZERO-TRUST SECURITY</footer>
        </div>
        <div className="auth-visual-foot">
          <span>SESSION ENCRYPTED</span>
          <span>OPS / 2026</span>
        </div>
      </aside>
    </div>
  )
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(token ? '' : 'No reset token provided in the link.')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) {
      setError('Missing reset token')
      return
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    setError('')

    try {
      await adminApi.resetPassword(token, password)
      setSuccess(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reset password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <NavLink to="/" className="auth-brand">
        <BrandMark />
        <span>OpsAI</span>
      </NavLink>

      <main className="auth-form-panel">
        <div className="auth-form-wrap">
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: 12,
              background: success ? '#f0fff4' : error ? '#fff5f5' : 'var(--accent-soft)',
              color: success ? 'var(--green)' : error ? 'var(--red)' : 'var(--accent)',
              marginBottom: 18,
              border: `1px solid ${success ? '#c6f6d5' : error ? '#fed7d7' : '#7657ff20'}`,
            }}
          >
            {success ? <CheckCircle2 size={24} /> : <LockKeyhole size={22} />}
          </div>

          {success ? (
            <>
              <span className="page-eyebrow" style={{ color: 'var(--green)' }}>Password Updated</span>
              <h1 style={{ fontSize: 32, margin: '8px 0 10px' }}>All set!</h1>
              <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
                Your password has been successfully reset. All previous active sessions have been signed out for security.
              </p>
              <button
                className="button dark auth-submit"
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onClick={() => navigate('/login')}
              >
                Sign In With New Password <ArrowRight size={14} />
              </button>
            </>
          ) : (
            <>
              <span className="page-eyebrow">Security Update</span>
              <h1 style={{ fontSize: 32, margin: '8px 0 10px' }}>Set new password.</h1>
              <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
                Choose a strong password with at least 12 characters to protect your workspace servers and SSH access.
              </p>

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label className="auth-field">
                  <span>New password <small>12+ characters</small></span>
                  <div>
                    <LockKeyhole size={15} />
                    <input
                      required
                      minLength={12}
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Enter new password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </label>

                <label className="auth-field">
                  <span>Confirm new password</span>
                  <div>
                    <LockKeyhole size={15} />
                    <input
                      required
                      minLength={12}
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Repeat new password"
                      autoComplete="new-password"
                    />
                  </div>
                </label>

                {error && (
                  <div className="auth-error" role="alert">
                    <AlertTriangle size={14} /> {error}
                  </div>
                )}

                <button className="button dark auth-submit" disabled={loading || !token} style={{ minHeight: 44, marginTop: 6 }}>
                  {loading ? <><span className="tiny-spinner" /> Updating password...</> : 'Save new password'}
                </button>
              </form>

              <p className="auth-switch" style={{ marginTop: 24 }}>
                <NavLink to="/login">Back to Sign In</NavLink>
              </p>
            </>
          )}

          <div className="auth-trust" style={{ marginTop: 24 }}>
            <ShieldCheck size={12} /> Encrypted session / Argon2id Password Hashing
          </div>
        </div>
      </main>

      <aside className="auth-visual">
        <div className="auth-grid" />
        <div className="auth-visual-copy">
          <span>CREDENTIAL UPDATE / SECURITY</span>
          <h2>Strong guardrails.<br />Zero compromise.</h2>
          <p>Your password is encrypted using high-memory Argon2id before saving. OpsAI never stores plain passwords.</p>
        </div>
        <div className="auth-operation">
          <header>
            <span><i /> CIPHER STATUS</span>
            <b>{success ? 'COMPLETED' : 'AWAITING INPUT'}</b>
          </header>
          <div>
            <i><Check size={12} /></i>
            <span><b>Token validation</b><small>Single-use authorization verified</small></span>
          </div>
          <div>
            <i><Check size={12} /></i>
            <span><b>Argon2id hashing</b><small>64MB memory cost / 3 iterations</small></span>
          </div>
          <div className={success ? '' : 'running'}>
            <i>{success ? <Check size={12} /> : <span />}</i>
            <span><b>{success ? 'Credential updated' : 'Awaiting confirmation'}</b><small>Automatic session cleanup</small></span>
          </div>
          <footer><ShieldCheck size={11} /> STRICT ZERO-TRUST SECURITY</footer>
        </div>
        <div className="auth-visual-foot">
          <span>SESSION ENCRYPTED</span>
          <span>OPS / 2026</span>
        </div>
      </aside>
    </div>
  )
}
