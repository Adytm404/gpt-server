import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, Bell, Bot, Boxes, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Command, Copy, Cpu, Database, Download,
  Eye, EyeOff, FileCode2, Gauge, HardDrive, History, KeyRound, LayoutGrid, ListFilter, LockKeyhole, Mail, MemoryStick,
  CreditCard, FileClock, Layers3, LogOut, Menu, MessageSquare, MoreHorizontal, Paperclip, Play, Plus, Search, Send, Server as ServerIcon,
  Settings, ShieldCheck, Sparkles, Square, Terminal, UserRound, Users, X, Zap,
} from 'lucide-react'
import { servers, type Server } from './data'
import AdminConsole from './admin/AdminConsole'
import { clearSessionCache, SessionProvider, useSession } from './auth/SessionContext'
import { API_URL } from './api/client'
import ApiPricingPage from './pricing/PricingPage'
import { ServersPage as ApiServersPage, ServerDetailPage as ApiServerDetailPage } from './servers/ServersPages'
import { ChatHomePage, ChatThreadPage, ChatThreadsProvider, ExecutionsPage as ApiExecutionsPage, RecentChats, WorkspaceAIUsage } from './chat/ChatPages'
import { SettingsPage, ProfilePage } from './settings/SettingsPages'
import ManageSubscriptionModal from './settings/ManageSubscriptionModal'
import { GoogleAuthCallback } from './auth/GoogleAuthCallback'
import VerifyEmailPage from './auth/VerifyEmailPage'
import { ForgotPasswordPage, ResetPasswordPage } from './auth/PasswordResetPages'
import CheckoutPage from './checkout/CheckoutPage'
import PaymentResultPage from './checkout/PaymentResultPage'
import { adminApi } from './api/admin'

const cn = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ')

async function apiError(response: Response) {
  try {
    const body = await response.json() as { error?: string; message?: string }
    return body.error || body.message || `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}

function csrfToken() {
  const name = 'opsai_csrf'
  const value = document.cookie.split('; ').find(cookie => cookie.startsWith(`${name}=`))?.slice(name.length + 1)
  return value ? decodeURIComponent(value) : ''
}

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
  if (action.kind === 'password') return <div className="demo-form"><label>Current password<input type="password" placeholder="Current password" /></label><label>New password<input type="password" minLength={12} placeholder="12+ characters" /></label><label>Confirm password<input type="password" minLength={12} placeholder="Repeat new password" /></label></div>
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
  { to: '/dashboard/chat', icon: MessageSquare, label: 'Chat' },
  { to: '/dashboard/servers', icon: ServerIcon, label: 'Servers' },
  { to: '/dashboard/executions', icon: Terminal, label: 'Executions' },
  { to: '/dashboard/pricing', icon: CreditCard, label: 'Pricing' },
]

function SidebarProfileMenu({
  initials,
  session,
  loggingOut,
  onLogout,
  admin = false,
  onNavigate,
}: {
  initials: string
  session: ReturnType<typeof useSession>['session']
  loggingOut: boolean
  onLogout: () => void
  admin?: boolean
  onNavigate: () => void
}) {
  const [open, setOpen] = useState(false)
  const [manageSubOpen, setManageSubOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [])

  return (
    <div className="sidebar-profile-container" ref={menuRef}>
      <button
        type="button"
        className="profile-link"
        aria-label="User menu"
        aria-expanded={open}
        onClick={() => setOpen(val => !val)}
      >
        <span className="avatar">{initials}</span>
        <span>
          <b>{session?.user.full_name || 'Account'}</b>
          <small>{admin ? 'Platform administrator' : session?.workspace.role ? `Workspace ${session.workspace.role}` : session?.user.email}</small>
        </span>
        <ChevronRight size={14} className={cn('profile-arrow', open && 'open')} />
      </button>

      {open && (
        <div className="profile-dropdown-menu" role="menu">
          <div className="profile-dropdown-header">
            <strong>{session?.user.full_name || 'Account'}</strong>
            <small>{session?.user.email}</small>
          </div>
          <button
            type="button"
            className="profile-dropdown-item"
            onClick={() => {
              setOpen(false)
              setManageSubOpen(true)
            }}
          >
            <CreditCard size={14} /> Manage subscription
          </button>
          <NavLink
            to="/dashboard/profile"
            className="profile-dropdown-item"
            onClick={() => {
              setOpen(false)
              onNavigate()
            }}
          >
            <UserRound size={14} /> Profile
          </NavLink>
          <NavLink
            to="/dashboard/settings"
            className="profile-dropdown-item"
            onClick={() => {
              setOpen(false)
              onNavigate()
            }}
          >
            <Settings size={14} /> Workspace settings
          </NavLink>
          <button
            type="button"
            className="profile-dropdown-item"
            onClick={() => {
              setOpen(false)
              openDemo('help', 'Help & resources', 'Find guidance without leaving your workspace.')
            }}
          >
            <CircleHelp size={14} /> Help & resources
          </button>
          <NavLink
            to="/login"
            className="profile-dropdown-item"
            onClick={() => {
              setOpen(false)
              onNavigate()
            }}
          >
            <Users size={14} /> Switch account
          </NavLink>
          <button
            type="button"
            className="profile-dropdown-item danger"
            disabled={loggingOut}
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
          >
            <LogOut size={14} /> {loggingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      )}

      {manageSubOpen && (
        <ManageSubscriptionModal close={() => setManageSubOpen(false)} />
      )}
    </div>
  )
}

function Sidebar({ open, close, expanded, toggle }: { open: boolean; close: () => void; expanded: boolean; toggle: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useSession()
  const [loggingOut, setLoggingOut] = useState(false)
  const adminMode = location.pathname.startsWith('/dashboard/admin') || location.pathname.startsWith('/admin')
  const initials = session?.user.full_name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'U'
  const logout = async () => {
    setLoggingOut(true)
    try {
      const response = await fetch(`${API_URL}/api/v1/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrfToken() } })
      if (!response.ok) throw new Error(await apiError(response))
      clearSessionCache()
      navigate('/login', { replace: true })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to sign out')
      setLoggingOut(false)
    }
  }
  if (adminMode) return <>
    <aside className={cn('sidebar admin-sidebar', open && 'is-open', expanded && 'expanded')}>
      <div className="sidebar-top"><BrandMark /><strong>Platform admin</strong><button className="sidebar-toggle" onClick={toggle} aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>{expanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button></div>
      <div className="admin-sidebar-label"><span>Platform control</span><small>Global configuration</small></div>
      <nav className="nav-stack" aria-label="Platform administration">
        <NavLink to="/dashboard/admin/models" onClick={close} className={({ isActive }) => cn('nav-icon', isActive && 'active')}><Bot size={18} /><span className="nav-label">Models</span><span className="tooltip">Models</span></NavLink>
        <NavLink to="/dashboard/admin/workspaces" onClick={close} className={({ isActive }) => cn('nav-icon', isActive && 'active')}><Boxes size={18} /><span className="nav-label">Workspaces</span><span className="tooltip">Workspaces</span></NavLink>
        <NavLink to="/dashboard/admin/plans" onClick={close} className={({ isActive }) => cn('nav-icon', isActive && 'active')}><Layers3 size={18} /><span className="nav-label">Plans</span><span className="tooltip">Plans</span></NavLink>
        <NavLink to="/dashboard/admin/users" onClick={close} className={({ isActive }) => cn('nav-icon', isActive && 'active')}><Users size={18} /><span className="nav-label">Users</span><span className="tooltip">Users</span></NavLink>
        <NavLink to="/dashboard/admin/transactions" onClick={close} className={({ isActive }) => cn('nav-icon', isActive && 'active')}><CreditCard size={18} /><span className="nav-label">Transactions</span><span className="tooltip">Transactions</span></NavLink>
        <NavLink to="/dashboard/admin/auth" onClick={close} className={({ isActive }) => cn('nav-icon', isActive && 'active')}><KeyRound size={18} /><span className="nav-label">Authentication</span><span className="tooltip">Authentication</span></NavLink>
        <NavLink to="/dashboard/admin/history" onClick={close} className={({ isActive }) => cn('nav-icon', isActive && 'active')}><FileClock size={18} /><span className="nav-label">Change history</span><span className="tooltip">Change history</span></NavLink>
      </nav>
      <div className="admin-sidebar-note"><ShieldCheck size={14} /><span><b>Platform scope</b><small>Changes affect every workspace.</small></span></div>
      <div className="sidebar-bottom">
        <NavLink to="/dashboard/chat" className="nav-icon" onClick={close}><ArrowLeft size={18} /><span className="nav-label">Back to workspace</span><span className="tooltip">Back to workspace</span></NavLink>
        <SidebarProfileMenu initials={initials} session={session} loggingOut={loggingOut} onLogout={logout} admin onNavigate={close} />
      </div>
    </aside>
    {open && <button className="sidebar-scrim" onClick={close} aria-label="Close menu" />}
  </>
  return <>
    <aside className={cn('sidebar', open && 'is-open', expanded && 'expanded')}>
      <div className="sidebar-top"><BrandMark /><strong>OpsAI</strong><button className="sidebar-toggle" onClick={toggle} aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>{expanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button></div>
      <nav className="nav-stack" aria-label="Main navigation">
        {primaryNav.map(({ to, icon: Icon, label }) => <NavLink key={to} to={to} onClick={close} className={({ isActive }) => cn('nav-icon', isActive && 'active')}><Icon size={18} /><span className="nav-label">{label}</span><span className="tooltip">{label}</span></NavLink>)}
      </nav>
      <RecentChats />
      <div className="sidebar-bottom">
        {session?.user.platform_role === 'admin' && <NavLink to="/dashboard/admin/models" className={cn('nav-icon', 'admin-nav-link', (location.pathname.startsWith('/dashboard/admin') || location.pathname.startsWith('/admin')) && 'active')}><ShieldCheck size={18} /><span className="nav-label">Platform admin</span><span className="tooltip">Platform admin</span></NavLink>}
        <WorkspaceAIUsage admin={session?.user.platform_role === 'admin'} />
        <SidebarProfileMenu initials={initials} session={session} loggingOut={loggingOut} onLogout={logout} onNavigate={close} />
      </div>
    </aside>
    {open && <button className="sidebar-scrim" onClick={close} aria-label="Close menu" />}
  </>
}

function Topbar({ menu }: { menu: () => void }) {
  const location = useLocation()
  const { session } = useSession()
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRoot = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const closeNotif = (event: MouseEvent) => {
      if (notifRoot.current && !notifRoot.current.contains(event.target as Node)) {
        setNotifOpen(false)
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotifOpen(false)
    }
    document.addEventListener('mousedown', closeNotif)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', closeNotif)
      document.removeEventListener('keydown', handleKey)
    }
  }, [])

  const adminMode = location.pathname.startsWith('/dashboard/admin') || location.pathname.startsWith('/admin')
  const section = adminMode ? 'Platform admin' : location.pathname.startsWith('/dashboard/servers') || location.pathname.startsWith('/servers') ? 'Servers' : location.pathname.startsWith('/dashboard/executions') || location.pathname.startsWith('/executions') ? 'Executions' : location.pathname.startsWith('/dashboard/pricing') ? 'Pricing & Plans' : location.pathname.startsWith('/dashboard/settings') || location.pathname.startsWith('/settings') ? 'Settings' : location.pathname.startsWith('/dashboard/profile') || location.pathname.startsWith('/profile') ? 'Profile' : location.pathname.includes('/chat/') ? 'AI session' : 'Command center'
  return <header className="topbar">
    <div className="topbar-left"><button className="mobile-menu icon-button" onClick={menu} aria-label="Open menu"><Menu size={20} /></button>{adminMode ? <span className="workspace-picker admin-context"><ShieldCheck size={14} /> Platform control</span> : <span className="workspace-picker workspace-context"><span className="workspace-dot" /> {session?.workspace.name || 'Workspace'}</span>}<span className="breadcrumb">/</span><span className="section-name">{section}</span></div>
    <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {adminMode ? <NavLink to="/dashboard/chat" className="button secondary compact"><ArrowLeft size={16} /> <span>Workspace</span></NavLink> : <NavLink to="/dashboard/chat" className="button dark compact"><Plus size={16} /> <span>New thread</span></NavLink>}
      <div className="topbar-notifications" ref={notifRoot} style={{ position: 'relative' }}>
        <button className="icon-button bordered" aria-label="Notifications" onClick={() => setNotifOpen(open => !open)}>
          <Bell size={17} />
          <span className="notification-dot" />
        </button>
        {notifOpen && (
          <div className="tool-menu notif-menu" style={{ position: 'absolute', right: 0, left: 'auto', top: 'calc(100% + 8px)', bottom: 'auto', width: 'min(290px, calc(100vw - 32px))', zIndex: 120 }}>
            <header><span>Notifications</span><small>Live</small></header>
            <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11 }}>
                <CheckCircle2 size={15} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 2 }} />
                <div><b>System healthy</b><small style={{ display: 'block', color: 'var(--muted)', fontSize: 10 }}>All operations and agent sessions nominal.</small></div>
              </div>
            </div>
            <footer><ShieldCheck size={12} /> Real-time operational alerts</footer>
          </div>
        )}
      </div>
    </div>
  </header>
}

function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(() => window.localStorage.getItem('sidebar-expanded') === 'true')
  const toggleSidebar = () => setSidebarExpanded(value => { window.localStorage.setItem('sidebar-expanded', String(!value)); return !value })
  return <ChatThreadsProvider><div className={cn('app-shell', sidebarExpanded && 'sidebar-expanded')}><Sidebar open={menuOpen} close={() => setMenuOpen(false)} expanded={sidebarExpanded} toggle={toggleSidebar} /><div className="app-body"><Topbar menu={() => setMenuOpen(true)} /><main><Routes>
    <Route index element={<Navigate to="chat" replace />} />
    <Route path="chat" element={<ChatHomePage />} />
    <Route path="chat/:id" element={<ChatThreadPage />} />
    <Route path="servers" element={<ApiServersPage />} />
    <Route path="servers/:id" element={<ApiServerDetailPage />} />
    <Route path="executions" element={<ApiExecutionsPage />} />
    <Route path="pricing" element={<ApiPricingPage mode="dashboard" />} />
    <Route path="settings" element={<SettingsPage />} />
    <Route path="profile" element={<ProfilePage />} />
    <Route path="forbidden" element={<ForbiddenPage />} />
    <Route path="admin/*" element={<PlatformAdminRoute><AdminConsole /></PlatformAdminRoute>} />
    <Route path="*" element={<PlaceholderPage />} />
  </Routes></main></div></div></ChatThreadsProvider>
}

function PlatformAdminRoute({ children }: { children: React.ReactNode }) {
  const { session } = useSession()
  return session?.user.platform_role === 'admin' ? children : <Navigate to="/dashboard/forbidden" replace />
}

function ForbiddenPage() {
  return <div className="forbidden-page page-enter"><div><i><ShieldCheck size={25} /></i><span className="page-eyebrow">Access restricted</span><h1>Platform clearance required.</h1><p>This area is reserved for platform administrators. Your workspace access remains unchanged.</p><NavLink to="/dashboard/chat" className="button dark"><ArrowLeft size={14} /> Return to command center</NavLink></div></div>
}

function AuthenticatedSession() {
  const navigate = useNavigate()
  const location = useLocation()
  const { session, loading, error } = useSession()
  useEffect(() => {
    if (loading || session) return
    if (error) console.error('Session check failed', error)
    navigate('/login', { replace: true, state: { from: location.pathname + location.search } })
  }, [error, loading, location.pathname, location.search, navigate, session])
  return session ? <AppShell /> : null
}

function AuthenticatedApp() {
  return <SessionProvider><AuthenticatedSession /></SessionProvider>
}

function LandingPage() {
  const [previewRunning, setPreviewRunning] = useState(false)
  const capabilities = [
    { icon: Activity, number: '01', title: 'See the signal', copy: 'Ask plain-language questions across CPU, memory, services, logs, and containers.' },
    { icon: ShieldCheck, number: '02', title: 'Approve the plan', copy: 'Review every generated command before anything touches your infrastructure.' },
    { icon: Terminal, number: '03', title: 'Watch it run', copy: 'Follow live output, exit codes, and operational history from one focused surface.' },
  ]
  return <div className="landing-page">
    <nav className="landing-nav"><NavLink to="/" className="landing-brand"><BrandMark /><span>OpsAI</span></NavLink><div className="landing-links"><a href="#workflow">Workflow</a><a href="#security">Security</a><NavLink to="/pricing">Pricing</NavLink></div><NavLink to="/dashboard/chat" className="button dark">Open workspace <ArrowRight size={15} /></NavLink></nav>
    <main>
      <section className="landing-hero"><div className="landing-grid" /><div className="landing-copy"><div className="eyebrow"><span className="live-dot" /> AI operations, under your control</div><h1>Your servers.<br />One <em>clear</em> command.</h1><p>Investigate incidents, inspect infrastructure, and run approved SSH operations without losing sight of what changes where.</p><div className="landing-actions"><NavLink to="/dashboard/chat" className="button dark">Start operating <ArrowRight size={16} /></NavLink><a href="#workflow" className="landing-text-link">See how it works <ChevronDown size={14} /></a></div><div className="landing-proof"><span><ShieldCheck size={14} /> Approval-first</span><span><KeyRound size={14} /> Key-based SSH</span><span><History size={14} /> Full audit trail</span></div></div>
        <div className={cn('landing-chat-preview', previewRunning && 'demo-running')}><div className="preview-chat"><div className="preview-chat-head"><div><small>AI OPERATION</small><strong>Diagnose server health</strong></div><span><i /> Connected</span></div><div className="preview-conversation"><div className="preview-message preview-user"><i>AR</i><div><span><b>You</b><small>just now</small></span><p>Find why worker CPU is elevated.</p><em><ServerIcon size={10} /> Production API</em></div></div><div className="preview-message preview-ai"><i><Sparkles size={12} /></i><div><span><b>OpsAI</b><small>{previewRunning ? 'working...' : 'ready to run'}</small></span><p>I'll inspect system load, top processes, and service health.</p><div className="preview-plan"><header><span><Command size={12} /><b>Execution plan</b></span><em><ShieldCheck size={10} /> Low risk</em></header>{['Check system resource pressure', 'Find top CPU processes', 'Inspect critical services'].map((item, index) => <div className="preview-plan-step" key={item}><i>{index + 1}</i><span>{item}</span></div>)}<code>ps aux --sort=-%cpu | head -n 6</code><footer><button onClick={() => openDemo('edit', 'Edit execution plan', 'ps aux --sort=-%cpu | head -n 6')}>Edit plan</button><button onClick={() => { setPreviewRunning(true); window.setTimeout(() => { setPreviewRunning(false); showToast('Preview operation completed') }, 2400) }}>{previewRunning ? 'Running...' : 'Approve & run'} <Play size={9} fill="currentColor" /></button></footer></div></div></div></div><div className="preview-composer"><span>Ask a follow-up...</span><em><ServerIcon size={10} /> Production API</em><i><ArrowRight size={11} /></i></div></div><div className="preview-execution"><div className="preview-execution-head"><small><i /> {previewRunning ? 'LIVE' : 'READY'}</small><strong>Execution output</strong></div><div className="preview-context"><span><ServerIcon size={10} /> Production API</span><span><Clock3 size={10} /> {previewRunning ? 'running' : 'waiting'}</span></div><div className="preview-terminal"><header><span>OUTPUT</span><b>All&nbsp;&nbsp; stdout&nbsp;&nbsp; stderr</b></header><div className="preview-logs"><p><i>14:32:08</i><b>01</b><code>Secure SSH session established</code></p><p><i>14:32:09</i><b>02</b><code>$ uptime &amp;&amp; free -m</code></p><p><i>14:32:09</i><b>03</b><code>load average: 0.84, 0.92, 0.76</code></p><p><i>14:32:10</i><b>04</b><code>$ ps aux --sort=-%cpu</code></p><p><i>14:32:10</i><b>05</b><code>node worker.js 31.2% CPU</code></p><span><i /> Receiving output</span></div></div><footer><span><i /> Secure session active</span></footer></div></div>
      </section>
      <section className="landing-status"><span>BUILT FOR CONTROLLED OPERATIONS</span><div /><p>3 servers online</p><div /><p>All commands visible</p><div /><p>Zero hidden execution</p></section>
      <section className="landing-workflow" id="workflow"><div className="landing-section-head"><span className="page-eyebrow">One operational loop</span><h2>From question to verified output.</h2><p>Keep human judgment in the path without slowing down diagnosis.</p></div><div className="capability-grid">{capabilities.map(({ icon: Icon, number, title, copy }) => <article key={number}><div className="capability-top"><i><Icon size={19} /></i><span>{number}</span></div><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
      <section className="landing-security" id="security"><div><span className="page-eyebrow">Security by default</span><h2>Access stays explicit.<br /><em>Actions stay visible.</em></h2></div><div className="security-list"><span><KeyRound size={18} /><b>SSH keys, not saved passwords</b><small>Credentials bootstrap encrypted key-based access.</small></span><span><ShieldCheck size={18} /><b>Approval before execution</b><small>Inspect generated plans and commands before run.</small></span><span><History size={18} /><b>Immutable operational context</b><small>Keep server, output, duration, and result together.</small></span></div></section>
      <section className="landing-cta"><span className="page-eyebrow">Your infrastructure is talking</span><h2>Ask the right question.</h2><p>Open command center and start with a read-only health check.</p><NavLink to="/dashboard/chat" className="button dark">Open command center <ArrowRight size={16} /></NavLink></section>
    </main><footer className="landing-footer"><div className="landing-brand"><BrandMark /><span>OpsAI</span></div><p>Human-approved infrastructure operations.</p><span>2026 / NORTHSTAR OPS</span></footer>
  </div>
}

function LegacyPricingPage() {
  return <Navigate to="/pricing" replace />
}

function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const register = mode === 'register'
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [error, setError] = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const [verificationPending, setVerificationPending] = useState(false)
  const [unverifiedEmail, setUnverifiedEmail] = useState('')
  const [resending, setResending] = useState(false)
  const [resendMessage, setResendMessage] = useState('')

  useEffect(() => {
    adminApi.getAuthProviders().then(res => {
      setGoogleEnabled(Boolean(res?.google?.enabled))
    }).catch(() => {})
  }, [])

  const continueWithGoogle = async () => {
    setGoogleLoading(true)
    setError('')
    try {
      const res = await adminApi.getGoogleAuthURL()
      if (res?.url) {
        window.location.href = res.url
      } else {
        throw new Error('Google sign-in URL not available')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Google authentication unavailable')
      setGoogleLoading(false)
    }
  }

  const handleResend = async () => {
    if (!unverifiedEmail) return
    setResending(true)
    setResendMessage('')
    try {
      const res = await adminApi.resendVerification(unverifiedEmail)
      setResendMessage(res.message || 'Verification link sent')
    } catch (caught) {
      setResendMessage(caught instanceof Error ? caught.message : 'Failed to resend link')
    } finally {
      setResending(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email || password.length < 12 || (register && (!fullName || !workspace))) return
    setLoading(true)
    setError('')
    setResendMessage('')
    try {
      const body = register ? { full_name: fullName, workspace_name: workspace, email, password } : { email, password }
      const response = await fetch(`${API_URL}/api/v1/auth/${mode}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) {
        const errorText = await apiError(response)
        if (errorText.toLowerCase().includes('verification required')) {
          setUnverifiedEmail(email)
        }
        throw new Error(errorText)
      }
      const data = await response.json().catch(() => null)
      if (data?.requires_verification) {
        setVerificationPending(true)
        setLoading(false)
        return
      }
      const target = (location.state as { from?: string })?.from || (register ? '/dashboard/pricing?mode=onboarding' : '/dashboard/chat')
      navigate(target, { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to complete request')
      setLoading(false)
    }
  }

  if (verificationPending) {
    return (
      <div className="auth-page">
        <NavLink to="/" className="auth-brand"><BrandMark /><span>OpsAI</span></NavLink>
        <main className="auth-form-panel">
          <div className="auth-form-wrap">
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', marginBottom: 18, border: '1px solid #7657ff20' }}>
              <Mail size={22} />
            </div>
            <span className="page-eyebrow">Verification required</span>
            <h1 style={{ fontSize: 32, margin: '8px 0 10px' }}>Check your email.</h1>
            <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              We have sent a secure activation link to <b>{email}</b>. Click the link in the email to activate your workspace and begin operating.
            </p>

            <div style={{ padding: '14px 16px', background: '#fff', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 20, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink)', fontWeight: 600 }}>
                <Clock3 size={14} color="var(--accent)" /> Link expires in 24 hours
              </div>
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>If you don't see the email, check your spam or junk folder.</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <NavLink to="/login" className="button dark auth-submit" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                Go to Sign In <ArrowRight size={14} />
              </NavLink>
              <button
                type="button"
                className="button secondary"
                disabled={resending}
                onClick={() => void handleResend()}
                style={{ minHeight: 40, fontSize: 12 }}
              >
                {resending ? 'Sending...' : 'Resend verification email'}
              </button>
              {resendMessage && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: '#f0fff4', color: 'var(--green)', fontSize: 11, border: '1px solid #c6f6d5', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <CheckCircle2 size={13} /> {resendMessage}
                </div>
              )}
            </div>

            <p className="auth-switch" style={{ marginTop: 24 }}>
              Wrong email address? <NavLink to="/register">Create another account</NavLink>
            </p>
            <div className="auth-trust"><ShieldCheck size={12} /> Encrypted session / Verification-gated security</div>
          </div>
        </main>
        <aside className="auth-visual">
          <div className="auth-grid" />
          <div className="auth-visual-copy">
            <span>PLATFORM SECURITY / EMAIL VERIFICATION</span>
            <h2>Verify identity.<br />Protect infrastructure.</h2>
            <p>Every workspace account requires cryptographic email confirmation before SSH keys, terminal commands, or server agents can be initialized.</p>
          </div>
          <div className="auth-operation">
            <header>
              <span><i /> ACTIVATION STATUS</span>
              <b>SECURITY GATEWAY</b>
            </header>
            <div>
              <i><Check size={12} /></i>
              <span><b>Workspace registered</b><small>{workspace || 'New workspace'} initialized</small></span>
            </div>
            <div className="running">
              <i><span /></i>
              <span><b>Awaiting email confirmation</b><small>Single-use 256-bit activation token sent</small></span>
            </div>
            <div>
              <i style={{ background: '#26262b', color: '#666' }}><ShieldCheck size={12} /></i>
              <span><b>SSH & AI Control Plane locked</b><small>Unlocks immediately upon verification</small></span>
            </div>
            <footer><ShieldCheck size={11} /> ZERO-TRUST IDENTITY VALIDATION</footer>
          </div>
          <div className="auth-visual-foot">
            <span>SESSION ENCRYPTED</span>
            <span>OPS / 2026</span>
          </div>
        </aside>
      </div>
    )
  }
  return <div className="auth-page">
    <NavLink to="/" className="auth-brand"><BrandMark /><span>OpsAI</span></NavLink>
    <main className="auth-form-panel"><div className="auth-form-wrap">
      <span className="page-eyebrow">{register ? 'Create workspace' : 'Welcome back'}</span>
      <h1>{register ? 'Start operating.' : 'Return to control.'}</h1>
      <p>{register ? 'Create your account and connect your first server in minutes.' : 'Sign in to inspect infrastructure and continue active operations.'}</p>
      <button type="button" className="auth-sso" onClick={() => void continueWithGoogle()} disabled={googleLoading}>
        <svg viewBox="0 0 24 24" width="17" height="17" style={{ flexShrink: 0, marginRight: 4 }}>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
        </svg>
        {googleLoading ? 'Connecting to Google...' : 'Continue with Google'}
      </button>
      <div className="auth-divider"><i /> or continue with email <i /></div>
      <form onSubmit={submit}>
        {register && <>
          <label className="auth-field"><span>Full name</span><div><UserRound size={15} /><input required value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Aria Rahman" autoComplete="name" /></div></label>
          <label className="auth-field"><span>Workspace name</span><div><Boxes size={15} /><input required value={workspace} onChange={event => setWorkspace(event.target.value)} placeholder="Northstar Ops" autoComplete="organization" /></div></label>
        </>}
        <label className="auth-field"><span>Email address</span><div><Mail size={15} /><input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" /></div></label>
        <label className="auth-field"><span>Password <small>12+ characters</small></span><div><LockKeyhole size={15} /><input required minLength={12} type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" autoComplete={register ? 'new-password' : 'current-password'} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
        {!register && <div className="auth-options"><label><input type="checkbox" defaultChecked /> Keep me signed in</label><NavLink to="/forgot-password" style={{ color: 'var(--muted)', fontSize: 12, textDecoration: 'none' }}>Forgot password?</NavLink></div>}
        {register && <label className="auth-consent"><input required type="checkbox" /> I agree to the Terms of Service and acknowledge the Privacy Policy.</label>}
        {error && (
          <div className="auth-error" role="alert" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <AlertTriangle size={14} /> {error}
            </div>
            {unverifiedEmail && (
              <button
                type="button"
                className="button secondary compact"
                disabled={resending}
                onClick={() => void handleResend()}
                style={{ fontSize: 10, marginTop: 4 }}
              >
                {resending ? 'Sending...' : 'Resend verification email'}
              </button>
            )}
            {resendMessage && <span style={{ fontSize: 10, color: 'var(--green)' }}>{resendMessage}</span>}
          </div>
        )}
        <button className="button dark auth-submit" disabled={loading}>{loading ? <><span className="tiny-spinner" /> {register ? 'Creating workspace...' : 'Signing in...'}</> : register ? 'Create workspace' : 'Sign in'}</button>
      </form>
      <p className="auth-switch">{register ? 'Already operating?' : 'New to OpsAI?'} <NavLink to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create a workspace'}</NavLink></p>
      <div className="auth-trust"><ShieldCheck size={12} /> Encrypted session / Approval-first operations</div>
    </div></main>
    <aside className="auth-visual"><div className="auth-grid" /><div className="auth-visual-copy"><span>CONTROL PLANE / AUTHENTICATED</span><h2>Operate with context.<br />Execute with confidence.</h2><p>One secure workspace for every server, investigation, approval, and command output.</p></div><div className="auth-operation"><header><span><i /> OPERATION PREVIEW</span><b>READ ONLY</b></header><div><i><Check size={12} /></i><span><b>Connected to production-api</b><small>Identity verified / SSH key accepted</small></span></div><div><i><Check size={12} /></i><span><b>Execution plan approved</b><small>3 read-only diagnostic commands</small></span></div><div className="running"><i><span /></i><span><b>Streaming verified output</b><small>Every command remains visible</small></span></div><footer><ShieldCheck size={11} /> HUMAN APPROVAL REMAINS IN THE LOOP</footer></div><div className="auth-visual-foot"><span>SESSION ENCRYPTED</span><span>OPS / 2026</span></div></aside>
  </div>
}

function App() {
  return <><DemoUIHost /><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/pricing" element={<ApiPricingPage mode="public" />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/verify-email" element={<VerifyEmailPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/checkout/:planId" element={<CheckoutPage />} />
    <Route path="/checkout/result" element={<PaymentResultPage />} />
    <Route path="/auth/google/callback" element={<GoogleAuthCallback />} />
    <Route path="/dashboard/*" element={<AuthenticatedApp />} />
    <Route path="/*" element={<AuthenticatedApp />} />
  </Routes></>
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
    navigate(`/dashboard/chat/diagnose?${params}`)
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
  return <button className="server-row" onClick={() => navigate(`/dashboard/servers/${server.id}`)}><span className="server-identity"><i className={cn('server-glyph', server.status.toLowerCase())}><ServerIcon size={18} /></i><span><strong>{server.name}</strong><small>{server.host} / {server.region}</small></span></span><span><b className={cn('env-tag', server.environment.toLowerCase())}>{server.environment}</b></span><span className="resource-bars"><MetricBar label="CPU" value={server.cpu} /><MetricBar label="MEM" value={server.memory} /></span><StatusPill status={server.status} /><ChevronRight size={17} /></button>
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
  return <div className="content-page server-detail-page page-enter"><button className="back-link" onClick={() => navigate('/dashboard/servers')}><ArrowLeft size={15} /> All servers</button>
    <section className="server-overview-card"><div className="server-detail-head"><div className="server-title"><i className={cn('server-glyph', server.status.toLowerCase())}><ServerIcon size={22} /></i><div><div className="title-line"><h1>{server.name}</h1><StatusPill status={server.status} /></div><p>{server.host}</p></div></div><div className="heading-actions"><button className="button secondary" onClick={() => openDemo('console', `Console / ${server.name}`, `deploy@${server.host}`)}><Terminal size={16} /> Open console</button><button className="button dark" onClick={() => navigate(`/dashboard/chat/health?server=${server.id}`)}><Sparkles size={16} /> Ask OpsAI</button></div></div><div className="server-facts"><div><span>Environment</span><b className={cn('env-tag', server.environment.toLowerCase())}>{server.environment}</b></div><div><span>Region</span><b>{server.region}</b></div><div><span>Operating system</span><b>Ubuntu 24.04 LTS</b></div><div><span>Uptime</span><b>{server.uptime}</b></div><div><span>SSH access</span><b className="verified-access"><ShieldCheck size={13} /> Key verified</b></div></div></section>
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
  const legacyExecutionPreview: Array<{ type: string; text: string; time: string; delay: number }> = []
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
      if (count >= legacyExecutionPreview.length) { setComplete(true); return }
      timeout = window.setTimeout(() => { const next = count + 1; setLogCount(next); stream(next) }, legacyExecutionPreview[count].delay)
    }
    stream(1)
    return () => window.clearTimeout(timeout)
  }, [stopped])
  const progress = legacyExecutionPreview.length ? Math.round((logCount / legacyExecutionPreview.length) * 100) : 0
  return <div className={cn('thread-layout page-enter', terminalMinimized && 'terminal-minimized')}><section className="thread-main"><div className="thread-header"><div><span className="page-eyebrow">AI operation</span><h2>Diagnose server health</h2></div><div className="thread-header-status"><span className="connected"><i /> Connected</span><div className="thread-menu"><button className="icon-button bordered" onClick={() => setThreadMenu(value => !value)} aria-label="Thread actions"><MoreHorizontal size={18} /></button>{threadMenu && <div><button onClick={() => openDemo('edit','Rename thread','Diagnose server health')}>Rename thread</button><button onClick={() => showToast('Thread duplicated')}>Duplicate</button><button onClick={() => showToast('Thread archived')}>Archive</button><button className="danger" onClick={() => openDemo('restart','Delete thread','Diagnose server health')}>Delete</button></div>}</div></div></div>
    <div className="conversation"><div className="chat-history-marker"><span>Today</span></div><div className="message user-message history-message"><div className="message-avatar">AR</div><div><div className="message-meta"><strong>You</strong><span>8 min ago</span></div><p>Give me a quick status summary for {server.name}.</p><span className="target-chip"><ServerIcon size={13} /> {server.name}</span></div></div><div className="message ai-message history-message"><div className="message-avatar ai"><Sparkles size={16} /></div><div><div className="message-meta"><strong>OpsAI</strong><span>completed</span></div><p>Server is online with normal memory and disk usage. Worker CPU remains above its 15-minute baseline.</p><div className="result-tags"><span>Online</span><span>Memory normal</span><span>CPU elevated</span></div></div></div><div className="message user-message"><div className="message-avatar">AR</div><div><div className="message-meta"><strong>You</strong><span>just now</span></div><p>{prompt}</p><div className="message-context"><span className="target-chip"><ServerIcon size={13} /> {server.name}</span><span className="target-chip"><ShieldCheck size={13} /> {policy}</span>{attachment && <span className="target-chip"><FileCode2 size={13} /> {attachment}</span>}</div></div></div>
    <div className="message ai-message"><div className="message-avatar ai"><Sparkles size={16} /></div><div className="message-content"><div className="message-meta"><strong>OpsAI</strong><span>{stopped ? 'stopped' : complete ? 'completed' : 'working...'}</span></div><p>I'll inspect system load, memory pressure, top processes, and service health. Approved read-only plan is running now.</p>
      <div className="operation-progress"><div><span>{stopped ? 'Operation stopped' : complete ? 'Operation complete' : 'Running diagnostics'}</span><b>{progress}%</b></div><i><b style={{ width: `${progress}%` }} /></i><small>{stopped ? 'Stopped by user' : complete ? '4 of 4 steps completed' : `${Math.min(4, Math.ceil(logCount / 3))} of 4 steps in progress`}</small></div><div className="plan-card"><div className="plan-head"><div><i><Command size={17} /></i><span><strong>Execution plan</strong><small>4 steps / read-only / ~30 sec</small></span></div><span className="risk-badge"><ShieldCheck size={13} /> Approved</span></div><div className="plan-steps">{['Check system uptime and resource pressure', 'Find processes consuming the most CPU', 'Inspect critical service status', 'Summarize findings and recommend action'].map((step, index) => <div key={step} className={cn((complete || index < Math.floor(progress / 25)) && 'done', !complete && !stopped && index === Math.min(3, Math.floor(progress / 25)) && 'running')}><i>{complete || index < Math.floor(progress / 25) ? <Check size={13} /> : index + 1}</i><span>{step}</span>{!complete && !stopped && index === Math.min(3, Math.floor(progress / 25)) && <b>Running</b>}</div>)}</div><div className="command-preview"><div><span>3 commands</span><button onClick={() => { navigator.clipboard?.writeText('uptime && free -m\nps aux --sort=-%cpu | head -n 6\nsystemctl --failed --no-pager'); setCopied(true); showToast('Commands copied'); window.setTimeout(() => setCopied(false),1500) }}><Copy size={13} /> {copied ? 'Copied' : 'Copy'}</button></div><code>uptime && free -m<br/>ps aux --sort=-%cpu | head -n 6<br/>systemctl --failed --no-pager</code></div></div>
      {complete && <div className="result-card"><div className="result-icon"><CheckCircle2 size={20} /></div><div><strong>Health check complete</strong><p>Server is stable. Elevated CPU comes from <code>node dist/worker.js</code>, currently using 31.2%. No failed services found. Memory remains within operating range.</p><div className="result-tags"><span>CPU stable</span><span>Services healthy</span><span>No action required</span></div></div></div>}
    </div></div></div><div className="thread-composer"><Composer compact initialServer={server.id} /></div></section>
    <button className="terminal-edge-toggle" onClick={() => setTerminalMinimized(value => !value)} aria-label={terminalMinimized ? 'Open terminal preview' : 'Hide terminal preview'}><Terminal size={14} /><ChevronRight size={12} /></button>
    {!terminalMinimized && <ExecutionPanel active logs={legacyExecutionPreview.slice(0, logCount)} complete={complete} server={server} stopped={stopped} onStop={() => { setStopped(true); setComplete(true); showToast('Execution stopped by user') }} />}
  </div>
}

function ExecutionPanel({ active, logs, complete, server, stopped, onStop }: { active: boolean; logs: Array<{ type: string; text: string; time: string }>; complete: boolean; server: Server; stopped: boolean; onStop: () => void }) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)
  const [filter, setFilter] = useState<'session' | 'stderr'>('session')
  const [menu, setMenu] = useState(false)

  const onScroll = () => {
    if (!terminalRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 40
    userScrolledUp.current = !atBottom
  }

  useEffect(() => {
    if (!terminalRef.current) return
    if (!userScrolledUp.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [logs.length])

  const download = () => { const url = URL.createObjectURL(new Blob([logs.map(log => `${log.time} ${log.text}`).join('\n')], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = 'execution-log.txt'; link.click(); URL.revokeObjectURL(url); showToast('Execution log downloaded') }
  return <aside className="execution-panel"><div className="execution-head"><div><span className={cn('execution-state', active && !complete && 'running', complete && 'complete')}><i />{!active ? 'Waiting' : stopped ? 'Stopped' : complete ? 'Completed' : 'Live'}</span><h3>SSH terminal</h3></div><div><button className="icon-button" onClick={download} aria-label="Download log"><Download size={16} /></button><div className="terminal-menu"><button className="icon-button" onClick={() => setMenu(value=>!value)} aria-label="Terminal actions"><MoreHorizontal size={17} /></button>{menu && <div><button onClick={() => { navigator.clipboard?.writeText('sess_demo_7f92'); showToast('Session ID copied') }}>Copy session ID</button><button onClick={() => showToast('Line wrapping toggled')}>Wrap lines</button><button onClick={() => showToast('Terminal view cleared')}>Clear view</button></div>}</div></div></div><div className="execution-context"><span><ServerIcon size={14} /> deploy@{server.host}</span><span><Clock3 size={14} /> {complete ? '3.8s' : active ? 'connected' : 'not started'}</span></div>
    {!active ? <div className="terminal-empty"><div><Terminal size={22} /></div><strong>Waiting for approval</strong><p>Live output will appear here after the execution plan is approved.</p></div> : <div className="terminal" ref={terminalRef} onScroll={onScroll}><div className="terminal-toolbar"><span>SSH / PTY</span><div><button className={filter==='session'?'active':''} onClick={()=>setFilter('session')}>session</button><button className={filter==='stderr'?'active':''} onClick={()=>setFilter('stderr')}>stderr</button></div></div>{filter === 'stderr' ? <div className="terminal-filter-empty"><CheckCircle2 size={22}/><strong>No stderr output</strong><span>Session has not reported any errors.</span></div> : <div className="terminal-lines">{logs.map((log, index) => <div className={cn('log-line', log.type)} key={`${log.time}-${index}`}><span className="log-time">{log.time}</span><code>{log.text || ' '}</code>{!complete && index === logs.length - 1 && <i className="inline-cursor" />}</div>)}</div>}</div>}
    {active && <div className="execution-foot"><span>{stopped ? <><Square size={13}/> Stopped by user</> : complete ? <><CheckCircle2 size={15} /> Exit code 0</> : <><span className="tiny-spinner" /> Secure session active</>}</span>{!complete && <button onClick={onStop}><Square size={12} fill="currentColor" /> Stop</button>}</div>}
  </aside>
}

function ExecutionsPage() {
  return <div className="content-page page-enter"><PageHeading eyebrow="Operations" title="Executions" description="Every command, approval, and output in one immutable timeline." /><div className="stats-strip three"><MiniStat label="Last 24 hours" value="18" detail="executions" icon={Terminal} /><MiniStat label="Success rate" value="94%" detail="17 succeeded" icon={CheckCircle2} /><MiniStat label="Avg. duration" value="8.4s" detail="all servers" icon={Clock3} /></div><div className="execution-table"><div className="execution-table-head"><span>Operation</span><span>Server</span><span>Status</span><span>Duration</span><span>Created</span></div>{['Health and resource inspection', 'Inspect nginx error logs', 'Restart worker service', 'Check failed systemd units', 'List Docker containers'].map((name, index) => <div className="execution-table-row" key={name}><span><i><Terminal size={16} /></i><span><strong>{name}</strong><small>{index === 2 ? 'Manual command' : 'OpsAI execution'}</small></span></span><span>{index % 2 ? 'Worker Primary' : 'Production API'}</span><span><b className={cn('table-status', index === 2 && 'failed')}><i />{index === 2 ? 'Failed' : 'Succeeded'}</b></span><span>{[4.2, 2.8, 1.1, 3.6, 0.8][index]}s</span><span>{index === 0 ? '2 min ago' : `${index + 1}h ago`}</span></div>)}</div></div>
}

function PlaceholderPage() {
  return <div className="placeholder-page"><div className="placeholder-icon"><Database size={24} /></div><span className="page-eyebrow">Workspace module</span><h1>Coming into focus</h1><p>This surface is prepared for backend integration in the next product phase.</p><NavLink to="/dashboard/chat" className="button dark">Back to command center</NavLink></div>
}

export default App
