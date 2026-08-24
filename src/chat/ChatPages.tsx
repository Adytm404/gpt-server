import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Clock3, Command, Download, MessageSquare, MoreHorizontal, Play, Plus, Server as ServerIcon, ShieldCheck, Sparkles, Square, Terminal } from 'lucide-react'
import { chatApi, operationEventFromMessage, operationEventsUrl, reduceOperationEvents, type ChatConfig, type ChatMessage, type ChatPolicy, type ChatThread, type Operation, type OperationEvent } from '../api/chat'
import { serversApi, type Server } from '../api/servers'
import { MarkdownMessage } from './MarkdownMessage'
import { useDialog } from '../ui/DialogProvider'

const cn = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ')
const finalStatuses = new Set(['succeeded', 'completed', 'failed', 'cancelled', 'canceled', 'rejected'])
const busyStatuses = new Set(['planning', 'planned', 'approved', 'queued', 'running', 'executing', 'summarizing'])
const approvalStatuses = new Set(['pending_approval', 'awaiting_approval', 'requires_approval'])
const operationEventTypes = ['planning', 'plan_ready', 'approved', 'approval.required', 'retry.requested', 'running', 'step.started', 'stdout', 'stderr', 'step.completed', 'completed', 'failed', 'cancelled', 'rejected', 'assistant.delta', 'summary.started', 'summary.completed', 'summary.failed', 'summarizing', 'agent.thinking', 'flow.updated']
const streamFinalEventTypes = new Set(['summary.completed', 'summary.failed', 'cancelled', 'rejected'])
const lifecycleEventTypes = new Set(['planning', 'plan_ready', 'approved', 'approval.required', 'retry.requested', 'running', 'step.started', 'step.completed', 'completed', 'failed', 'cancelled', 'rejected', 'summary.started', 'summary.completed', 'summary.failed', 'agent.thinking', 'flow.updated'])

const policies: Array<{ value: ChatPolicy; label: string; description: string }> = [
  { value: 'approval_required', label: 'Approval required', description: 'Read-only by default. Explicit install or change requests escalate to high-risk approval.' },
  { value: 'autonomous_full_access', label: 'Full access', description: 'Autonomous arbitrary shell access until goal completes. No command approval prompts.' },
  { value: 'explain_only', label: 'Explain only', description: 'Analyze latest stored server context only. No commands will run.' },
]

type ThreadContextValue = { threads: ChatThread[]; loading: boolean; error: string; refresh: () => Promise<void>; config: ChatConfig | null; configLoading: boolean; configError: string; refreshConfig: () => Promise<void> }
const ThreadContext = createContext<ThreadContextValue | null>(null)

export function ChatThreadsProvider({ children }: { children: ReactNode }) {
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [config, setConfig] = useState<ChatConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState('')
  const refresh = useCallback(async () => {
    setError('')
    try { setThreads((await chatApi.listThreads()).filter(thread => !thread.archivedAt && thread.status !== 'archived')) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load chats') }
    finally { setLoading(false) }
  }, [])
  const refreshConfig = useCallback(async () => {
    setConfigError('')
    try { setConfig(await chatApi.getConfig()) }
    catch (caught) { setConfigError(caught instanceof Error ? caught.message : 'Unable to load chat configuration') }
    finally { setConfigLoading(false) }
  }, [])
  useEffect(() => { void refresh(); void refreshConfig() }, [refresh, refreshConfig])
  return <ThreadContext.Provider value={{ threads, loading, error, refresh, config, configLoading, configError, refreshConfig }}>{children}</ThreadContext.Provider>
}

export function useChatThreads() {
  const context = useContext(ThreadContext)
  if (!context) throw new Error('useChatThreads must be used within ChatThreadsProvider')
  return context
}

function relativeTime(value?: string) {
  if (!value) return ''
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed)) return ''
  const minutes = Math.max(0, Math.floor(elapsed / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function RecentChats() {
  const { threads, loading, error, refresh } = useChatThreads()
  const dialog = useDialog()
  const navigate = useNavigate()
  const [menuThreadId, setMenuThreadId] = useState<string | null>(null)
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({})
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuThreadId) return
    const handleDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuThreadId(null)
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuThreadId(null)
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menuThreadId])

  useEffect(() => {
    if (!menuThreadId) return
    const reposition = () => setMenuPosition(position => ({ ...position }))
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [menuThreadId])

  const openMenu = (threadId: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const estimatedHeight = 118
    const openUpward = rect.bottom + estimatedHeight > window.innerHeight - 8
    setMenuPosition({
      position: 'fixed',
      left: Math.min(rect.right + 4, window.innerWidth - 142),
      top: openUpward ? undefined : rect.bottom + 4,
      bottom: openUpward ? window.innerHeight - rect.top + 4 : undefined,
    })
    setMenuThreadId(current => current === threadId ? null : threadId)
  }

  const handleRename = async (thread: ChatThread) => {
    setMenuThreadId(null)
    setBusyThreadId(thread.id)
    const title = (await dialog.prompt({ title: 'Rename chat', description: 'Give this operational thread a concise title.', label: 'Thread title', initialValue: thread.title, confirmLabel: 'Save title' }))?.trim()
    if (!title) { setBusyThreadId(null); return }
    try {
      await chatApi.updateThread(thread.id, { title, status: 'active' })
      await refresh()
    } catch (caught) {
      await dialog.notice({ title: 'Unable to rename chat', description: caught instanceof Error ? caught.message : 'Unable to rename chat', tone: 'destructive' })
    } finally {
      setBusyThreadId(null)
    }
  }

  const handleArchive = async (thread: ChatThread) => {
    setMenuThreadId(null)
    setBusyThreadId(thread.id)
    try {
      await chatApi.updateThread(thread.id, { title: thread.title, status: 'archived' })
      await refresh()
      navigate('/dashboard/chat')
    } catch (caught) {
      await dialog.notice({ title: 'Unable to archive chat', description: caught instanceof Error ? caught.message : 'Unable to archive chat', tone: 'destructive' })
    } finally {
      setBusyThreadId(null)
    }
  }

  const handleDelete = async (thread: ChatThread) => {
    setMenuThreadId(null)
    setBusyThreadId(thread.id)
    const confirmed = await dialog.confirm({ title: 'Delete chat?', description: `“${thread.title}” and its conversation history will be permanently removed.`, confirmLabel: 'Delete chat', tone: 'destructive' })
    if (!confirmed) { setBusyThreadId(null); return }
    try {
      await chatApi.deleteThread(thread.id)
      await refresh()
      navigate('/dashboard/chat')
    } catch (caught) {
      await dialog.notice({ title: 'Unable to delete chat', description: caught instanceof Error ? caught.message : 'Unable to delete chat', tone: 'destructive' })
    } finally {
      setBusyThreadId(null)
    }
  }

  return <div className="sidebar-history"><div><span>Recent chats</span><NavLink to="/dashboard/chat" aria-label="New chat"><Plus size={14} /></NavLink></div>
    {loading && <p className="chat-list-state">Loading chats...</p>}
    {!loading && error && <p className="chat-list-state" role="alert">{error}</p>}
    {!loading && !error && threads.length === 0 && <p className="chat-list-state">No recent chats</p>}
    {threads.map(thread => (
      <div key={thread.id} className="history-link-container">
        <NavLink to={`/dashboard/chat/${thread.id}`} className={({ isActive }) => cn('history-link', isActive && 'active', menuThreadId === thread.id && 'menu-open')}>
          <MessageSquare size={14} />
          <span>
            <div className="history-link-header">
              <b>{thread.title}</b>
              <em>{relativeTime(thread.updatedAt || thread.createdAt)}</em>
            </div>
            <small>{thread.serverName || 'Server scope unavailable'}</small>
          </span>
        </NavLink>
        <button
          type="button"
          className="history-menu-trigger"
          aria-label={`Actions for ${thread.title}`}
          aria-expanded={menuThreadId === thread.id}
          disabled={busyThreadId === thread.id}
          onClick={(e) => openMenu(thread.id, e)}
        >
          <MoreHorizontal size={13} />
        </button>
        {menuThreadId === thread.id && createPortal(
          <div className="history-dropdown-menu" role="menu" ref={menuRef} style={menuPosition}>
            <button type="button" onClick={() => void handleRename(thread)}>Rename</button>
            <button type="button" onClick={() => void handleArchive(thread)}>Archive</button>
            <button type="button" className="danger" onClick={() => void handleDelete(thread)}>Delete</button>
          </div>,
          document.body,
        )}
      </div>
    ))}
  </div>
}

export function WorkspaceAIUsage({ admin }: { admin: boolean }) {
  const { config, configLoading, configError } = useChatThreads()
  if (configLoading || configError) return null
  if (!config?.configured) return <div className="sidebar-plan"><div><span><Sparkles size={13} /> Workspace AI</span><b>Disabled</b></div><p>No active model or token quota.</p>{admin && <NavLink to="/dashboard/admin/workspaces">Configure workspace</NavLink>}</div>
  const percent = config.monthlyTokenLimit > 0 ? Math.min(100, Math.round(config.usedTokens / config.monthlyTokenLimit * 100)) : 0
  return <div className="sidebar-plan"><div><span><Sparkles size={13} /> {config.modelName || 'Workspace AI'}</span><b>{percent}% used</b></div><i><b style={{ width: `${percent}%` }} /></i><p>{config.usedTokens.toLocaleString()} of {config.monthlyTokenLimit.toLocaleString()} tokens</p>{admin && <NavLink to="/dashboard/admin/workspaces">Manage AI routing</NavLink>}</div>
}

function ServerPicker({ servers, value, onChange }: { servers: Server[]; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selected = servers.find(server => server.id === value)

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    } else {
      setSearch('')
    }
  }, [open])

  const filteredServers = servers.filter(server =>
    `${server.name} ${server.host} ${server.environment}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className={cn('server-picker', open && 'open')} ref={root}>
      <button
        className={cn('server-picker-trigger', !selected && 'placeholder')}
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <i className={cn('server-picker-icon', selected ? selected.status.toLowerCase() : 'offline')}>
          <ServerIcon size={14} />
        </i>
        <span>
          <b>{selected ? selected.name : 'Select server'}</b>
          <small>{selected ? selected.environment : 'Required for chat'}</small>
        </span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="server-picker-menu" role="listbox">
          <header>
            <span>Target server</span>
            <small>{servers.filter(server => server.status === 'Online').length} online</small>
          </header>

          <div className="server-picker-search">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search server name, IP, environment..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>

          <div className="server-picker-list">
            {filteredServers.length === 0 ? (
              <div className="server-picker-empty">No matching servers</div>
            ) : (
              filteredServers.map(server => (
                <button
                  type="button"
                  role="option"
                  aria-selected={server.id === value}
                  disabled={server.status === 'Offline'}
                  className={server.id === value ? 'selected' : ''}
                  key={server.id}
                  onClick={() => {
                    onChange(server.id)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <i className={cn('server-option-icon', server.status.toLowerCase())}>
                    <ServerIcon size={14} />
                  </i>
                  <span>
                    <b>{server.name}</b>
                    <small>{server.host} / {server.environment}</small>
                  </span>
                  <em>
                    <i />
                    {server.status}
                  </em>
                  {server.id === value && <Check size={14} />}
                </button>
              ))
            )}
          </div>

          <footer>
            <ShieldCheck size={12} /> Commands run only on selected server
          </footer>
        </div>
      )}
    </div>
  )
}

function getStoredPolicy(): ChatPolicy {
  try {
    const raw = localStorage.getItem('opsai_preferred_policy')
    if (raw === 'approval_required' || raw === 'explain_only' || raw === 'unrestricted_approval' || raw === 'autonomous_full_access') return raw
  } catch {}
  return 'approval_required'
}

function setStoredPolicy(policy: ChatPolicy) {
  try {
    localStorage.setItem('opsai_preferred_policy', policy)
  } catch {}
}

const dynamicPlaceholders = [
  'e.g. Check disk usage and largest directories',
  'e.g. Inspect top memory and CPU consuming processes',
  'e.g. Show active containers and recent restart status',
  'e.g. Check nginx or systemd failed services and review logs',
  'e.g. Run a comprehensive server health diagnostic',
  'e.g. Install speedtest-cli and check download latency',
]

function Composer({ servers, selectedServer, setSelectedServer, onSubmit, compact = false, disabled = false, disabledReason = '', preset = '', onCancel, busy = false }: { servers: Server[]; selectedServer: string; setSelectedServer?: (id: string) => void; onSubmit: (prompt: string, policy: ChatPolicy) => Promise<void>; compact?: boolean; disabled?: boolean; disabledReason?: string; preset?: string; onCancel?: () => void; busy?: boolean }) {
  const [prompt, setPrompt] = useState(preset)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [policy, setPolicyState] = useState<ChatPolicy | ''>('')
  const [policyOpen, setPolicyOpen] = useState(false)
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const policyRoot = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    if (compact) return
    const interval = setInterval(() => {
      setPlaceholderIndex(prev => (prev + 1) % dynamicPlaceholders.length)
    }, 4500)
    return () => clearInterval(interval)
  }, [compact])

  const setPolicy = (next: ChatPolicy) => {
    setPolicyState(next)
  }
  useEffect(() => {
    const focusComposer = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key.length !== 1) return
      const target = event.target as HTMLElement | null
      if (target && (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') || target.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      if (disabled || submitting) return
      const area = textareaRef.current
      if (!area || document.activeElement === area) return
      area.focus()
    }
    document.addEventListener('keydown', focusComposer)
    return () => document.removeEventListener('keydown', focusComposer)
  }, [disabled, submitting])

  useEffect(() => { if (preset) setPrompt(preset) }, [preset])
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!policyRoot.current?.contains(event.target as Node)) setPolicyOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPolicyOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])
  const submit = async () => {
    if (!prompt.trim() || disabled || submitting || !selectedServer || !policy) return
    const submittedPrompt = prompt.trim()
    setPrompt(''); setSubmitting(true); setError('')
    try { await onSubmit(submittedPrompt, policy) }
    catch (caught) { setPrompt(submittedPrompt); setError(caught instanceof Error ? caught.message : 'Unable to send message') }
    finally { setSubmitting(false) }
  }
  const currentPlaceholder = compact ? 'Ask a follow-up...' : dynamicPlaceholders[placeholderIndex]
  const selectedPolicyObj = policies.find(item => item.value === policy)
  return <div className={cn('composer', compact && 'compact-composer')}>
    <textarea ref={textareaRef} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder={currentPlaceholder} aria-label="Ask OpsAI" rows={compact ? 1 : 3} disabled={disabled || submitting} />
    {error && <div className="auth-error composer-error" role="alert"><AlertTriangle size={14} /> {error}</div>}
    <div className="composer-footer"><div className="composer-tools">{setSelectedServer && <ServerPicker servers={servers} value={selectedServer} onChange={setSelectedServer} />}<div className="composer-tool-popover" ref={policyRoot}><button type="button" className={cn('mode-button', !policy && 'placeholder', policyOpen && 'active')} onClick={() => setPolicyOpen(open => !open)} aria-label="Execution policy" aria-haspopup="listbox" aria-expanded={policyOpen}><ShieldCheck size={15} /> {selectedPolicyObj ? selectedPolicyObj.label : 'Select mode'} <ChevronDown size={13} /></button>{policyOpen && <div className="tool-menu policy-menu" role="listbox" aria-label="Execution policy options"><header><span>Execution policy</span><small>Required</small></header>{policies.map(item => <button type="button" role="option" aria-selected={item.value === policy} className={item.value === policy ? 'selected' : ''} key={item.value} onClick={() => { setPolicy(item.value); setPolicyOpen(false) }}><i><ShieldCheck size={15} /></i><span><b>{item.label}</b><small>{item.description}</small></span>{item.value === policy && <Check size={14} />}</button>)}</div>}</div></div>{busy && onCancel ? <button className="button danger-button" style={{ height: 32, padding: '0 12px', fontSize: 11 }} onClick={() => void onCancel()} aria-label="Stop operation"><Square size={11} fill="currentColor" /> Stop process</button> : <button className="send-button" onClick={() => void submit()} disabled={!prompt.trim() || disabled || submitting || !selectedServer || !policy} aria-label="Send">{submitting ? <span className="tiny-spinner" /> : <Sparkles size={17} />}</button>}</div>
    {selectedPolicyObj && <p className="composer-policy-scope">{selectedPolicyObj.description}</p>}
    {!selectedPolicyObj && !disabledReason && <p className="composer-policy-scope" style={{ color: '#9d9da4' }}>Select an execution mode (Approval required, Full access, or Explain only) to send.</p>}
    {disabledReason && <p className="composer-disabled-reason">{disabledReason}</p>}
  </div>
}

const suggestions = [
  ['Run a health check', 'CPU, memory, disk, services'],
  ['Find high CPU processes', 'Inspect current resource pressure'],
  ['Inspect running containers', 'Status, health, recent restarts'],
  ['Show failed services', 'Read-only systemd state inspection'],
]

export function ChatHomePage() {
  const navigate = useNavigate()
  const { refresh, config, configLoading, configError } = useChatThreads()
  const [servers, setServers] = useState<Server[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preset, setPreset] = useState('')
  const [showNoServerModal, setShowNoServerModal] = useState(false)

  const loadServers = useCallback(async () => {
    try {
      const result = await serversApi.list()
      setServers(result.servers)
      setSelected('')
      if (result.servers.length === 0) {
        setShowNoServerModal(true)
      } else {
        setShowNoServerModal(false)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load chat configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  const submit = async (content: string, policy: ChatPolicy) => {
    const created = await chatApi.createThread({ serverId: selected, title: content.slice(0, 80) })
    navigate(`/dashboard/chat/${created.id}`, { state: { prompt: content, policy } })
    void refresh()
  }

  return (
    <div className="home-page page-enter">
      <div className="ambient-grid" />
      <section className="hero">
        <h1>What needs attention<br />across your <em>servers?</em></h1>
        <p className="hero-copy">Diagnose incidents, inspect infrastructure, and execute approved commands from one focused workspace.</p>
        {(error || configError) && <div className="auth-error" role="alert"><AlertTriangle size={14} /> {error || configError}</div>}
        {!loading && !configLoading && !error && !configError && config?.configured === false ? (
          <div className="chat-empty-state"><AlertTriangle size={24} /><strong>Workspace AI unavailable</strong><p>Workspace AI is not configured. Ask platform admin to assign an active model and token quota.</p></div>
        ) : (
          <Composer
            servers={servers}
            selectedServer={selected}
            setSelectedServer={setSelected}
            onSubmit={submit}
            preset={preset}
            disabled={loading || configLoading || Boolean(error || configError) || servers.length === 0}
            disabledReason={servers.length === 0 ? 'Connect a server to start a chat.' : ''}
          />
        )}
        <div className="trust-line"><ShieldCheck size={14} /> Selected server defines operation scope. Every execution requires approval.</div>
      </section>
      <section className="suggestions">
        <div className="section-kicker">Prompt templates</div>
        <div className="suggestion-grid">
          {suggestions.map(([prompt, meta], index) => (
            <button
              key={prompt}
              className="suggestion-card"
              style={{ animationDelay: `${index * 80 + 200}ms` }}
              disabled={!selected}
              onClick={() => setPreset(prompt)}
            >
              <div className="suggestion-icon"><Command size={18} /></div>
              <div><strong>{prompt}</strong><span>{meta}</span></div>
            </button>
          ))}
        </div>
      </section>

      {!loading && showNoServerModal && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="no-server-title">
          <button className="modal-scrim" onClick={() => setShowNoServerModal(false)} aria-label="Close" />
          <div className="modal-card" style={{ maxWidth: 440, textAlign: 'center' }}>
            <div className="modal-header" style={{ justifyContent: 'center', paddingBottom: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', marginBottom: 12, border: '1px solid #7657ff20' }}>
                  <ServerIcon size={24} />
                </div>
                <span className="page-eyebrow" style={{ color: 'var(--accent)' }}>Infrastructure Required</span>
                <h2 id="no-server-title" style={{ fontSize: 20, margin: '4px 0 0' }}>No Servers Connected</h2>
              </div>
            </div>
            <div className="modal-body" style={{ padding: '16px 24px 20px' }}>
              <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                To start AI diagnostic chats and terminal executions, connect at least one VPS or cloud server to your workspace.
              </p>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'center', gap: 10, padding: '16px 24px' }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowNoServerModal(false)}
                style={{ flex: 1 }}
              >
                Close
              </button>
              <NavLink
                to="/dashboard/servers"
                className="button dark"
                style={{ flex: 1, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                Connect Server
              </NavLink>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function useOperationEvents(operation: Operation | null, onState: () => void) {
  const [events, setEvents] = useState<OperationEvent[]>([])
  const [connection, setConnection] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'>('idle')
  const lastId = useRef('')
  const onStateRef = useRef(onState)
  onStateRef.current = onState
  useEffect(() => {
    setEvents([]); lastId.current = ''
    if (!operation) { setConnection('idle'); return }
    if (typeof EventSource === 'undefined') { setConnection('closed'); return }
    let source: EventSource | null = null; let timer = 0; let refreshTimer = 0; let stopped = false; let attempts = 0
    const scheduleStateRefresh = () => {
      if (refreshTimer) return
      refreshTimer = window.setTimeout(() => { refreshTimer = 0; if (!stopped) onStateRef.current() }, 300)
    }
    const connect = () => {
      if (stopped) return
      setConnection(attempts ? 'reconnecting' : 'connecting')
      source = new EventSource(operationEventsUrl(operation.id, lastId.current), { withCredentials: true })
      source.onopen = () => { attempts = 0; setConnection('connected') }
      const receive = (message: MessageEvent) => {
        const event = operationEventFromMessage(message)
        if (event.id) lastId.current = event.id
        setEvents(current => reduceOperationEvents(current, [event]))
        if (lifecycleEventTypes.has(event.type) || (event.status && finalStatuses.has(event.status))) scheduleStateRefresh()
        if (streamFinalEventTypes.has(event.type)) { source?.close(); setConnection('closed') }
      }
      source.addEventListener('message', receive as EventListener)
      for (const type of operationEventTypes) source.addEventListener(type, receive as EventListener)
      source.onerror = () => { source?.close(); if (stopped || finalStatuses.has(operation.status)) { setConnection('closed'); return }; attempts += 1; setConnection('reconnecting'); timer = window.setTimeout(connect, Math.min(1000 * (2 ** (attempts - 1)), 10000)) }
    }
    connect()
    return () => { stopped = true; window.clearTimeout(timer); window.clearTimeout(refreshTimer); source?.close() }
  }, [operation?.id])
  const summaryEvents = events.filter(event => ['assistant.delta', 'summary.started', 'summary.completed', 'summary.failed', 'summarizing'].includes(event.type))
  const summaryText = summaryEvents.filter(event => event.type === 'assistant.delta').map(event => event.text).join('') || [...summaryEvents].reverse().find(event => event.type === 'summary.failed' && event.text)?.text || ''
  const summaryMessageId = [...summaryEvents].reverse().find(event => event.messageId)?.messageId
  const summaryPhase = summaryEvents.some(event => event.type === 'summary.failed') ? 'failed' : summaryEvents.some(event => event.type === 'summary.completed') ? 'completed' : summaryEvents.length ? 'summarizing' : 'idle'
  const agentThinking = [...events].reverse().find(event => ['agent.thinking', 'flow.updated', 'step.started', 'step.completed', 'step.failed', 'summary.started', 'summarizing', 'summary.completed', 'summary.failed', 'completed', 'failed', 'cancelled'].includes(event.type))?.type === 'agent.thinking'
  return { events, connection, summaryText, summaryMessageId, summaryPhase, agentThinking }
}

const operationStages = ['Request received', 'AI determining action', 'Flow ready', 'Executing', 'Explanation'] as const

function operationStageStates(status: string, summarizing: boolean): Array<'done' | 'current' | 'pending'> {
  if (summarizing || ['summarizing', 'summary_started'].includes(status)) return ['done', 'done', 'done', 'done', 'current']
  if (['succeeded', 'completed'].includes(status)) return ['done', 'done', 'done', 'done', 'done']
  if (['running', 'executing', 'failed', 'cancelled', 'canceled'].includes(status)) return ['done', 'done', 'done', 'current', 'pending']
  if (['approved', 'queued'].includes(status)) return ['done', 'done', 'done', 'current', 'pending']
  if (approvalStatuses.has(status) || ['planned', 'plan_ready', 'rejected'].includes(status)) return ['done', 'done', 'current', 'pending', 'pending']
  return ['done', 'current', 'pending', 'pending', 'pending']
}

function OperationCard({ operation, summarizing, agentThinking, actionPending, mutate }: { operation: Operation; summarizing: boolean; agentThinking?: boolean; actionPending?: boolean; mutate?: (action: 'approve' | 'reject' | 'cancel' | 'retry') => Promise<void> }) {
  const completed = operation.steps.filter(step => ['completed', 'succeeded', 'success'].includes(step.status)).length
  const progress = summarizing ? 100 : operation.steps.length ? Math.round(completed / operation.steps.length * 100) : 0
  const pendingApproval = approvalStatuses.has(operation.status)
  const stageStates = operationStageStates(operation.status, summarizing)
  if (agentThinking) stageStates.splice(0, stageStates.length, 'done', 'current', 'pending', 'pending', 'pending')
  const stages = operationStages.map((stage, index) => index === 1 && agentThinking ? 'AI determining next step' : stage)
  return <div className="plan-card"><div className="plan-head"><div><i><Command size={17} /></i><span><strong>{operation.title}</strong><small>{operation.steps.length} steps / {operation.status.replaceAll('_', ' ')}</small></span></div><div className="plan-badges">{operation.agentRound != null && <span className="round-badge">Round {operation.agentRound}</span>}<span className={cn('risk-badge', finalStatuses.has(operation.status) && 'complete')}><ShieldCheck size={13} /> {operation.status.replaceAll('_', ' ')}</span></div></div>
    <ol className="operation-stages" data-testid="operation-stages">{stages.map((stage, index) => <li key={index} data-state={stageStates[index]} className={stageStates[index]}><i>{stageStates[index] === 'done' ? <Check size={10} /> : index + 1}</i><span>{stage}</span></li>)}</ol>
    {(busyStatuses.has(operation.status) || summarizing) && <div className="operation-progress"><div><span>Operation progress</span><b>{progress}%</b></div><i><b style={{ width: `${progress}%` }} /></i><small>{summarizing ? 'Commands complete. Generating explanation...' : `${completed} of ${operation.steps.length} steps completed`}</small></div>}
    {operation.summary && <div className="operation-summary"><MarkdownMessage>{operation.summary}</MarkdownMessage></div>}
    <div className="plan-steps">{operation.steps.map((step, index) => <div key={step.id} className={cn(['completed', 'succeeded', 'success'].includes(step.status) && 'done', step.status === 'running' && 'running')}><i>{['completed', 'succeeded', 'success'].includes(step.status) ? <Check size={13} /> : index + 1}</i><span>{step.title}{step.command && <code className="plan-command">{step.command}</code>}{step.stdout && <code className="plan-step-output">{step.stdout}</code>}{step.stderr && <code className="plan-step-output stderr">{step.stderr}</code>}</span><b>{step.exitCode != null ? `${step.status} (${step.exitCode})` : step.status}</b></div>)}</div>
    {operation.error && <div className="auth-error" role="alert"><AlertTriangle size={14} /> {operation.error}</div>}
    {pendingApproval && mutate && <div className="plan-actions"><button className="button secondary" disabled={actionPending} onClick={() => void mutate('reject')}>Reject</button><button className="button dark" disabled={actionPending} onClick={() => void mutate('approve')}><Play size={13} /> Approve & run</button></div>}
    {operation.status === 'failed' && mutate && <div className="plan-actions"><button className="button dark" disabled={actionPending} onClick={() => void mutate('retry')}>Retry operation</button></div>}
  </div>
}

type TimelineItem = { type: 'message'; message: ChatMessage; time: number; order: number } | { type: 'operation'; operation: Operation; time: number; order: number }

function timestamp(value?: string) {
  const parsed = value ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function compareTimelineItems(left: TimelineItem, right: TimelineItem) {
  if (left.type === 'message' && right.type === 'message') {
    if (left.message.sequence != null && right.message.sequence != null && left.message.sequence !== right.message.sequence) return left.message.sequence - right.message.sequence
    const timeDifference = left.time - right.time
    if (timeDifference) return timeDifference
    const roleOrder = { user: 0, assistant: 1, system: 2 }
    const roleDifference = roleOrder[left.message.role] - roleOrder[right.message.role]
    if (roleDifference) return roleDifference
  }
  return left.time - right.time || left.order - right.order
}

function buildTimeline(messages: ChatMessage[], operations: Operation[], hiddenMessageId?: string) {
  const visibleMessages = messages.filter(message => message.kind !== 'plan' && message.id !== hiddenMessageId)
  const planTimes = new Map<string, number>()
  messages.forEach(message => {
    if (message.kind !== 'plan' || !message.operationId) return
    planTimes.set(message.operationId, Math.max(planTimes.get(message.operationId) ?? Number.NEGATIVE_INFINITY, timestamp(message.createdAt)))
  })
  const items: TimelineItem[] = visibleMessages.map((message, order) => ({ type: 'message', message, time: timestamp(message.createdAt), order }))
  operations.forEach((operation, index) => {
    const associatedRequestTimes = messages
      .filter(message => message.operationId === operation.id && (message.role === 'user' || message.kind === 'plan'))
      .map(message => timestamp(message.createdAt))
      .filter(Number.isFinite)
    const explicitAnchor = Math.max(timestamp(operation.createdAt), planTimes.get(operation.id) ?? Number.NEGATIVE_INFINITY, ...associatedRequestTimes)
    items.push({ type: 'operation', operation, time: Number.isFinite(explicitAnchor) ? explicitAnchor : timestamp(operation.createdAt), order: messages.length + index })
  })
  items.sort(compareTimelineItems)

  // Explicit associations override ambiguous equal/missing timestamps.
  for (const operation of operations) {
    const operationIndex = items.findIndex(item => item.type === 'operation' && item.operation.id === operation.id)
    if (operationIndex < 0) continue
    const requestIndexes = items.flatMap((item, index) => item.type === 'message' && item.message.operationId === operation.id && item.message.role === 'user' ? [index] : [])
    const resultIndexes = items.flatMap((item, index) => item.type === 'message' && item.message.operationId === operation.id && item.message.kind === 'result' ? [index] : [])
    const afterRequest = requestIndexes.length ? Math.max(...requestIndexes) + 1 : operationIndex
    const beforeResult = resultIndexes.length ? Math.min(...resultIndexes) : items.length
    if (operationIndex < afterRequest || operationIndex > beforeResult) {
      const [item] = items.splice(operationIndex, 1)
      const adjustedRequest = operationIndex < afterRequest ? afterRequest - 1 : afterRequest
      const adjustedResult = resultIndexes.length ? items.findIndex(candidate => candidate.type === 'message' && candidate.message.operationId === operation.id && candidate.message.kind === 'result') : items.length
      items.splice(Math.min(adjustedRequest, adjustedResult < 0 ? items.length : adjustedResult), 0, item)
    }
  }

  // Conversation replies have stronger ordering than ambiguous timestamps.
  for (const message of visibleMessages) {
    if (!message.replyToMessageId || message.operationId || message.kind === 'result') continue
    const replyIndex = items.findIndex(item => item.type === 'message' && item.message.id === message.id)
    const parentIndex = items.findIndex(item => item.type === 'message' && item.message.id === message.replyToMessageId)
    if (replyIndex < 0 || parentIndex < 0 || replyIndex === parentIndex + 1) continue
    const [reply] = items.splice(replyIndex, 1)
    const adjustedParentIndex = items.findIndex(item => item.type === 'message' && item.message.id === message.replyToMessageId)
    items.splice(adjustedParentIndex + 1, 0, reply)
  }
  return items
}

function ExecutionPanel({ operation, events, connection, cancel, actionPending }: { operation: Operation; events: OperationEvent[]; connection: string; cancel: () => Promise<void>; actionPending: boolean }) {
  const [filter, setFilter] = useState<'session' | 'stderr'>('session')
  const terminalRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)
  const output = filter === 'stderr' ? events.filter(event => event.type === 'stderr') : events.filter(event => ['stdout', 'stderr', 'command', 'system', 'message'].includes(event.type))

  const onScroll = () => {
    if (!terminalRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current
    // If user is near bottom (within 40px), keep auto-scroll active; otherwise pause auto-scroll
    const atBottom = scrollHeight - scrollTop - clientHeight < 40
    userScrolledUp.current = !atBottom
  }

  useEffect(() => {
    if (!terminalRef.current) return
    if (!userScrolledUp.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [output.length])

  const download = () => {
    const value = events.map(event => `${event.createdAt || ''} [${event.type}] ${event.text}`).join('\n')
    const url = URL.createObjectURL(new Blob([value], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = `operation-${operation.id}.log`; link.click(); URL.revokeObjectURL(url)
  }
  return <aside className="execution-panel"><div className="execution-head"><div><span className={cn('execution-state', busyStatuses.has(operation.status) && 'running', finalStatuses.has(operation.status) && 'complete')}><i />{operation.status.replaceAll('_', ' ')}</span><h3>SSH terminal</h3></div><button className="icon-button" onClick={download} aria-label="Download log"><Download size={16} /></button></div><div className="execution-context"><span><ServerIcon size={14} /> {operation.serverName || operation.serverId || 'Server scope unavailable'}</span><span><Clock3 size={14} /> {connection}</span></div>
    <div className="terminal" ref={terminalRef} onScroll={onScroll}><div className="terminal-toolbar"><span>Operation event stream</span><div><button className={filter === 'session' ? 'active' : ''} onClick={() => setFilter('session')}>session</button><button className={filter === 'stderr' ? 'active' : ''} onClick={() => setFilter('stderr')}>stderr</button></div></div><div className="terminal-lines">{output.length === 0 ? <div className="terminal-filter-empty"><Terminal size={22} /><strong>No {filter === 'stderr' ? 'stderr ' : ''}output yet</strong><span>{connection === 'reconnecting' ? 'Reconnecting to event stream...' : 'Waiting for operation events.'}</span></div> : output.map((event, index) => <div className={cn('log-line', event.type)} key={event.id || index}><span className="log-time">{event.createdAt ? new Date(event.createdAt).toLocaleTimeString() : ''}</span><code>{event.text || ' '}</code></div>)}</div></div>
    <div className="execution-foot"><span>{operation.exitCode != null ? <><CheckCircle2 size={15} /> Exit code {operation.exitCode}</> : connection === 'reconnecting' ? 'Reconnecting...' : connection}</span>{busyStatuses.has(operation.status) && <button disabled={actionPending} onClick={() => void cancel()}><Square size={12} fill="currentColor" /> Stop</button>}</div>
  </aside>
}

export function ChatThreadPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { refresh: refreshThreads } = useChatThreads()
  const dialog = useDialog()
  const [thread, setThread] = useState<ChatThread | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [operations, setOperations] = useState<Operation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const [pending, setPending] = useState<{ id: string; content: string; policy: ChatPolicy } | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [terminalMinimized, setTerminalMinimized] = useState(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const conversationRef = useRef<HTMLDivElement>(null)
  const previousScrollHeight = useRef<number | null>(null)
  const initialScrollDone = useRef(false)
  const mounted = useRef(true)
  const currentId = useRef(id)
  const loadGeneration = useRef(0)
  const pendingLocation = useRef(location.state as { prompt?: string; policy?: ChatPolicy } | null)
  const endRef = useRef<HTMLDivElement>(null)
  const renderedItems = useRef('')
  currentId.current = id
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    const requestedId = id
    try {
      const [nextThread, nextMessages, operations] = await Promise.all([
        chatApi.getThread(requestedId),
        chatApi.listMessages(requestedId, { limit: 30 }),
        chatApi.listOperations({ threadId: requestedId }),
      ])
      if (!mounted.current || currentId.current !== requestedId || loadGeneration.current !== generation) return
      setThread(nextThread)
      setMessages(nextMessages)
      setHasMoreOlder(nextMessages.length >= 30)
      setOperations(operations)
      setPending(current => current && nextMessages.some(message => message.role === 'user' && message.content === current.content) && operations.length ? null : current)
      setError('')
    } catch (caught) {
      if (mounted.current && currentId.current === requestedId && loadGeneration.current === generation) setError(caught instanceof Error ? caught.message : 'Unable to load chat')
    } finally {
      if (mounted.current && currentId.current === requestedId && loadGeneration.current === generation) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    setLoading(true)
    setHasMoreOlder(true)
    initialScrollDone.current = false
    void load()
  }, [load])

  const loadOlderMessages = async () => {
    if (loadingOlder || !hasMoreOlder || messages.length === 0 || !thread) return
    const oldestMessage = messages[0]
    if (oldestMessage?.sequence == null) return

    setLoadingOlder(true)
    if (conversationRef.current) {
      previousScrollHeight.current = conversationRef.current.scrollHeight
    }
    try {
      const older = await chatApi.listMessages(thread.id, {
        limit: 30,
        beforeSequence: oldestMessage.sequence,
      })
      if (!mounted.current || currentId.current !== thread.id) return
      if (older.length < 30) {
        setHasMoreOlder(false)
      }
      setMessages(current => {
        const existingIds = new Set(current.map(m => m.id))
        const newOnes = older.filter(m => !existingIds.has(m.id))
        return [...newOnes, ...current]
      })
    } catch {
      // Silently ignore or retry on next scroll
    } finally {
      if (mounted.current) setLoadingOlder(false)
    }
  }

  const handleConversationScroll = () => {
    if (!conversationRef.current) return
    if (conversationRef.current.scrollTop <= 40 && hasMoreOlder && !loadingOlder) {
      void loadOlderMessages()
    }
  }

  useEffect(() => {
    if (previousScrollHeight.current != null && conversationRef.current) {
      const addedHeight = conversationRef.current.scrollHeight - previousScrollHeight.current
      conversationRef.current.scrollTop += addedHeight
      previousScrollHeight.current = null
    }
  }, [messages])
  const operation = operations.reduce<Operation | null>((latest, candidate) => {
    if (!latest) return candidate
    const latestTime = timestamp(latest.createdAt)
    const candidateTime = timestamp(candidate.createdAt)
    if (!Number.isFinite(latestTime) && !Number.isFinite(candidateTime)) return latest
    return candidateTime > latestTime ? candidate : latest
  }, null)
  const { events, connection, summaryText, summaryMessageId, summaryPhase, agentThinking } = useOperationEvents(operation, () => { void load() })
  const mutate = async (action: 'approve' | 'reject' | 'cancel' | 'retry') => {
    if (!operation || actionPending) return
    setActionPending(true)
    const confirmed = await dialog.confirm(action === 'approve' ? {
      title: 'Approve server operation?',
      description: operation.policy === 'unrestricted_approval' ? `${operation.serverName || thread?.serverName || 'Selected server'} will run unrestricted shell commands shown below. Commands can modify or delete data, install software, access credentials, and make network requests. Approve only commands you fully trust.` : `${operation.serverName || thread?.serverName || 'Selected server'} will run a bounded read-only investigation: these commands, then safe read-only checks within 4 decision rounds and 12 total steps. No writes or unrestricted shell access.`,
      confirmLabel: 'Approve & run', tone: 'accent',
      details: (operation.steps.some(step => step.status === 'pending') ? operation.steps.filter(step => step.status === 'pending') : operation.steps).map(step => ({ title: step.title, detail: step.command || 'No command supplied' })),
    } : action === 'retry' ? {
      title: 'Retry failed operation?', description: 'Pending checks will resume. If none remain, the last failed command will run again after approval.', confirmLabel: 'Prepare retry', tone: 'accent',
    } : action === 'reject' ? {
      title: 'Reject server operation?', description: 'This plan will not run. You can submit a revised request afterward.', confirmLabel: 'Reject operation', tone: 'destructive',
    } : {
      title: 'Cancel running operation?', description: 'Execution will stop after the current command can be interrupted safely.', confirmLabel: 'Cancel operation', tone: 'destructive',
    })
    if (!confirmed) { setActionPending(false); return }
    try {
      if (action === 'approve') await chatApi.approveOperation(operation.id)
      else if (action === 'reject') await chatApi.rejectOperation(operation.id)
      else if (action === 'cancel') await chatApi.cancelOperation(operation.id)
      else await chatApi.retryOperation(operation.id)
      await load()
    } catch (caught) {
      const description = caught instanceof Error ? caught.message : `Unable to ${action} operation`
      setError(description)
      await dialog.notice({ title: `Unable to ${action} operation`, description, tone: 'destructive' })
    } finally { setActionPending(false) }
  }
  const followUp = async (content: string, policy: ChatPolicy) => {
    if (pending) return
    const optimistic = { id: `pending-${Date.now()}`, content, policy }
    setPending(optimistic); setError('')
    try {
      const result = await chatApi.sendMessage(id, { content, policy })
      if (result.operation && mounted.current && currentId.current === id) setOperations(current => [result.operation!, ...current.filter(item => item.id !== result.operation!.id)])
      await load(); await refreshThreads()
      if (mounted.current && currentId.current === id) setPending(null)
    } catch (caught) {
      await load(); await refreshThreads()
      if (mounted.current && currentId.current === id) setPending(null)
      throw caught
    }
  }
  useEffect(() => {
    if (loading || !thread) return
    const state = pendingLocation.current
    if (!state?.prompt || !state.policy) return
    pendingLocation.current = null
    navigate(location.pathname, { replace: true, state: null })
    void followUp(state.prompt, state.policy).catch(caught => setError(caught instanceof Error ? caught.message : 'Unable to send message'))
  }, [loading, thread?.id])
  useEffect(() => {
    const itemIds = `${messages.map(message => message.id).join(',')}|${operations.map(item => item.id).join(',')}|${pending?.id || ''}|${summaryPhase !== 'idle' ? 'summary' : ''}`
    if (itemIds !== renderedItems.current) endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
    renderedItems.current = itemIds
  }, [messages, operations, pending?.id, summaryPhase])
  const rename = async () => {
    if (!thread || actionPending) return
    setActionPending(true)
    const title = (await dialog.prompt({ title: 'Rename chat', description: 'Give this operational thread a concise title.', label: 'Thread title', initialValue: thread.title, confirmLabel: 'Save title' }))?.trim()
    if (!title) { setActionPending(false); return }
    try { await chatApi.updateThread(id, { title, status: 'active' }); setMenu(false); await load(); await refreshThreads() }
    catch (caught) { const description = caught instanceof Error ? caught.message : 'Unable to rename chat'; setError(description); await dialog.notice({ title: 'Unable to rename chat', description, tone: 'destructive' }) }
    finally { setActionPending(false) }
  }
  const archive = async () => { if (!thread || busy) return; const title = thread.title; await chatApi.updateThread(id, { title, status: 'archived' }); await refreshThreads(); navigate('/dashboard/chat') }
  const remove = async () => {
    if (busy || actionPending) return
    setActionPending(true)
    if (!await dialog.confirm({ title: 'Delete chat?', description: `“${thread!.title}” and its conversation history will be permanently removed.`, confirmLabel: 'Delete chat', tone: 'destructive' })) { setActionPending(false); return }
    try { await chatApi.deleteThread(id); await refreshThreads(); navigate('/dashboard/chat') }
    catch (caught) { const description = caught instanceof Error ? caught.message : 'Unable to delete chat'; setError(description); await dialog.notice({ title: 'Unable to delete chat', description, tone: 'destructive' }) }
    finally { setActionPending(false) }
  }
  if (loading) return <div className="content-page"><p>Loading chat...</p></div>
  if (!thread) return <div className="content-page"><div className="auth-error" role="alert">{error || 'Chat not found'}</div></div>
  const busy = operation ? busyStatuses.has(operation.status) || approvalStatuses.has(operation.status) || summaryPhase === 'summarizing' : false
  const summaryPersisted = messages.some(message => message.role === 'assistant' && ((summaryMessageId && message.id === summaryMessageId) || (summaryText && message.content === summaryText)))
  const showStreamedSummary = summaryPhase !== 'idle' && !summaryPersisted && (summaryPhase === 'summarizing' || Boolean(summaryText))
  const timeline = buildTimeline(messages, operations, showStreamedSummary ? summaryMessageId : undefined)
  const renderMessage = (message: ChatMessage) => <div className={cn('message', message.role === 'user' ? 'user-message right-message' : 'ai-message left-message', message.kind === 'result' && 'result-message')} key={message.id} data-testid={`message-${message.id}`}><div className={cn('message-avatar', message.role !== 'user' && 'ai')}>{message.role === 'user' ? 'YOU' : <Sparkles size={16} />}</div><div className="message-content"><div className="message-meta"><strong>{message.role === 'user' ? 'You' : 'OpsAI'}</strong><span>{message.createdAt ? relativeTime(message.createdAt) : ''}</span></div>{message.role === 'user' ? <p>{message.content}</p> : <MarkdownMessage>{message.content}</MarkdownMessage>}{message.role === 'user' && <span className="target-chip"><ServerIcon size={13} /> {thread.serverName || thread.serverId}</span>}</div></div>
  const renderStreamedSummary = () => <div className="message ai-message left-message streamed-summary" data-testid="streamed-summary"><div className="message-avatar ai"><Sparkles size={16} /></div><div className="message-content"><div className="message-meta"><strong>OpsAI</strong>{summaryPhase === 'summarizing' && <span>OpsAI is explaining results...</span>}</div><MarkdownMessage streaming={summaryPhase === 'summarizing'}>{summaryText}</MarkdownMessage></div></div>
  return <div className={cn('thread-layout page-enter', terminalMinimized && 'terminal-minimized')}><section className="thread-main"><div className="thread-header"><div><span className="page-eyebrow">AI operation / {thread.serverName || 'Scoped server'}</span><h2>{thread.title}</h2></div>{operation && <button className="icon-button bordered" onClick={() => setTerminalMinimized(val => !val)} aria-label={terminalMinimized ? 'Show terminal' : 'Minimize terminal'} title={terminalMinimized ? 'Show terminal' : 'Minimize terminal'}><Terminal size={17} /></button>}</div>
    {error && <div className="auth-error" role="alert"><AlertTriangle size={14} /> {error}</div>}
    <div className="conversation" ref={conversationRef} onScroll={handleConversationScroll}>
      {loadingOlder && <div style={{ textAlign: 'center', padding: '10px 0', fontSize: 11, color: 'var(--muted)' }}><span className="tiny-spinner" style={{ marginRight: 6 }} /> Loading earlier messages...</div>}
      {messages.length === 0 && operations.length === 0 && !pending && <div className="chat-empty-state"><MessageSquare size={22} /><strong>No messages yet</strong></div>}{timeline.map(item => item.type === 'message' ? renderMessage(item.message) : <Fragment key={item.operation.id}><div className="message ai-message left-message operation-message" data-testid={`operation-${item.operation.id}`}><div className="message-avatar ai"><Command size={16} /></div><div className="message-content"><OperationCard operation={item.operation} summarizing={item.operation.id === operation?.id && summaryPhase === 'summarizing'} agentThinking={item.operation.id === operation?.id && agentThinking} actionPending={actionPending} mutate={item.operation.id === operation?.id ? mutate : undefined} /></div></div>{showStreamedSummary && item.operation.id === operation?.id && renderStreamedSummary()}</Fragment>)}
    {pending && <><div className="message user-message right-message" key={pending.id}><div className="message-avatar">YOU</div><div className="message-content"><div className="message-meta"><strong>You</strong><span>now</span></div><p>{pending.content}</p><span className="target-chip"><ServerIcon size={13} /> {thread.serverName || thread.serverId}</span></div></div><div className="message ai-message left-message"><div className="message-avatar ai"><Sparkles size={16} /></div><div className="message-content"><div className="message-meta"><strong>OpsAI</strong><span className="tiny-spinner" /></div><p>{pending.policy === 'explain_only' ? 'OpsAI is analyzing server snapshot...' : 'OpsAI is processing request and determining steps...'}</p></div></div></>}
    <div ref={endRef} /></div>
    <div className="thread-composer"><Composer compact servers={[]} selectedServer={thread.serverId} onSubmit={followUp} disabled={busy || Boolean(pending)} disabledReason={busy ? `Follow-up unavailable while operation is ${operation?.status.replaceAll('_', ' ')}.` : ''} busy={busy} onCancel={operation && busyStatuses.has(operation.status) ? () => void mutate('cancel') : undefined} /></div></section>
    {operation && !terminalMinimized && <ExecutionPanel operation={operation} events={events} connection={connection} cancel={() => mutate('cancel')} actionPending={actionPending} />}
  </div>
}

export function ExecutionsPage() {
  const [operations, setOperations] = useState<Operation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { chatApi.listOperations().then(setOperations).catch(caught => setError(caught instanceof Error ? caught.message : 'Unable to load executions')).finally(() => setLoading(false)) }, [])
  return <div className="content-page page-enter"><div className="page-heading"><div><span className="page-eyebrow">Operations</span><h1>Executions</h1><p>Every command, approval, and output reported by operation API.</p></div></div>{loading && <p>Loading executions...</p>}{error && <div className="auth-error" role="alert">{error}</div>}{!loading && !error && operations.length === 0 && <div className="chat-empty-state"><Terminal size={24} /><strong>No executions yet</strong><p>Approved chat operations appear here.</p></div>}{operations.length > 0 && <div className="execution-table" data-testid="executions-table"><div className="execution-table-head"><span>Operation</span><span>Server</span><span>Status</span><span>Steps</span><span>Created</span></div>{operations.map(operation => <NavLink to={operation.threadId ? `/dashboard/chat/${operation.threadId}` : '/dashboard/executions'} className="execution-table-row" key={operation.id}><span><i><Terminal size={16} /></i><span><strong>{operation.title}</strong><small>{operation.id}</small></span></span><span>{operation.serverName || operation.serverId || 'Unavailable'}</span><span><b className={cn('table-status', ['failed', 'cancelled', 'canceled', 'rejected'].includes(operation.status) && 'failed')}><i />{operation.status.replaceAll('_', ' ')}</b></span><span>{operation.steps.filter(step => ['completed', 'succeeded'].includes(step.status)).length} / {operation.steps.length}</span><span>{operation.createdAt ? new Date(operation.createdAt).toLocaleString() : '-'}</span></NavLink>)}</div>}</div>
}
