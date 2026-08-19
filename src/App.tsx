import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, Bell, Bot, Boxes, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Command, Copy, Cpu, Database, Download,
  Eye, EyeOff, FileCode2, Gauge, HardDrive, History, KeyRound, LayoutGrid, ListFilter, LockKeyhole, Mail, MemoryStick,
  Menu, MessageSquare, MoreHorizontal, Paperclip, Play, Plus, Search, Send, Server as ServerIcon,
  Settings, ShieldCheck, Sparkles, Square, Terminal, UserRound, X, Zap,
} from 'lucide-react'
import { executionLogs, servers, type Server } from './data'

const cn = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ')

type DemoAction = { kind: string; title: string; detail?: string }
const openDemo = (kind: string, title: string, detail?: string) => window.dispatchEvent(new CustomEvent<DemoAction>('opsai:demo', { detail: { kind, title, detail } }))
const showToast = (message: string) => window.dispatchEvent(new CustomEvent<string>('opsai:toast', { detail: message }))

function DemoUIHost() {
  const [action, setAction] = useState<DemoAction | null>(null)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const demo = (event: Event) => setAction((event as CustomEvent<DemoAction>).detail)
    const notify = (event: Event) => { setToast((event as CustomEvent<string>).detail); window.setTimeout(() => setToast(''), 2200) }
    window.addEventListener('opsai:demo', demo)
    window.addEventListener('opsai:toast', notify)
    return () => { window.removeEventListener('opsai:demo', demo); window.removeEventListener('opsai:toast', notify) }
  }, [])
  useEffect(() => {
    if (!action) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setAction(null) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [action])
  const complete = (message = 'Changes saved') => {
    setBusy(true)
    window.setTimeout(() => { setBusy(false); setAction(null); showToast(message) }, 700)
  }
  return createPortal(<>{toast && <div className="demo-toast"><CheckCircle2 size={16} /><span>{toast}</span></div>}{action && <div className="demo-layer"><button className="demo-scrim" onClick={() => setAction(null)} aria-label="Close" /><section className={cn('demo-surface', action.kind === 'console' || action.kind === 'audit' || action.kind === 'sessions' ? 'drawer' : '')}><header><div><span className="page-eyebrow">Interactive preview</span><h2>{action.title}</h2>{action.detail && <p>{action.detail}</p>}</div><button className="icon-button" onClick={() => setAction(null)} aria-label="Close"><X size={18} /></button></header><DemoContent action={action} /><footer><button className="button secondary" onClick={() => setAction(null)}>Cancel</button><button className="button dark" onClick={() => complete(action.kind === 'download' ? 'Download prepared' : action.kind === 'restart' ? 'Service restart completed' : action.kind === 'oauth' ? 'Integration connected' : 'Changes saved')} disabled={busy}>{busy ? <><span className="tiny-spinner" /> Working...</> : action.kind === 'download' ? 'Download' : action.kind === 'restart' ? 'Confirm restart' : action.kind === 'oauth' ? 'Connect' : 'Save changes'}</button></footer></section></div>}</>, document.body)
}

function DemoContent({ action }: { action: DemoAction }) {
  if (action.kind === 'console') return <div className="demo-console"><div>Connecting to production-api...</div><div className="success">Authenticated with managed SSH key</div><code>deploy@production-api:~$ <i /></code></div>
  if (action.kind === 'search') return <div className="demo-search"><Search size={17} /><input autoFocus placeholder="Search chats, servers, executions..." /><div><span>Servers</span><button onClick={() => { window.location.href='/servers/production-api' }}><ServerIcon size={15} /> Production API <small>api.opsai.cloud</small></button><button onClick={() => { window.location.href='/servers/worker-primary' }}><ServerIcon size={15} /> Worker Primary <small>10.12.4.21</small></button><span>Recent chats</span><button onClick={() => { window.location.href='/chat/diagnose' }}><MessageSquare size={15} /> Diagnose worker CPU</button></div></div>
  if (action.kind === 'notifications') return <div className="demo-list">{['Worker CPU returned to baseline', 'Health check completed', 'SSH key rotation due in 8 days'].map((item, index) => <button key={item} onClick={() => showToast(`Opened: ${item}`)}><i className={index ? '' : 'unread'} /><span><b>{item}</b><small>{index ? `${index + 1} hours ago` : '2 minutes ago'}</small></span></button>)}</div>
  if (action.kind === 'workspace') return <div className="demo-choice">{['Northstar Ops', 'Atlas Staging', 'Personal Lab'].map((item, index) => <button className={index === 0 ? 'selected' : ''} key={item} onClick={() => showToast(index === 0 ? 'Northstar Ops already active' : `Switched to ${item}`)}><span className="workspace-dot" /><span><b>{item}</b><small>{index === 0 ? 'Current workspace' : '3 servers'}</small></span>{index === 0 && <Check size={15} />}</button>)}</div>
  if (action.kind === 'rules') return <div className="demo-rules">{['Block recursive deletion', 'Protect package managers', 'Require approval for service restart', 'Prevent firewall lockout'].map((rule, index) => <label key={rule}><span><b>{rule}</b><small>{index < 2 ? 'Critical guardrail' : 'Workspace policy'}</small></span><input type="checkbox" defaultChecked /></label>)}</div>
  if (action.kind === 'sessions') return <div className="demo-list">{['Edge / Windows 11 / Jakarta', 'Chrome / macOS / Singapore'].map((item, index) => <button key={item} onClick={() => showToast(index ? 'Session revoked' : 'This is your current session')}><MonitorIcon /><span><b>{item}</b><small>{index ? 'Last active yesterday' : 'Current session'}</small></span><em>{index ? 'Revoke' : 'Current'}</em></button>)}</div>
  if (action.kind === 'avatar') return <div className="avatar-options">{['AR', 'A', 'NR', 'OP'].map((item, index) => <button className={index === 0 ? 'selected' : ''} key={item} onClick={() => showToast(`Avatar ${item} selected`)}>{item}</button>)}<label className="button secondary"><Paperclip size={14} /> Upload image<input type="file" hidden accept="image/*" onChange={() => showToast('Avatar image selected')} /></label></div>
  if (action.kind === 'password') return <div className="demo-form"><label>Current password<input type="password" placeholder="Current password" /></label><label>New password<input type="password" placeholder="8+ characters" /></label><label>Confirm password<input type="password" placeholder="Repeat new password" /></label></div>
  if (action.kind === 'reset') return <div className="demo-form"><label>Email address<input type="email" defaultValue="arya@northstar.dev" /></label><div className="demo-note"><Mail size={16} /> Reset instructions will be sent to this address.</div></div>
  if (action.kind === 'email') return <div className="demo-form two"><label>Frequency<select defaultValue="Daily"><option>Daily</option><option>Weekly</option></select></label><label>Delivery time<input type="time" defaultValue="09:00" /></label><label className="wide">Recipients<input defaultValue="arya@northstar.dev" /></label></div>
  if (action.kind === 'oauth') return <div className="oauth-preview"><Zap size={28} /><h3>{action.title.includes('Google') ? 'Choose a Google account' : 'Connect Slack workspace'}</h3><p>{action.title.includes('Google') ? <>Continue as <b>arya@northstar.dev</b> in this visual demo.</> : <>Demo connection will route alerts to <b>#ops-alerts</b>.</>}</p></div>
  if (action.kind === 'audit') return <div className="audit-preview">{['Health check completed', 'Configuration read by OpsAI', 'SSH key rotated', 'Deployment completed', 'Approval policy updated'].map((item, index) => <div key={item}><i><History size={14} /></i><span><b>{item}</b><small>Aria Rahman / {index + 1}h ago</small></span></div>)}</div>
  if (action.kind === 'restart') return <div className="confirm-preview"><AlertTriangle size={28} /><h3>{action.title.includes('Delete') ? `Delete ${action.detail}` : `Restart ${action.detail}`}</h3><p>{action.title.includes('Delete') ? 'This removes the thread from recent history in the visual demo.' : 'Service may be unavailable briefly. This dummy action will only update visual state.'}</p></div>
  return <div className="demo-form"><label>Name<input defaultValue={action.detail || action.title} /></label><label>Option<select><option>Default</option><option>Custom</option></select></label><div className="demo-note"><ShieldCheck size={16} /> This is a visual demonstration. No backend action will run.</div></div>
}

function MonitorIcon() { return <i className="demo-monitor"><Terminal size={15} /></i> }

function BrandMark() {
  return <div className="brand-mark" aria-label="OpsAI"><span /><span /><span /><span /></div>
}

const primaryNav = [
  { to: '/chat', icon: MessageSquare, label: 'Chat' },
  { to: '/servers', icon: ServerIcon, label: 'Servers' },
  { to: '/executions', icon: Terminal, label: 'Executions' },
]

const recentChats = [
  { id: 'diagnose', title: 'Diagnose worker CPU', server: 'Production API', time: '2m' },
  { id: 'nginx-errors', title: 'Review nginx 502 errors', server: 'Production API', time: '1h' },
  { id: 'docker-restarts', title: 'Inspect Docker restarts', server: 'Worker Primary', time: '1d' },
  { id: 'backup-check', title: 'Verify PostgreSQL backups', server: 'Staging Web', time: '3d' },
]

function Sidebar({ open, close, expanded, toggle }: { open: boolean; close: () => void; expanded: boolean; toggle: () => void }) {
  return <>
    <aside className={cn('sidebar', open && 'is-open', expanded && 'expanded')}>
      <div className="sidebar-top"><BrandMark /><strong>OpsAI</strong><button className="sidebar-toggle" onClick={toggle} aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>{expanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button></div>
      <nav className="nav-stack" aria-label="Main navigation">
        {primaryNav.map(({ to, icon: Icon, label }) => <NavLink key={to} to={to} onClick={close} className={({ isActive }) => cn('nav-icon', isActive && 'active')}><Icon size={18} /><span className="nav-label">{label}</span><span className="tooltip">{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-history"><div><span>Recent chats</span><NavLink to="/chat" aria-label="New chat"><Plus size={14} /></NavLink></div>{recentChats.map(chat => <NavLink key={chat.id} to={`/chat/${chat.id}?server=${chat.id === 'docker-restarts' ? 'worker-primary' : chat.id === 'backup-check' ? 'staging-web' : 'production-api'}`} onClick={close} className={({ isActive }) => cn('history-link', isActive && 'active')}><MessageSquare size={13} /><span><b>{chat.title}</b><small>{chat.server}</small></span><em>{chat.time}</em></NavLink>)}</div>
      <div className="sidebar-bottom">
        <button className="nav-icon" onClick={() => openDemo('help', 'Help & resources', 'Find guidance without leaving your workspace.')}><CircleHelp size={18} /><span className="nav-label">Help</span><span className="tooltip">Help</span></button>
        <NavLink to="/settings" className={({ isActive }) => cn('nav-icon', isActive && 'active')}><Settings size={18} /><span className="nav-label">Settings</span><span className="tooltip">Settings</span></NavLink>
        <div className="sidebar-plan"><div><span><Zap size={13} /> Control plan</span><b>68% used</b></div><i><b /></i><p>680 of 1,000 operations</p><NavLink to="/pricing">Manage plan <ArrowRight size={12} /></NavLink></div>
        <NavLink to="/profile" className="profile-link" aria-label="Profile"><span className="avatar">AR</span><span><b>Aria Rahman</b><small>Workspace owner</small></span><ChevronRight size={14} /></NavLink>
      </div>
    </aside>
    {open && <button className="sidebar-scrim" onClick={close} aria-label="Close menu" />}
  </>
}

function Topbar({ menu }: { menu: () => void }) {
  const location = useLocation()
  const section = location.pathname.startsWith('/servers') ? 'Servers' : location.pathname.startsWith('/executions') ? 'Executions' : location.pathname.startsWith('/settings') ? 'Settings' : location.pathname.startsWith('/profile') ? 'Profile' : location.pathname.startsWith('/chat/') ? 'AI session' : 'Command center'
  return <header className="topbar">
    <div className="topbar-left"><button className="mobile-menu icon-button" onClick={menu} aria-label="Open menu"><Menu size={20} /></button><button className="workspace-picker" onClick={() => openDemo('workspace', 'Switch workspace', 'Select where you want to operate.')}><span className="workspace-dot" /> Northstar Ops <ChevronDown size={14} /></button><span className="breadcrumb">/</span><span className="section-name">{section}</span></div>
    <div className="topbar-actions"><button className="icon-button mobile-hide" onClick={() => openDemo('search', 'Search workspace')} aria-label="Search"><Search size={17} /></button><button className="icon-button" onClick={() => openDemo('notifications', 'Notifications', 'Recent workspace activity.')} aria-label="Notifications"><Bell size={17} /><i className="notification-dot" /></button><NavLink to="/chat" className="button dark compact"><Plus size={16} /> <span>New thread</span></NavLink></div>
  </header>
}

function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(() => window.localStorage.getItem('sidebar-expanded') === 'true')
  const toggleSidebar = () => setSidebarExpanded(value => { window.localStorage.setItem('sidebar-expanded', String(!value)); return !value })
  return <div className={cn('app-shell', sidebarExpanded && 'sidebar-expanded')}><Sidebar open={menuOpen} close={() => setMenuOpen(false)} expanded={sidebarExpanded} toggle={toggleSidebar} /><div className="app-body"><Topbar menu={() => setMenuOpen(true)} /><main><Routes>
    <Route path="/chat" element={<HomePage />} />
    <Route path="/chat/:id" element={<ThreadPage />} />
    <Route path="/servers" element={<ServersPage />} />
    <Route path="/servers/:id" element={<ServerDetailPage />} />
    <Route path="/executions" element={<ExecutionsPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="/profile" element={<ProfilePage />} />
    <Route path="*" element={<PlaceholderPage />} />
  </Routes></main></div></div>
}

function LandingPage() {
  const [previewRunning, setPreviewRunning] = useState(false)
  const capabilities = [
    { icon: Activity, number: '01', title: 'See the signal', copy: 'Ask plain-language questions across CPU, memory, services, logs, and containers.' },
    { icon: ShieldCheck, number: '02', title: 'Approve the plan', copy: 'Review every generated command before anything touches your infrastructure.' },
    { icon: Terminal, number: '03', title: 'Watch it run', copy: 'Follow live output, exit codes, and operational history from one focused surface.' },
  ]
  return <div className="landing-page">
    <nav className="landing-nav"><NavLink to="/" className="landing-brand"><BrandMark /><span>OpsAI</span></NavLink><div className="landing-links"><a href="#workflow">Workflow</a><a href="#security">Security</a><NavLink to="/pricing">Pricing</NavLink></div><NavLink to="/chat" className="button dark">Open workspace <ArrowRight size={15} /></NavLink></nav>
    <main>
      <section className="landing-hero"><div className="landing-grid" /><div className="landing-copy"><div className="eyebrow"><span className="live-dot" /> AI operations, under your control</div><h1>Your servers.<br />One <em>clear</em> command.</h1><p>Investigate incidents, inspect infrastructure, and run approved SSH operations without losing sight of what changes where.</p><div className="landing-actions"><NavLink to="/chat" className="button dark">Start operating <ArrowRight size={16} /></NavLink><a href="#workflow" className="landing-text-link">See how it works <ChevronDown size={14} /></a></div><div className="landing-proof"><span><ShieldCheck size={14} /> Approval-first</span><span><KeyRound size={14} /> Key-based SSH</span><span><History size={14} /> Full audit trail</span></div></div>
        <div className={cn('landing-chat-preview', previewRunning && 'demo-running')}><div className="preview-chat"><div className="preview-chat-head"><div><small>AI OPERATION</small><strong>Diagnose server health</strong></div><span><i /> Connected</span></div><div className="preview-conversation"><div className="preview-message preview-user"><i>AR</i><div><span><b>You</b><small>just now</small></span><p>Find why worker CPU is elevated.</p><em><ServerIcon size={10} /> Production API</em></div></div><div className="preview-message preview-ai"><i><Sparkles size={12} /></i><div><span><b>OpsAI</b><small>{previewRunning ? 'working...' : 'ready to run'}</small></span><p>I'll inspect system load, top processes, and service health.</p><div className="preview-plan"><header><span><Command size={12} /><b>Execution plan</b></span><em><ShieldCheck size={10} /> Low risk</em></header>{['Check system resource pressure', 'Find top CPU processes', 'Inspect critical services'].map((item, index) => <div className="preview-plan-step" key={item}><i>{index + 1}</i><span>{item}</span></div>)}<code>ps aux --sort=-%cpu | head -n 6</code><footer><button onClick={() => openDemo('edit', 'Edit execution plan', 'ps aux --sort=-%cpu | head -n 6')}>Edit plan</button><button onClick={() => { setPreviewRunning(true); window.setTimeout(() => { setPreviewRunning(false); showToast('Preview operation completed') }, 2400) }}>{previewRunning ? 'Running...' : 'Approve & run'} <Play size={9} fill="currentColor" /></button></footer></div></div></div></div><div className="preview-composer"><span>Ask a follow-up...</span><em><ServerIcon size={10} /> Production API</em><i><ArrowRight size={11} /></i></div></div><div className="preview-execution"><div className="preview-execution-head"><small><i /> {previewRunning ? 'LIVE' : 'READY'}</small><strong>Execution output</strong></div><div className="preview-context"><span><ServerIcon size={10} /> Production API</span><span><Clock3 size={10} /> {previewRunning ? 'running' : 'waiting'}</span></div><div className="preview-terminal"><header><span>OUTPUT</span><b>All&nbsp;&nbsp; stdout&nbsp;&nbsp; stderr</b></header><div className="preview-logs"><p><i>14:32:08</i><b>01</b><code>Secure SSH session established</code></p><p><i>14:32:09</i><b>02</b><code>$ uptime &amp;&amp; free -m</code></p><p><i>14:32:09</i><b>03</b><code>load average: 0.84, 0.92, 0.76</code></p><p><i>14:32:10</i><b>04</b><code>$ ps aux --sort=-%cpu</code></p><p><i>14:32:10</i><b>05</b><code>node worker.js 31.2% CPU</code></p><span><i /> Receiving output</span></div></div><footer><span><i /> Secure session active</span></footer></div></div>
      </section>
      <section className="landing-status"><span>BUILT FOR CONTROLLED OPERATIONS</span><div /><p>3 servers online</p><div /><p>All commands visible</p><div /><p>Zero hidden execution</p></section>
      <section className="landing-workflow" id="workflow"><div className="landing-section-head"><span className="page-eyebrow">One operational loop</span><h2>From question to verified output.</h2><p>Keep human judgment in the path without slowing down diagnosis.</p></div><div className="capability-grid">{capabilities.map(({ icon: Icon, number, title, copy }) => <article key={number}><div className="capability-top"><i><Icon size={19} /></i><span>{number}</span></div><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
      <section className="landing-security" id="security"><div><span className="page-eyebrow">Security by default</span><h2>Access stays explicit.<br /><em>Actions stay visible.</em></h2></div><div className="security-list"><span><KeyRound size={18} /><b>SSH keys, not saved passwords</b><small>Credentials bootstrap encrypted key-based access.</small></span><span><ShieldCheck size={18} /><b>Approval before execution</b><small>Inspect generated plans and commands before run.</small></span><span><History size={18} /><b>Immutable operational context</b><small>Keep server, output, duration, and result together.</small></span></div></section>
      <section className="landing-cta"><div className="ai-orb"><div className="orb-core" /><div className="orb-ring ring-one" /><div className="orb-ring ring-two" /></div><span className="page-eyebrow">Your infrastructure is talking</span><h2>Ask the right question.</h2><p>Open command center and start with a read-only health check.</p><NavLink to="/chat" className="button dark">Open command center <ArrowRight size={16} /></NavLink></section>
    </main><footer className="landing-footer"><div className="landing-brand"><BrandMark /><span>OpsAI</span></div><p>Human-approved infrastructure operations.</p><span>2026 / NORTHSTAR OPS</span></footer>
  </div>
}

function PricingPage() {
  const [annual, setAnnual] = useState(true)
  const plans = [
    { name: 'Operator', eyebrow: 'For solo builders', monthly: 19, annual: 15, description: 'Essential AI operations for a focused server stack.', features: ['3 connected servers', '150 AI operations / month', 'Approval-first execution', '7-day execution history', 'Community support'] },
    { name: 'Control', eyebrow: 'For production teams', monthly: 59, annual: 47, description: 'Shared control and deeper visibility for live infrastructure.', features: ['15 connected servers', '1,000 AI operations / month', 'Team approval policies', '90-day execution history', 'Priority support'], featured: true },
    { name: 'Fleet', eyebrow: 'For growing platforms', monthly: 149, annual: 119, description: 'Governed operations across larger fleets and environments.', features: ['Unlimited connected servers', '5,000 AI operations / month', 'Custom roles and policies', 'One-year audit retention', 'Dedicated onboarding'] },
  ]
  return <div className="landing-page pricing-page"><nav className="landing-nav"><NavLink to="/" className="landing-brand"><BrandMark /><span>OpsAI</span></NavLink><div className="landing-links"><NavLink to="/">Product</NavLink><NavLink to="/pricing" className="active">Pricing</NavLink></div><NavLink to="/chat" className="button dark">Open workspace <ArrowRight size={15} /></NavLink></nav><main><section className="pricing-hero"><div className="landing-grid" /><div className="eyebrow"><span className="live-dot" /> Simple, operational pricing</div><h1>Control every server.<br /><em>Scale when ready.</em></h1><p>Start with enough capacity to operate confidently. Upgrade as your infrastructure and team grow.</p><div className="billing-toggle" aria-label="Billing period"><button className={!annual ? 'active' : ''} onClick={() => setAnnual(false)}>Monthly</button><button className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>Annual <span>save 20%</span></button></div></section><section className="pricing-grid">{plans.map(plan => <article className={cn('pricing-card', plan.featured && 'featured')} key={plan.name}>{plan.featured && <span className="popular-label">Most operational</span>}<span className="page-eyebrow">{plan.eyebrow}</span><h2>{plan.name}</h2><p>{plan.description}</p><div className="plan-price"><span>$</span><strong>{annual ? plan.annual : plan.monthly}</strong><small>/ user / month</small></div><small className="billing-note">{annual ? 'Billed annually' : 'Billed monthly'}</small><NavLink to="/chat" className={cn('button', plan.featured ? 'accent' : 'secondary')}>Start with {plan.name} <ArrowRight size={14} /></NavLink><div className="plan-features"><span>INCLUDED</span>{plan.features.map(feature => <p key={feature}><Check size={13} /> {feature}</p>)}</div></article>)}</section><section className="pricing-trust"><div><ShieldCheck size={20} /><span><b>Approval-first by default</b><small>No hidden command execution on any plan.</small></span></div><div><KeyRound size={20} /><span><b>Encrypted SSH access</b><small>Passwords never become reusable credentials.</small></span></div><div><Zap size={20} /><span><b>Change plans anytime</b><small>No migration or server reconnection required.</small></span></div></section><section className="pricing-faq"><div><span className="page-eyebrow">Pricing notes</span><h2>Questions before<br />you connect?</h2></div><div>{[['What counts as an AI operation?', 'One approved execution plan counts as one operation, regardless of how many read-only commands it contains.'], ['Can I try OpsAI before paying?', 'Yes. Every workspace starts with a 14-day Control trial and requires no credit card.'], ['Are failed executions charged?', 'No. Connection failures and plans stopped before command execution do not consume usage.'], ['Do you offer custom enterprise terms?', 'Yes. SSO, custom retention, private networking, and volume usage are available by agreement.']].map(([question, answer]) => <details key={question}><summary>{question}<Plus size={15} /></summary><p>{answer}</p></details>)}</div></section><section className="landing-cta pricing-cta"><span className="page-eyebrow">14 days / no credit card</span><h2>Operate with clarity.</h2><p>Connect a server and run your first approved health check.</p><NavLink to="/chat" className="button dark">Start free trial <ArrowRight size={16} /></NavLink></section></main><footer className="landing-footer"><div className="landing-brand"><BrandMark /><span>OpsAI</span></div><p>Human-approved infrastructure operations.</p><span>PRICES IN USD / TAX EXCLUDED</span></footer></div>
}

function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate()
  const register = mode === 'register'
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!email || password.length < 8) return
    setLoading(true)
    window.setTimeout(() => navigate('/chat'), 900)
  }
  return <div className="auth-page"><NavLink to="/" className="auth-brand"><BrandMark /><span>OpsAI</span></NavLink><main className="auth-form-panel"><div className="auth-form-wrap"><span className="page-eyebrow">{register ? 'Create workspace' : 'Welcome back'}</span><h1>{register ? 'Start operating.' : 'Return to control.'}</h1><p>{register ? 'Create your account and connect your first server in minutes.' : 'Sign in to inspect infrastructure and continue active operations.'}</p><button className="auth-sso" onClick={() => openDemo('oauth', 'Continue with Google', 'Choose a demo Google account to continue.')}><span>G</span> Continue with Google</button><div className="auth-divider"><i /> or continue with email <i /></div><form onSubmit={submit}>{register && <><label className="auth-field"><span>Full name</span><div><UserRound size={15} /><input required placeholder="Aria Rahman" autoComplete="name" /></div></label><label className="auth-field"><span>Workspace name</span><div><Boxes size={15} /><input required placeholder="Northstar Ops" /></div></label></>}<label className="auth-field"><span>Email address</span><div><Mail size={15} /><input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" /></div></label><label className="auth-field"><span>Password {register && <small>8+ characters</small>}</span><div><LockKeyhole size={15} /><input required minLength={8} type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" autoComplete={register ? 'new-password' : 'current-password'} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>{!register && <div className="auth-options"><label><input type="checkbox" defaultChecked /> Keep me signed in</label><button type="button" onClick={() => openDemo('reset', 'Reset your password', 'We will send a recovery link.')}>Forgot password?</button></div>}{register && <label className="auth-consent"><input required type="checkbox" /> <span>I agree to the Terms and acknowledge the Privacy Policy.</span></label>}<button className="button dark auth-submit" disabled={loading || !email || password.length < 8}>{loading ? <><span className="tiny-spinner" /> {register ? 'Creating workspace...' : 'Signing in...'}</> : <>{register ? 'Create account' : 'Sign in'} <ArrowRight size={15} /></>}</button></form><p className="auth-switch">{register ? 'Already have an account?' : 'New to OpsAI?'} <NavLink to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</NavLink></p><div className="auth-trust"><ShieldCheck size={13} /> Authentication protected with encrypted sessions</div></div></main><aside className="auth-visual"><div className="auth-grid" /><div className="auth-visual-copy"><div className="ai-orb"><div className="orb-core" /><div className="orb-ring ring-one" /><div className="orb-ring ring-two" /></div><span>CONTROLLED BY DESIGN</span><h2>Every command visible.<br />Every action accountable.</h2><p>AI-assisted server operations with human approval kept in the loop.</p></div><div className="auth-operation"><header><span><i /> LIVE OPERATION</span><b>READ ONLY</b></header><div><i><Check size={12} /></i><span><b>SSH session secured</b><small>production-api / key authenticated</small></span></div><div><i><Check size={12} /></i><span><b>System pressure inspected</b><small>load average within normal range</small></span></div><div className="running"><i><span /></i><span><b>Reading service health</b><small>3 of 4 checks completed</small></span></div><footer><ShieldCheck size={12} /> Approval policy enforced</footer></div><div className="auth-visual-foot"><span>3 SERVERS ONLINE</span><span>ZERO HIDDEN EXECUTION</span></div></aside></div>
}

function App() {
  return <><DemoUIHost /><Routes><Route path="/" element={<LandingPage />} /><Route path="/pricing" element={<PricingPage />} /><Route path="/login" element={<AuthPage mode="login" />} /><Route path="/register" element={<AuthPage mode="register" />} /><Route path="/*" element={<AppShell />} /></Routes></>
}

function StatusPill({ status }: { status: Server['status'] }) {
  return <span className={cn('status-pill', status.toLowerCase())}><i />{status}</span>
}

function ServerPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const selected = servers.find(server => server.id === value) ?? servers[0]
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])
  return <div className={cn('server-picker', open && 'open')} ref={root}><button className="server-picker-trigger" type="button" onClick={() => setOpen(current => !current)} aria-haspopup="listbox" aria-expanded={open}><i className={cn('server-picker-icon', selected.status.toLowerCase())}><ServerIcon size={14} /></i><span><b>{selected.name}</b><small>{selected.environment}</small></span><ChevronDown size={13} /></button>{open && <div className="server-picker-menu" role="listbox"><header><span>Target server</span><small>{servers.filter(server => server.status !== 'Offline').length} available</small></header>{servers.map(server => <button type="button" role="option" aria-selected={server.id === value} disabled={server.status === 'Offline'} className={cn(server.id === value && 'selected')} key={server.id} onClick={() => { onChange(server.id); setOpen(false) }}><i className={cn('server-option-icon', server.status.toLowerCase())}><ServerIcon size={14} /></i><span><b>{server.name}</b><small>{server.host} / {server.environment}</small></span><em><i />{server.status}</em>{server.id === value && <Check size={14} />}</button>)}<footer><ShieldCheck size={12} /> Commands run only on selected server</footer></div>}</div>
}

function Composer({ compact = false, initialServer = 'production-api' }: { compact?: boolean; initialServer?: string }) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [server, setServer] = useState(initialServer)
  const [focused, setFocused] = useState(false)
  const [preview, setPreview] = useState('')
  const [attachmentOpen, setAttachmentOpen] = useState(false)
  const [policyOpen, setPolicyOpen] = useState(false)
  const [attachment, setAttachment] = useState('')
  const [policy, setPolicy] = useState<'Approval required' | 'Read only' | 'Auto execute'>('Approval required')
  const attachmentRoot = useRef<HTMLDivElement>(null)
  const policyRoot = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (compact) return
    const examples = ['Check production server health', 'Find why worker CPU is elevated', 'Review the latest nginx errors', 'Inspect all running containers']
    let exampleIndex = 0
    let characterIndex = 0
    let deleting = false
    let timeout: number
    const type = () => {
      const example = examples[exampleIndex]
      characterIndex += deleting ? -1 : 1
      setPreview(example.slice(0, characterIndex))
      if (!deleting && characterIndex === example.length) {
        deleting = true
        timeout = window.setTimeout(type, 1500)
        return
      }
      if (deleting && characterIndex === 0) {
        deleting = false
        exampleIndex = (exampleIndex + 1) % examples.length
        timeout = window.setTimeout(type, 350)
        return
      }
      timeout = window.setTimeout(type, deleting ? 24 : 48)
    }
    timeout = window.setTimeout(type, 500)
    return () => window.clearTimeout(timeout)
  }, [compact])
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!attachmentRoot.current?.contains(event.target as Node)) setAttachmentOpen(false)
      if (!policyRoot.current?.contains(event.target as Node)) setPolicyOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const submit = () => {
    if (!prompt.trim()) return
    const params = new URLSearchParams({ prompt: prompt.trim(), server, policy })
    if (attachment) params.set('attachment', attachment)
    navigate(`/chat/diagnose?${params}`)
  }
  return <div className={cn('composer', compact && 'compact-composer')}>
    {!compact && !prompt && !focused && <div className="composer-preview" aria-hidden="true"><span>{preview}</span><i /></div>}
    <textarea value={prompt} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} placeholder={compact ? 'Ask a follow-up...' : ''} aria-label="Ask OpsAI" rows={compact ? 1 : 3} />
    {attachment && <div className="composer-attachments"><span><FileCode2 size={13} /><b>{attachment}</b><small>Attached context</small><button onClick={() => setAttachment('')} aria-label="Remove attachment"><X size={12} /></button></span></div>}
    <div className="composer-footer"><div className="composer-tools"><div className="composer-tool-popover" ref={attachmentRoot}><button className={cn('icon-button soft', attachmentOpen && 'active')} onClick={() => { setAttachmentOpen(open => !open); setPolicyOpen(false) }} aria-label="Attach context" aria-expanded={attachmentOpen}><Paperclip size={16} /></button>{attachmentOpen && <div className="tool-menu attachment-menu"><header><span>Attach context</span><small>Optional</small></header><button onClick={() => fileInput.current?.click()}><i><FileCode2 size={15} /></i><span><b>Upload a file</b><small>Logs, config, or text up to 10 MB</small></span></button><button onClick={() => { setAttachment('nginx-error.log'); setAttachmentOpen(false) }}><i><History size={15} /></i><span><b>Latest nginx error log</b><small>Production API / 248 lines</small></span></button><button onClick={() => { setAttachment('docker-compose.yml'); setAttachmentOpen(false) }}><i><Boxes size={15} /></i><span><b>Docker Compose config</b><small>Worker Primary / current version</small></span></button><footer>Files become read-only prompt context.</footer></div>}<input ref={fileInput} className="hidden-file-input" type="file" accept=".txt,.log,.json,.yaml,.yml,.conf" onChange={event => { const file = event.target.files?.[0]; if (file) { setAttachment(file.name); setAttachmentOpen(false) } }} /></div><ServerPicker value={server} onChange={setServer} /><div className="composer-tool-popover" ref={policyRoot}><button className={cn('mode-button', policyOpen && 'active')} onClick={() => { setPolicyOpen(open => !open); setAttachmentOpen(false) }} aria-haspopup="listbox" aria-expanded={policyOpen}><ShieldCheck size={15} /> {policy} <ChevronDown size={13} /></button>{policyOpen && <div className="tool-menu policy-menu" role="listbox"><header><span>Execution policy</span><small>For this chat</small></header>{([['Approval required', 'Review every plan before commands run', ShieldCheck], ['Read only', 'Allow inspection commands without changes', Search], ['Auto execute', 'Run low-risk commands immediately', Zap]] as const).map(([name, description, Icon]) => <button className={policy === name ? 'selected' : ''} key={name} onClick={() => { setPolicy(name); setPolicyOpen(false) }}><i><Icon size={15} /></i><span><b>{name}</b><small>{description}</small></span>{policy === name && <Check size={14} />}</button>)}<footer><AlertTriangle size={12} /> Destructive commands always require approval.</footer></div>}</div></div><button className="send-button" onClick={submit} disabled={!prompt.trim()} aria-label="Send prompt"><ArrowRight size={18} /></button></div>
  </div>
}

function HomePage() {
  const navigate = useNavigate()
  const prompts = [
    { icon: Gauge, text: 'Run a health check on production', meta: 'CPU, memory, disk, services' },
    { icon: AlertTriangle, text: 'Why is the worker CPU so high?', meta: 'Diagnose active processes' },
    { icon: Boxes, text: 'Inspect all running containers', meta: 'Status, health, recent restarts' },
    { icon: FileCode2, text: 'Review the latest nginx errors', meta: 'Read-only log analysis' },
  ]
  return <div className="home-page page-enter">
    <div className="ambient-grid" />
    <section className="hero">
      <div className="ai-orb"><div className="orb-core" /><div className="orb-ring ring-one" /><div className="orb-ring ring-two" /></div>
      <div className="eyebrow"><span className="live-dot" /> 3 servers online</div>
      <h1>What needs attention<br />across your <em>servers?</em></h1>
      <p className="hero-copy">Diagnose incidents, inspect infrastructure, and execute approved commands from one focused workspace.</p>
      <Composer />
      <div className="trust-line"><ShieldCheck size={14} /> Commands stay visible and require approval before execution <span>Ctrl + Enter to send</span></div>
    </section>
    <section className="suggestions"><div className="section-kicker">Start with an operation</div><div className="suggestion-grid">{prompts.map(({ icon: Icon, text, meta }, index) => <button key={text} className="suggestion-card" style={{ animationDelay: `${index * 80 + 200}ms` }} onClick={() => navigate(`/chat/diagnose?prompt=${encodeURIComponent(text)}&server=production-api`)}><div className="suggestion-icon"><Icon size={18} /></div><div><strong>{text}</strong><span>{meta}</span></div><ArrowRight size={16} className="card-arrow" /></button>)}</div></section>
  </div>
}

function ServersPage() {
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [serverList, setServerList] = useState(servers)
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState('All')
  const [grid, setGrid] = useState(false)
  const filtered = serverList.filter(server => `${server.name} ${server.host}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === 'All' || server.status === statusFilter))
  return <div className="content-page page-enter">
    <PageHeading eyebrow="Infrastructure" title="Servers" description="Connected machines, health signals, and access controls." action={<button className="button dark" onClick={() => setShowAdd(true)}><Plus size={17} /> Add server</button>} />
    <div className="stats-strip"><MiniStat label="Connected" value="3" detail="of 4 servers" icon={ServerIcon} /><MiniStat label="Healthy" value="2" detail="1 needs attention" icon={CheckCircle2} /><MiniStat label="Avg. CPU" value="43%" detail="across online hosts" icon={Cpu} /><MiniStat label="Active tasks" value="1" detail="read-only check" icon={Activity} /></div>
    <div className="table-toolbar"><div className="search-field"><Search size={16} /><input placeholder="Search server or host..." value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="filter-control"><button className={cn('button secondary', statusFilter !== 'All' && 'active')} onClick={() => setFilterOpen(value => !value)}><ListFilter size={16} /> {statusFilter === 'All' ? 'Filter' : statusFilter}</button>{filterOpen && <div className="filter-popover">{['All','Healthy','Warning','Offline'].map(item => <button className={statusFilter === item ? 'active' : ''} key={item} onClick={() => { setStatusFilter(item); setFilterOpen(false) }}>{item}{statusFilter === item && <Check size={13} />}</button>)}</div>}</div><button className={cn('icon-button bordered', grid && 'active')} onClick={() => setGrid(value => !value)} aria-label="Toggle server layout"><LayoutGrid size={17} /></button></div>
    <div className={cn('server-list', grid && 'grid-view')}><div className="server-list-head"><span>Server</span><span>Environment</span><span>Resources</span><span>Status</span><span /></div>{filtered.map(server => <ServerRow key={server.id} server={server} />)}</div>
    {showAdd && <AddServerModal close={() => setShowAdd(false)} save={server => { setServerList(current => [...current, server]); setShowAdd(false) }} />}
  </div>
}

function ServerRow({ server }: { server: Server }) {
  const navigate = useNavigate()
  return <button className="server-row" onClick={() => navigate(`/servers/${server.id}`)}><span className="server-identity"><i className={cn('server-glyph', server.status.toLowerCase())}><ServerIcon size={18} /></i><span><strong>{server.name}</strong><small>{server.host} / {server.region}</small></span></span><span><b className={cn('env-tag', server.environment.toLowerCase())}>{server.environment}</b></span><span className="resource-bars"><MetricBar label="CPU" value={server.cpu} /><MetricBar label="MEM" value={server.memory} /></span><StatusPill status={server.status} /><ChevronRight size={17} /></button>
}

function MetricBar({ label, value }: { label: string; value: number }) {
  return <span className="metric-bar"><small>{label}</small><i><b style={{ width: `${value}%` }} /></i><em>{value}%</em></span>
}

function MiniStat({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof ServerIcon }) {
  return <div className="mini-stat"><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div><i><Icon size={18} /></i></div>
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="page-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function AddServerModal({ close, save }: { close: () => void; save: (server: Server) => void }) {
  const [step, setStep] = useState(1)
  const [testing, setTesting] = useState(false)
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('root')
  const [password, setPassword] = useState('')
  const [environment, setEnvironment] = useState<Server['environment']>('Production')
  const ready = Boolean(name.trim() && host.trim() && port.trim() && username.trim() && password)
  const next = () => {
    if (step === 3) {
      save({ id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`, name: name.trim(), host: host.trim(), environment, status: 'Healthy', cpu: 0, memory: 0, disk: 0, region: `SSH :${port}`, uptime: 'just added' })
      return
    }
    setTesting(true)
    window.setTimeout(() => {
      if (step === 2) setPassword('')
      setTesting(false)
      setStep(current => current + 1)
    }, 1400)
  }
  return createPortal(<div className="modal-layer"><button className="modal-scrim" onClick={close} aria-label="Close" /><div className="modal-card">
    <div className="modal-header"><div><span className="page-eyebrow">Secure connection</span><h2>Add a server</h2></div><button className="icon-button" onClick={close}><X size={19} /></button></div>
    <div className="stepper">{['Password login', 'Install SSH key', 'Key login ready'].map((label, index) => <div className={cn('step', step >= index + 1 && 'active')} key={label}><i>{step > index + 1 ? <Check size={13} /> : index + 1}</i><span>{label}</span></div>)}</div>
    <div className="modal-body">
      {step === 1 && <div className="form-grid"><Field label="Server name" placeholder="Production API" value={name} onChange={setName} /><Field label="Hostname or IP" placeholder="203.0.113.10" value={host} onChange={setHost} /><Field label="SSH port" placeholder="22" value={port} onChange={setPort} inputMode="numeric" /><label className="field"><span>Environment</span><select value={environment} onChange={event => setEnvironment(event.target.value as Server['environment'])}><option>Production</option><option>Staging</option><option>Development</option></select></label><Field label="SSH username" placeholder="root" value={username} onChange={setUsername} /><Field label="SSH password" placeholder="Enter password" value={password} onChange={setPassword} type="password" /><div className="security-note full"><ShieldCheck size={18} /><span><strong>Password used once</strong>Password is only used for initial login and key installation. It must not be saved as a reusable session credential.</span></div></div>}
      {step === 2 && <div className="connection-result"><div className="success-seal"><KeyRound size={25} /></div><h3>SSH key installed</h3><p>Public key added to <code>~/.ssh/authorized_keys</code> for {username}@{host}:{port}.</p><div className="check-list"><span><Check size={15} /> Password login passed</span><span><Check size={15} /> Key pair generated</span><span><Check size={15} /> Public key installed</span><span><Check size={15} /> Private key secured</span></div><div className="security-note"><ShieldCheck size={18} /><span><strong>Verify before saving</strong>Next step tests a fresh login with the generated key. Password is discarded after verification.</span></div></div>}
      {step === 3 && <div className="connection-result"><div className="success-seal"><Check size={26} /></div><h3>Key login verified</h3><p>Future connections will authenticate with the saved SSH key, not the password.</p><div className="check-list"><span><Check size={15} /> Host fingerprint trusted</span><span><Check size={15} /> Key authenticated</span><span><Check size={15} /> Password discarded</span><span><Check size={15} /> Auto-login ready</span></div></div>}
      {testing && <div className="testing-overlay"><div className="spinner" /><strong>{step === 1 ? 'Connecting and installing key...' : 'Verifying key login...'}</strong><span>{step === 1 ? `Authenticating ${username}@${host}:${port}` : 'Opening a fresh SSH connection without password'}</span></div>}
    </div>
    <div className="modal-footer"><button className="button secondary" onClick={step === 1 ? close : () => setStep(step - 1)}>{step === 1 ? 'Cancel' : 'Back'}</button><button className="button dark" onClick={next} disabled={testing || (step === 1 && !ready)}>{step === 1 ? 'Connect & install key' : step === 2 ? 'Verify key login' : 'Save server'} <ArrowRight size={16} /></button></div>
  </div></div>, document.body)
}

function Field({ label, placeholder, value, onChange, type = 'text', inputMode }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: 'numeric' }) {
  return <label className="field"><span>{label}</span><input placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} type={type} inputMode={inputMode} /></label>
}

function ServerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const server = servers.find(item => item.id === id) ?? servers[0]
  const [tab, setTab] = useState('Overview')
  const [checking, setChecking] = useState(false)
  const [serviceMenu, setServiceMenu] = useState('')
  const runCheck = () => { setChecking(true); window.setTimeout(() => { setChecking(false); showToast('Health check completed: all systems operational') }, 1300) }
  return <div className="content-page server-detail-page page-enter"><button className="back-link" onClick={() => navigate('/servers')}><ArrowLeft size={15} /> All servers</button>
    <section className="server-overview-card"><div className="server-detail-head"><div className="server-title"><i className={cn('server-glyph', server.status.toLowerCase())}><ServerIcon size={22} /></i><div><div className="title-line"><h1>{server.name}</h1><StatusPill status={server.status} /></div><p>{server.host}</p></div></div><div className="heading-actions"><button className="button secondary" onClick={() => openDemo('console', `Console / ${server.name}`, `deploy@${server.host}`)}><Terminal size={16} /> Open console</button><button className="button dark" onClick={() => navigate(`/chat/health?server=${server.id}`)}><Sparkles size={16} /> Ask OpsAI</button></div></div><div className="server-facts"><div><span>Environment</span><b className={cn('env-tag', server.environment.toLowerCase())}>{server.environment}</b></div><div><span>Region</span><b>{server.region}</b></div><div><span>Operating system</span><b>Ubuntu 24.04 LTS</b></div><div><span>Uptime</span><b>{server.uptime}</b></div><div><span>SSH access</span><b className="verified-access"><ShieldCheck size={13} /> Key verified</b></div></div></section>
    <div className="detail-tabs">{['Overview','Metrics','Services','Executions','SSH access'].map(item => <button className={tab === item ? 'active' : ''} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>
    {tab === 'Overview' && <><div className="health-banner"><div><span className="pulse-icon">{checking ? <span className="tiny-spinner" /> : <Activity size={17} />}</span><div><strong>{checking ? 'Checking system health...' : 'All systems operational'}</strong><p>{checking ? 'Inspecting services and resources' : '4 critical services active. Last checked just now.'}</p></div></div><button onClick={runCheck} disabled={checking}>Run health check <ArrowRight size={15} /></button></div><div className="detail-section-head"><div><span className="page-eyebrow">Live resources</span><h2>System utilization</h2></div><span><i /> Updated just now</span></div><div className="metric-grid"><ResourceCard label="CPU usage" value={`${server.cpu}%`} detail="8 cores / 2.7 GHz" icon={Cpu} points={[20,32,28,49,35,39,31,34]} /><ResourceCard label="Memory" value={`${server.memory}%`} detail="9.9 of 16 GB" icon={MemoryStick} points={[48,52,49,57,60,58,64,62]} /><ResourceCard label="Disk usage" value={`${server.disk}%`} detail="115 of 240 GB" icon={HardDrive} points={[30,31,34,36,39,42,45,48]} /></div><div className="detail-columns"><ServicePanel setTab={setTab} serviceMenu={serviceMenu} setServiceMenu={setServiceMenu} /><ActivityPanel /></div></>}
    {tab === 'Metrics' && <div className="tab-demo-content"><PageHeading eyebrow="Observability" title="Resource metrics" description="Historical utilization for this server." /><div className="metric-grid"><ResourceCard label="CPU usage" value={`${server.cpu}%`} detail="8 cores / 2.7 GHz" icon={Cpu} points={[12,25,22,52,37,45,31,34]} /><ResourceCard label="Memory" value={`${server.memory}%`} detail="9.9 of 16 GB" icon={MemoryStick} points={[38,45,49,52,60,58,64,62]} /><ResourceCard label="Disk I/O" value="18 MB/s" detail="read + write" icon={HardDrive} points={[15,18,24,20,31,27,38,33]} /></div></div>}
    {tab === 'Services' && <div className="tab-demo-content"><ServicePanel setTab={setTab} serviceMenu={serviceMenu} setServiceMenu={setServiceMenu} full /></div>}
    {tab === 'Executions' && <div className="tab-demo-content execution-table"><div className="execution-table-head"><span>Operation</span><span>Server</span><span>Status</span><span>Duration</span><span>Created</span></div>{['Health and resource inspection','Inspect nginx logs','Check failed services'].map((name,index)=><div className="execution-table-row" key={name}><span><i><Terminal size={16}/></i><span><strong>{name}</strong><small>OpsAI execution</small></span></span><span>{server.name}</span><span><b className="table-status"><i/>Succeeded</b></span><span>{[4.2,2.8,1.4][index]}s</span><span>{index+1}h ago</span></div>)}</div>}
    {tab === 'SSH access' && <div className="tab-demo-content ssh-access-card"><KeyRound size={24}/><div><span className="page-eyebrow">Managed key</span><h2>SSH access verified</h2><p>SHA256:8mP3gR4nM2Y8xQwA9pK7LzVb2cD6eF1hJ5sT0uN4</p></div><button className="button secondary" onClick={() => openDemo('edit','Rotate managed key','90-day rotation policy')}>Rotate key</button></div>}
  </div>
}

function ServicePanel({ setTab, serviceMenu, setServiceMenu, full = false }: { setTab: (tab: string) => void; serviceMenu: string; setServiceMenu: (name: string) => void; full?: boolean }) {
  return <section className={cn('panel', full && 'full-panel')}><div className="panel-head"><div><span className="page-eyebrow">Runtime</span><h3>Services</h3><p>Processes monitored on this host</p></div>{!full && <button className="text-button" onClick={() => setTab('Services')}>View all</button>}</div>{['nginx', 'api.service', 'postgresql', 'redis-server'].map((name, index) => <div className="service-row" key={name}><i className="service-icon"><Boxes size={16} /></i><span><strong>{name}</strong><small>{index === 0 ? 'v1.26.1 / port 443' : index === 1 ? 'Node.js / 4 workers' : index === 2 ? 'v16.3 / port 5432' : 'v7.2 / port 6379'}</small></span><b><i /> Active</b><div className="row-menu"><button className="row-action" onClick={() => setServiceMenu(serviceMenu === name ? '' : name)} aria-label={`Actions for ${name}`}><MoreHorizontal size={17} /></button>{serviceMenu === name && <div><button onClick={() => openDemo('console', `${name} logs`, 'Last 100 lines')}>View logs</button><button onClick={() => openDemo('edit', `Inspect ${name} config`, '/etc/systemd/system')}>Inspect config</button><button onClick={() => { setServiceMenu(''); openDemo('restart', 'Restart service', name) }}>Restart service</button></div>}</div></div>)}</section>
}

function ActivityPanel() {
  return <section className="panel"><div className="panel-head"><div><span className="page-eyebrow">Timeline</span><h3>Recent activity</h3><p>Latest changes and automated checks</p></div><button className="text-button" onClick={() => openDemo('audit','Audit log','Complete workspace activity')}>Audit log</button></div>{['Health check completed', 'Configuration read by OpsAI', 'SSH key rotated', 'Deployment completed'].map((name, index) => <div className="activity-row" key={name}><i>{index === 0 ? <Check size={14} /> : index === 1 ? <Bot size={14} /> : index === 2 ? <KeyRound size={14} /> : <Clock3 size={14} />}</i><span><strong>{name}</strong><small>{['18 seconds ago', '12 minutes ago', 'Yesterday, 09:42', 'Aug 17, 16:08'][index]}</small></span><em>{['System', 'OpsAI', 'Security', 'Deploy'][index]}</em></div>)}</section>
}

function ResourceCard({ label, value, detail, icon: Icon, points }: { label: string; value: string; detail: string; icon: typeof Cpu; points: number[] }) {
  const polyline = points.map((point, index) => `${index * 38},${70 - point * .65}`).join(' ')
  const gradientId = `fill-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return <div className="resource-card"><div className="resource-card-top"><span><i><Icon size={17} /></i>{label}</span><em>Last 30 min</em></div><div className="resource-value"><strong>{value}</strong><small>{detail}</small></div><svg className="resource-chart" viewBox="0 0 266 70" preserveAspectRatio="none"><defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7657ff" stopOpacity=".22"/><stop offset="1" stopColor="#7657ff" stopOpacity="0"/></linearGradient></defs><polygon points={`0,70 ${polyline} 266,70`} fill={`url(#${gradientId})`} /><polyline points={polyline} fill="none" stroke="#7657ff" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg></div>
}

function ThreadPage() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const prompt = params.get('prompt') || 'Check production health and investigate elevated worker CPU.'
  const serverId = params.get('server') || 'production-api'
  const policy = params.get('policy') || 'Approval required'
  const attachment = params.get('attachment')
  const server = servers.find(item => item.id === serverId) ?? servers[0]
  const [logCount, setLogCount] = useState(1)
  const [complete, setComplete] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [threadMenu, setThreadMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const [terminalMinimized, setTerminalMinimized] = useState(false)
  useEffect(() => {
    if (stopped) return
    let timeout: number
    const stream = (count: number) => {
      if (count >= executionLogs.length) { setComplete(true); return }
      timeout = window.setTimeout(() => { const next = count + 1; setLogCount(next); stream(next) }, executionLogs[count].delay)
    }
    stream(1)
    return () => window.clearTimeout(timeout)
  }, [stopped])
  const progress = Math.round((logCount / executionLogs.length) * 100)
  return <div className={cn('thread-layout page-enter', terminalMinimized && 'terminal-minimized')}><section className="thread-main"><div className="thread-header"><div><span className="page-eyebrow">AI operation</span><h2>Diagnose server health</h2></div><div className="thread-header-status"><span className="connected"><i /> Connected</span><div className="thread-menu"><button className="icon-button bordered" onClick={() => setThreadMenu(value => !value)} aria-label="Thread actions"><MoreHorizontal size={18} /></button>{threadMenu && <div><button onClick={() => openDemo('edit','Rename thread','Diagnose server health')}>Rename thread</button><button onClick={() => showToast('Thread duplicated')}>Duplicate</button><button onClick={() => showToast('Thread archived')}>Archive</button><button className="danger" onClick={() => openDemo('restart','Delete thread','Diagnose server health')}>Delete</button></div>}</div></div></div>
    <div className="conversation"><div className="chat-history-marker"><span>Today</span></div><div className="message user-message history-message"><div className="message-avatar">AR</div><div><div className="message-meta"><strong>You</strong><span>8 min ago</span></div><p>Give me a quick status summary for {server.name}.</p><span className="target-chip"><ServerIcon size={13} /> {server.name}</span></div></div><div className="message ai-message history-message"><div className="message-avatar ai"><Sparkles size={16} /></div><div><div className="message-meta"><strong>OpsAI</strong><span>completed</span></div><p>Server is online with normal memory and disk usage. Worker CPU remains above its 15-minute baseline.</p><div className="result-tags"><span>Online</span><span>Memory normal</span><span>CPU elevated</span></div></div></div><div className="message user-message"><div className="message-avatar">AR</div><div><div className="message-meta"><strong>You</strong><span>just now</span></div><p>{prompt}</p><div className="message-context"><span className="target-chip"><ServerIcon size={13} /> {server.name}</span><span className="target-chip"><ShieldCheck size={13} /> {policy}</span>{attachment && <span className="target-chip"><FileCode2 size={13} /> {attachment}</span>}</div></div></div>
    <div className="message ai-message"><div className="message-avatar ai"><Sparkles size={16} /></div><div className="message-content"><div className="message-meta"><strong>OpsAI</strong><span>{stopped ? 'stopped' : complete ? 'completed' : 'working...'}</span></div><p>I'll inspect system load, memory pressure, top processes, and service health. Approved read-only plan is running now.</p>
      <div className="operation-progress"><div><span>{stopped ? 'Operation stopped' : complete ? 'Operation complete' : 'Running diagnostics'}</span><b>{progress}%</b></div><i><b style={{ width: `${progress}%` }} /></i><small>{stopped ? 'Stopped by user' : complete ? '4 of 4 steps completed' : `${Math.min(4, Math.ceil(logCount / 3))} of 4 steps in progress`}</small></div><div className="plan-card"><div className="plan-head"><div><i><Command size={17} /></i><span><strong>Execution plan</strong><small>4 steps / read-only / ~30 sec</small></span></div><span className="risk-badge"><ShieldCheck size={13} /> Approved</span></div><div className="plan-steps">{['Check system uptime and resource pressure', 'Find processes consuming the most CPU', 'Inspect critical service status', 'Summarize findings and recommend action'].map((step, index) => <div key={step} className={cn((complete || index < Math.floor(progress / 25)) && 'done', !complete && !stopped && index === Math.min(3, Math.floor(progress / 25)) && 'running')}><i>{complete || index < Math.floor(progress / 25) ? <Check size={13} /> : index + 1}</i><span>{step}</span>{!complete && !stopped && index === Math.min(3, Math.floor(progress / 25)) && <b>Running</b>}</div>)}</div><div className="command-preview"><div><span>3 commands</span><button onClick={() => { navigator.clipboard?.writeText('uptime && free -m\nps aux --sort=-%cpu | head -n 6\nsystemctl --failed --no-pager'); setCopied(true); showToast('Commands copied'); window.setTimeout(() => setCopied(false),1500) }}><Copy size={13} /> {copied ? 'Copied' : 'Copy'}</button></div><code>uptime && free -m<br/>ps aux --sort=-%cpu | head -n 6<br/>systemctl --failed --no-pager</code></div></div>
      {complete && <div className="result-card"><div className="result-icon"><CheckCircle2 size={20} /></div><div><strong>Health check complete</strong><p>Server is stable. Elevated CPU comes from <code>node dist/worker.js</code>, currently using 31.2%. No failed services found. Memory remains within operating range.</p><div className="result-tags"><span>CPU stable</span><span>Services healthy</span><span>No action required</span></div></div></div>}
    </div></div></div><div className="thread-composer"><Composer compact initialServer={server.id} /></div></section>
    <button className="terminal-edge-toggle" onClick={() => setTerminalMinimized(value => !value)} aria-label={terminalMinimized ? 'Open terminal preview' : 'Hide terminal preview'}><Terminal size={14} /><ChevronRight size={12} /></button>
    {!terminalMinimized && <ExecutionPanel active logs={executionLogs.slice(0, logCount)} complete={complete} server={server} stopped={stopped} onStop={() => { setStopped(true); setComplete(true); showToast('Execution stopped by user') }} />}
  </div>
}

function ExecutionPanel({ active, logs, complete, server, stopped, onStop }: { active: boolean; logs: typeof executionLogs; complete: boolean; server: Server; stopped: boolean; onStop: () => void }) {
  const terminalEnd = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState<'session' | 'stderr'>('session')
  const [menu, setMenu] = useState(false)
  useEffect(() => { terminalEnd.current?.scrollIntoView({ block: 'end' }) }, [logs.length])
  const download = () => { const url = URL.createObjectURL(new Blob([logs.map(log => `${log.time} ${log.text}`).join('\n')], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = 'execution-log.txt'; link.click(); URL.revokeObjectURL(url); showToast('Execution log downloaded') }
  return <aside className="execution-panel"><div className="execution-head"><div><span className={cn('execution-state', active && !complete && 'running', complete && 'complete')}><i />{!active ? 'Waiting' : stopped ? 'Stopped' : complete ? 'Completed' : 'Live'}</span><h3>SSH terminal</h3></div><div><button className="icon-button" onClick={download} aria-label="Download log"><Download size={16} /></button><div className="terminal-menu"><button className="icon-button" onClick={() => setMenu(value=>!value)} aria-label="Terminal actions"><MoreHorizontal size={17} /></button>{menu && <div><button onClick={() => { navigator.clipboard?.writeText('sess_demo_7f92'); showToast('Session ID copied') }}>Copy session ID</button><button onClick={() => showToast('Line wrapping toggled')}>Wrap lines</button><button onClick={() => showToast('Terminal view cleared')}>Clear view</button></div>}</div></div></div><div className="execution-context"><span><ServerIcon size={14} /> deploy@{server.host}</span><span><Clock3 size={14} /> {complete ? '3.8s' : active ? 'connected' : 'not started'}</span></div>
    {!active ? <div className="terminal-empty"><div><Terminal size={22} /></div><strong>Waiting for approval</strong><p>Live output will appear here after the execution plan is approved.</p></div> : <div className="terminal"><div className="terminal-toolbar"><span>SSH / PTY</span><div><button className={filter==='session'?'active':''} onClick={()=>setFilter('session')}>session</button><button className={filter==='stderr'?'active':''} onClick={()=>setFilter('stderr')}>stderr</button></div></div>{filter === 'stderr' ? <div className="terminal-filter-empty"><CheckCircle2 size={22}/><strong>No stderr output</strong><span>Session has not reported any errors.</span></div> : <div className="terminal-lines">{logs.map((log, index) => <div className={cn('log-line', log.type)} key={`${log.time}-${index}`}><span className="log-time">{log.time}</span><code>{log.text || ' '}</code>{!complete && index === logs.length - 1 && <i className="inline-cursor" />}</div>)}<div ref={terminalEnd} /></div>}</div>}
    {active && <div className="execution-foot"><span>{stopped ? <><Square size={13}/> Stopped by user</> : complete ? <><CheckCircle2 size={15} /> Exit code 0</> : <><span className="tiny-spinner" /> Secure session active</>}</span>{!complete && <button onClick={onStop}><Square size={12} fill="currentColor" /> Stop</button>}</div>}
  </aside>
}

function ExecutionsPage() {
  return <div className="content-page page-enter"><PageHeading eyebrow="Operations" title="Executions" description="Every command, approval, and output in one immutable timeline." /><div className="stats-strip three"><MiniStat label="Last 24 hours" value="18" detail="executions" icon={Terminal} /><MiniStat label="Success rate" value="94%" detail="17 succeeded" icon={CheckCircle2} /><MiniStat label="Avg. duration" value="8.4s" detail="all servers" icon={Clock3} /></div><div className="execution-table"><div className="execution-table-head"><span>Operation</span><span>Server</span><span>Status</span><span>Duration</span><span>Created</span></div>{['Health and resource inspection', 'Inspect nginx error logs', 'Restart worker service', 'Check failed systemd units', 'List Docker containers'].map((name, index) => <div className="execution-table-row" key={name}><span><i><Terminal size={16} /></i><span><strong>{name}</strong><small>{index === 2 ? 'Manual command' : 'OpsAI execution'}</small></span></span><span>{index % 2 ? 'Worker Primary' : 'Production API'}</span><span><b className={cn('table-status', index === 2 && 'failed')}><i />{index === 2 ? 'Failed' : 'Succeeded'}</b></span><span>{[4.2, 2.8, 1.1, 3.6, 0.8][index]}s</span><span>{index === 0 ? '2 min ago' : `${index + 1}h ago`}</span></div>)}</div></div>
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <button className={cn('setting-toggle', checked && 'active')} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><i /></button>
}

function SettingsPage() {
  const [tab, setTab] = useState('General')
  const [approval, setApproval] = useState(true)
  const [notifyFailure, setNotifyFailure] = useState(true)
  const [notifyComplete, setNotifyComplete] = useState(false)
  const [hostCheck, setHostCheck] = useState(true)
  const [saved, setSaved] = useState(false)
  const save = () => { setSaved(true); window.setTimeout(() => setSaved(false), 1800) }
  return <div className="account-page page-enter"><div className="account-heading"><div><span className="page-eyebrow">Workspace control</span><h1>Settings</h1><p>Configure how Northstar Ops connects, approves, and reports.</p></div><button className="button dark" onClick={save}>{saved ? <><Check size={15} /> Saved</> : 'Save changes'}</button></div><div className="account-layout"><aside className="account-tabs">{['General', 'Execution', 'Notifications', 'Security'].map(item => <button className={tab === item ? 'active' : ''} onClick={() => setTab(item)} key={item}>{item}</button>)}</aside><section className="account-content">
    {tab === 'General' && <><SettingsSection title="Workspace" description="Identity and regional defaults for this operational workspace."><div className="settings-form two"><label><span>Workspace name</span><input defaultValue="Northstar Ops" /></label><label><span>Default region</span><select defaultValue="Singapore (SGP)"><option>Singapore (SGP)</option><option>Frankfurt (FRA)</option><option>US East (IAD)</option></select></label><label className="wide"><span>Workspace slug</span><div className="input-prefix"><i>opsai.cloud/</i><input defaultValue="northstar-ops" /></div></label></div></SettingsSection><SettingsSection title="Interface" description="Set defaults for dates, logs, and operational output."><div className="settings-form two"><label><span>Timezone</span><select defaultValue="Asia/Jakarta"><option>Asia/Jakarta</option><option>Asia/Singapore</option><option>UTC</option></select></label><label><span>Log density</span><select defaultValue="Comfortable"><option>Comfortable</option><option>Compact</option></select></label></div></SettingsSection></>}
    {tab === 'Execution' && <><SettingsSection title="Approval policy" description="Control when generated commands need human confirmation."><SettingRow icon={ShieldCheck} title="Require approval" description="Every execution plan waits for explicit approval before SSH commands run." control={<Toggle checked={approval} onChange={setApproval} />} /><SettingRow icon={Clock3} title="Approval timeout" description="Pending plans expire automatically after this period." control={<select defaultValue="15 minutes"><option>15 minutes</option><option>30 minutes</option><option>1 hour</option></select>} /></SettingsSection><SettingsSection title="Command guardrails" description="Workspace-wide restrictions applied before execution."><SettingRow icon={Terminal} title="Default mode" description="Start every new operation in read-only mode." control={<span className="setting-badge">Read only</span>} /><SettingRow icon={AlertTriangle} title="Blocked patterns" description="Destructive commands require elevated policy approval." control={<button className="text-button" onClick={() => openDemo('rules','Command guardrails','12 workspace rules')}>Manage 12 rules</button>} /></SettingsSection></>}
    {tab === 'Notifications' && <><SettingsSection title="Operational alerts" description="Choose which execution events reach your team."><SettingRow icon={AlertTriangle} title="Failed executions" description="Notify workspace members when an operation exits with an error." control={<Toggle checked={notifyFailure} onChange={setNotifyFailure} />} /><SettingRow icon={CheckCircle2} title="Completed executions" description="Notify when approved operations finish successfully." control={<Toggle checked={notifyComplete} onChange={setNotifyComplete} />} /></SettingsSection><SettingsSection title="Delivery" description="Routes used for workspace notifications."><SettingRow icon={Bell} title="Email digest" description="Daily summary sent to arya@northstar.dev at 09:00." control={<button className="text-button" onClick={() => openDemo('email','Configure email digest','Daily operational summary')}>Configure</button>} /><SettingRow icon={Zap} title="Slack" description="No channel connected yet." control={<button className="button secondary compact" onClick={() => openDemo('oauth','Connect Slack','Route alerts to your team channel')}>Connect</button>} /></SettingsSection></>}
    {tab === 'Security' && <><SettingsSection title="SSH security" description="Policies used when servers establish trusted access."><SettingRow icon={ShieldCheck} title="Strict host verification" description="Reject connections when a known host fingerprint changes." control={<Toggle checked={hostCheck} onChange={setHostCheck} />} /><SettingRow icon={KeyRound} title="Key rotation" description="Rotate managed workspace keys every 90 days." control={<select defaultValue="90 days"><option>30 days</option><option>90 days</option><option>180 days</option></select>} /></SettingsSection><SettingsSection title="Data retention" description="Control operational evidence stored in this workspace."><SettingRow icon={History} title="Execution history" description="Plans, commands, and output are retained for audit." control={<select defaultValue="90 days"><option>30 days</option><option>90 days</option><option>1 year</option></select>} /><SettingRow icon={Database} title="Export workspace data" description="Generate an encrypted archive of workspace records." control={<button className="button secondary compact" onClick={() => openDemo('download','Export workspace data','opsai-workspace-export.zip')}><Download size={14} /> Export</button>} /></SettingsSection></>}
  </section></div></div>
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="settings-section"><header><h2>{title}</h2><p>{description}</p></header><div>{children}</div></section>
}

function SettingRow({ icon: Icon, title, description, control }: { icon: typeof Settings; title: string; description: string; control: React.ReactNode }) {
  return <div className="setting-row"><i><Icon size={16} /></i><span><b>{title}</b><small>{description}</small></span><div>{control}</div></div>
}

function ProfilePage() {
  const [saved, setSaved] = useState(false)
  const save = () => { setSaved(true); window.setTimeout(() => setSaved(false), 1800) }
  return <div className="account-page profile-page page-enter"><div className="account-heading"><div><span className="page-eyebrow">Personal account</span><h1>Profile</h1><p>Manage your identity and personal operational preferences.</p></div><button className="button dark" onClick={save}>{saved ? <><Check size={15} /> Saved</> : 'Save profile'}</button></div><div className="profile-grid"><section className="profile-identity"><div className="profile-avatar">AR<button aria-label="Change avatar" onClick={() => openDemo('avatar','Choose profile image','Select a preset or upload an image.')}><UserRound size={13} /></button></div><h2>Aria Rahman</h2><p>Platform engineer</p><span><i /> Active now</span><div className="profile-meta"><p><small>WORKSPACE ROLE</small><b>Owner</b></p><p><small>MEMBER SINCE</small><b>February 2026</b></p><p><small>LAST SIGN IN</small><b>Today, 14:18</b></p></div></section><div className="profile-main"><SettingsSection title="Personal information" description="Used in approvals, execution history, and team activity."><div className="settings-form two"><label><span>Full name</span><input defaultValue="Aria Rahman" /></label><label><span>Display name</span><input defaultValue="Aria" /></label><label><span>Email address</span><input type="email" defaultValue="arya@northstar.dev" /></label><label><span>Job title</span><input defaultValue="Platform engineer" /></label></div></SettingsSection><SettingsSection title="Preferences" description="Personal defaults applied only to your account."><div className="settings-form two"><label><span>Timezone</span><select defaultValue="Asia/Jakarta"><option>Asia/Jakarta</option><option>Asia/Singapore</option><option>UTC</option></select></label><label><span>Command output</span><select defaultValue="Detailed"><option>Detailed</option><option>Condensed</option></select></label></div></SettingsSection><SettingsSection title="Account security" description="Authentication and active access to your account."><SettingRow icon={KeyRound} title="Password" description="Last changed 42 days ago." control={<button className="text-button" onClick={() => openDemo('password','Change password','Protect your account with a new password.')}>Change password</button>} /><SettingRow icon={ShieldCheck} title="Two-factor authentication" description="Authenticator app protects this account." control={<span className="setting-badge success">Enabled</span>} /><SettingRow icon={Terminal} title="Active sessions" description="2 browsers currently signed in." control={<button className="text-button" onClick={() => openDemo('sessions','Active sessions','Review devices signed into your account.')}>Review sessions</button>} /></SettingsSection></div></div></div>
}

function PlaceholderPage() {
  return <div className="placeholder-page"><div className="placeholder-icon"><Database size={24} /></div><span className="page-eyebrow">Workspace module</span><h1>Coming into focus</h1><p>This surface is prepared for backend integration in the next product phase.</p><NavLink to="/chat" className="button dark">Back to command center</NavLink></div>
}

export default App
