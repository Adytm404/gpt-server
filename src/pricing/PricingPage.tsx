import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, CreditCard, History, KeyRound, Layers3, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { listPublicPlans, type Plan } from '../api/admin'
import { useOptionalSession } from '../auth/SessionContext'

const cn = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ')
const formatIDR = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount)

function BrandMark() { return <div className="brand-mark" aria-label="OpsAI"><span /><span /><span /><span /></div> }

export default function PricingPage({ mode }: { mode?: 'public' | 'onboarding' | 'dashboard' }) {
  const location = useLocation()
  const navigate = useNavigate()
  const sessionState = useOptionalSession()
  const session = sessionState?.session

  const searchParams = new URLSearchParams(location.search)
  const isExplicitOnboarding = searchParams.get('mode') === 'onboarding' || mode === 'onboarding'
  const isDashboard = mode === 'dashboard' || (Boolean(session) && mode !== 'public' && !isExplicitOnboarding)

  const [annual, setAnnual] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPlans(await listPublicPlans())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load plans')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // --- 1. DASHBOARD MODE (Inside Authenticated AppShell) ---
  if (isDashboard) {
    return (
      <div className="content-page page-enter">
        <div className="page-heading">
          <div>
            <span className="page-eyebrow">Commercial &amp; Subscriptions</span>
            <h1>Plans &amp; Capacity</h1>
            <p>Upgrade server concurrency, monthly AI token limits, and continuous diagnostic monitoring.</p>
          </div>
          <div className="billing-toggle" aria-label="Billing period" style={{ margin: 0 }}>
            <button type="button" className={!annual ? 'active' : ''} onClick={() => setAnnual(false)}>Monthly</button>
            <button type="button" className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>Annual</button>
          </div>
        </div>

        {loading ? (
          <div className="api-state"><span className="tiny-spinner" /> Loading subscription plans...</div>
        ) : error ? (
          <div className="api-state error" role="alert">
            <span>{error}</span>
            <button className="button secondary" onClick={() => void load()}>Retry</button>
          </div>
        ) : plans.length === 0 ? (
          <div className="api-state">No public subscription plans currently available.</div>
        ) : (
          <div className="pricing-grid" style={{ marginTop: 24 }}>
            {plans.map((plan, index) => {
              const price = annual ? plan.annualPriceCents : plan.priceCents
              return (
                <article className={cn('pricing-card', index === 1 && 'featured')} key={plan.id}>
                  {index === 1 && <span className="popular-label">Most operational</span>}
                  <span className="page-eyebrow">Up to {plan.maxServers} servers</span>
                  <h2>{plan.name}</h2>
                  <p>{plan.description || 'Enterprise-grade server monitoring and AI incident diagnosis.'}</p>
                  <div className="plan-price">
                    <strong>{formatIDR(price)}</strong>
                    <small>/ workspace / month</small>
                  </div>
                  <small className="billing-note">{annual ? 'Billed annually' : 'Billed monthly'}</small>

                  <NavLink
                    to={`/checkout/${encodeURIComponent(plan.id)}?period=${annual ? 'annual' : 'monthly'}`}
                    className={cn('button', index === 1 ? 'accent' : 'secondary')}
                    style={{ textDecoration: 'none' }}
                  >
                    Subscribe to {plan.name} <ArrowRight size={14} />
                  </NavLink>

                  <div className="plan-features">
                    <span>INCLUDED</span>
                    <p><Check size={13} /> Up to <b>{plan.maxServers} servers</b> connected</p>
                    <p><Check size={13} /> <b>{new Intl.NumberFormat('id-ID').format(plan.monthlyTokens)}</b> monthly AI tokens</p>
                    {plan.features.map(feature => (
                      <p key={feature}><Check size={13} /> {feature}</p>
                    ))}
                  </div>
                </article>
              )
            })}
          </div>
        )}

        <section className="pricing-trust" style={{ marginTop: 40 }}>
          <div>
            <ShieldCheck size={20} />
            <span><b>Approval-first by default</b><small>No hidden command execution on any plan.</small></span>
          </div>
          <div>
            <KeyRound size={20} />
            <span><b>Secure SSH access</b><small>Managed keys and explicit server scope.</small></span>
          </div>
          <div>
            <History size={20} />
            <span><b>Duitku POP Payment Gateway</b><small>Instant activation via QRIS, VA, &amp; E-Wallet.</small></span>
          </div>
        </section>
      </div>
    )
  }

  // --- 2. ONBOARDING / REGISTRATION MODE ---
  if (isExplicitOnboarding) {
    return (
      <div className="landing-page pricing-page" style={{ minHeight: '100vh', background: '#f8f8f6' }}>
        <nav className="landing-nav">
          <NavLink to="/" className="landing-brand"><BrandMark /><span>OpsAI</span></NavLink>
          <NavLink to="/chat" className="button secondary compact">Skip to workspace <ArrowRight size={14} /></NavLink>
        </nav>

        <main>
          <section className="pricing-hero">
            <div className="landing-grid" />
            <div className="eyebrow" style={{ color: 'var(--green)' }}>
              <CheckCircle2 size={13} style={{ display: 'inline', marginRight: 4 }} /> Account Activated &bull; Step 3 of 3
            </div>
            <h1>Choose your workspace plan.<br /><em>Start operating securely.</em></h1>
            <p>Select a subscription plan to unlock dedicated AI token capacity and connect your target VPS/cloud servers.</p>
            <div className="billing-toggle" aria-label="Billing period">
              <button type="button" className={!annual ? 'active' : ''} onClick={() => setAnnual(false)}>Monthly</button>
              <button type="button" className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>Annual</button>
            </div>
          </section>

          {loading ? (
            <section className="pricing-api-state"><span className="tiny-spinner" /> Loading plans...</section>
          ) : error ? (
            <section className="pricing-api-state error" role="alert">
              <span>{error}</span>
              <button className="button secondary" onClick={() => void load()}>Retry</button>
            </section>
          ) : plans.length === 0 ? (
            <section className="pricing-api-state">No public plans available.</section>
          ) : (
            <section className="pricing-grid">
              {plans.map((plan, index) => (
                <article className={cn('pricing-card', index === 1 && 'featured')} key={plan.id}>
                  {index === 1 && <span className="popular-label">Recommended</span>}
                  <span className="page-eyebrow">Up to {plan.maxServers} servers</span>
                  <h2>{plan.name}</h2>
                  <p>{plan.description || 'Full access to AI root-cause analysis and live terminal streaming.'}</p>
                  <div className="plan-price">
                    <strong>{formatIDR(annual ? plan.annualPriceCents : plan.priceCents)}</strong>
                    <small>/ workspace / month</small>
                  </div>
                  <small className="billing-note">{annual ? 'Billed annually' : 'Billed monthly'}</small>

                  <NavLink
                    to={`/checkout/${encodeURIComponent(plan.id)}?period=${annual ? 'annual' : 'monthly'}`}
                    className={cn('button', index === 1 ? 'accent' : 'secondary')}
                  >
                    Activate {plan.name} <ArrowRight size={14} />
                  </NavLink>

                  <div className="plan-features">
                    <span>INCLUDED</span>
                    <p><Check size={13} /> Up to {plan.maxServers} servers</p>
                    <p><Check size={13} /> {new Intl.NumberFormat('id-ID').format(plan.monthlyTokens)} tokens / month</p>
                    {plan.features.map(feature => <p key={feature}><Check size={13} /> {feature}</p>)}
                  </div>
                </article>
              ))}
            </section>
          )}

          <div style={{ textAlign: 'center', marginTop: 30, marginBottom: 60 }}>
            <NavLink to="/chat" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'underline' }}>
              I want to explore with basic starter features first &rarr;
            </NavLink>
          </div>
        </main>
      </div>
    )
  }

  // --- 3. PUBLIC LANDING PRICING MODE ---
  return (
    <div className="landing-page pricing-page">
      <nav className="landing-nav">
        <NavLink to="/" className="landing-brand"><BrandMark /><span>OpsAI</span></NavLink>
        <div className="landing-links">
          <NavLink to="/">Product</NavLink>
          <NavLink to="/pricing" className="active">Pricing</NavLink>
        </div>
        <NavLink to="/chat" className="button dark">Open workspace <ArrowRight size={15} /></NavLink>
      </nav>

      <main>
        <section className="pricing-hero">
          <div className="landing-grid" />
          <div className="eyebrow"><span className="live-dot" /> Simple, operational pricing</div>
          <h1>Control every server.<br /><em>Scale when ready.</em></h1>
          <p>Start with enough capacity to operate confidently. Upgrade as infrastructure and team grow.</p>
          <div className="billing-toggle" aria-label="Billing period">
            <button type="button" className={!annual ? 'active' : ''} onClick={() => setAnnual(false)}>Monthly</button>
            <button type="button" className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>Annual</button>
          </div>
        </section>

        {loading ? (
          <section className="pricing-api-state"><span className="tiny-spinner" /> Loading plans...</section>
        ) : error ? (
          <section className="pricing-api-state error" role="alert">
            <span>{error}</span>
            <button className="button secondary" onClick={() => void load()}>Retry</button>
          </section>
        ) : plans.length === 0 ? (
          <section className="pricing-api-state">No public plans available.</section>
        ) : (
          <section className="pricing-grid">
            {plans.map((plan, index) => (
              <article className={cn('pricing-card', index === 1 && 'featured')} key={plan.id}>
                {index === 1 && <span className="popular-label">Most operational</span>}
                <span className="page-eyebrow">Up to {plan.maxServers} servers</span>
                <h2>{plan.name}</h2>
                <p>{plan.description}</p>
                <div className="plan-price">
                  <strong>{formatIDR(annual ? plan.annualPriceCents : plan.priceCents)}</strong>
                  <small>/ workspace / month</small>
                </div>
                <small className="billing-note">{annual ? 'Billed annually' : 'Billed monthly'}</small>
                <NavLink to={`/checkout/${encodeURIComponent(plan.id)}?period=${annual ? 'annual' : 'monthly'}`} className={cn('button', index === 1 ? 'accent' : 'secondary')}>
                  Subscribe to {plan.name} <ArrowRight size={14} />
                </NavLink>
                <div className="plan-features">
                  <span>INCLUDED</span>
                  {plan.features.map(feature => <p key={feature}><Check size={13} /> {feature}</p>)}
                </div>
              </article>
            ))}
          </section>
        )}

        <section className="pricing-trust">
          <div><ShieldCheck size={20} /><span><b>Approval-first by default</b><small>No hidden command execution on any plan.</small></span></div>
          <div><KeyRound size={20} /><span><b>Secure SSH access</b><small>Managed keys and explicit server scope.</small></span></div>
          <div><History size={20} /><span><b>Operational evidence</b><small>Commands, output, and decisions stay together.</small></span></div>
        </section>
      </main>
    </div>
  )
}
