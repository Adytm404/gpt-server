import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Clock3, Command, Download, MessageSquare, MoreHorizontal, Play, Plus, Server as ServerIcon, ShieldCheck, Sparkles, Square, Terminal } from 'lucide-react'
import { chatApi, operationEventFromMessage, operationEventsUrl, reduceOperationEvents, type ChatConfig, type ChatMessage, type ChatPolicy, type ChatThread, type Operation, type OperationEvent } from '../api/chat'
import { serversApi, type Server } from '../api/servers'

const cn = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ')
const finalStatuses = new Set(['succeeded', 'completed', 'failed', 'cancelled', 'canceled', 'rejected'])
const busyStatuses = new Set(['planning', 'planned', 'approved', 'queued', 'running', 'executing', 'summarizing'])
const approvalStatuses = new Set(['pending_approval', 'awaiting_approval', 'requires_approval'])
const operationEventTypes = ['planning', 'plan_ready', 'approved', 'running', 'step.started', 'stdout', 'stderr', 'step.completed', 'completed', 'failed', 'cancelled', 'rejected', 'assistant.delta', 'summary.started', 'summary.completed', 'summary.failed', 'summarizing']
const streamFinalEventTypes = new Set(['summary.completed', 'summary.failed', 'cancelled', 'rejected'])
const lifecycleEventTypes = new Set(['planning', 'plan_ready', 'approved', 'running', 'step.started', 'step.completed', 'completed', 'failed', 'cancelled', 'rejected', 'summary.started', 'summary.completed', 'summary.failed'])

const policies: Array<{ value: ChatPolicy; label: string; description: string }> = [
  { value: 'approval_required', label: 'Approval required', description: 'AI plans commands; explicit approval; SSH executes.' },
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
  const { threads, loading, error } = useChatThreads()
  return <div className="sidebar-history"><div><span>Recent chats</span><NavLink to="/chat" aria-label="New chat"><Plus size={14} /></NavLink></div>
    {loading && <p className="chat-list-state">Loading chats...</p>}
    {!loading && error && <p className="chat-list-state" role="alert">{error}</p>}
    {!loading && !error && threads.length === 0 && <p className="chat-list-state">No recent chats</p>}
    {threads.map(thread => <NavLink key={thread.id} to={`/chat/${thread.id}`} className={({ isActive }) => cn('history-link', isActive && 'active')}><MessageSquare size={13} /><span><b>{thread.title}</b><small>{thread.serverName || 'Server scope unavailable'}</small></span><em>{relativeTime(thread.updatedAt || thread.createdAt)}</em></NavLink>)}
  </div>
}

export function WorkspaceAIUsage({ admin }: { admin: boolean }) {
  const { config, configLoading, configError } = useChatThreads()
  if (configLoading || configError) return null
  if (!config?.configured) return <div className="sidebar-plan"><div><span><Sparkles size={13} /> Workspace AI</span><b>Disabled</b></div><p>No active model or token quota.</p>{admin && <NavLink to="/admin/workspaces">Configure workspace</NavLink>}</div>
  const percent = config.monthlyTokenLimit > 0 ? Math.min(100, Math.round(config.usedTokens / config.monthlyTokenLimit * 100)) : 0
  return <div className="sidebar-plan"><div><span><Sparkles size={13} /> {config.modelName || 'Workspace AI'}</span><b>{percent}% used</b></div><i><b style={{ width: `${percent}%` }} /></i><p>{config.usedTokens.toLocaleString()} of {config.monthlyTokenLimit.toLocaleString()} tokens</p>{admin && <NavLink to="/admin/workspaces">Manage AI routing</NavLink>}</div>
}

function ServerPicker({ servers, value, onChange }: { servers: Server[]; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const selected = servers.find(server => server.id === value)
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  if (!selected) return null
  return <div className={cn('server-picker', open && 'open')} ref={root}><button className="server-picker-trigger" type="button" onClick={() => setOpen(value => !value)} aria-haspopup="listbox" aria-expanded={open}><i className={cn('server-picker-icon', selected.status.toLowerCase())}><ServerIcon size={14} /></i><span><b>{selected.name}</b><small>{selected.environment}</small></span><ChevronDown size={13} /></button>{open && <div className="server-picker-menu" role="listbox"><header><span>Target server</span><small>{servers.filter(server => server.status === 'Online').length} online</small></header>{servers.map(server => <button type="button" role="option" aria-selected={server.id === value} disabled={server.status === 'Offline'} className={server.id === value ? 'selected' : ''} key={server.id} onClick={() => { onChange(server.id); setOpen(false) }}><i className={cn('server-option-icon', server.status.toLowerCase())}><ServerIcon size={14} /></i><span><b>{server.name}</b><small>{server.host} / {server.environment}</small></span><em><i />{server.status}</em>{server.id === value && <Check size={14} />}</button>)}<footer><ShieldCheck size={12} /> Commands run only on selected server</footer></div>}</div>
}

function Composer({ servers, selectedServer, setSelectedServer, onSubmit, compact = false, disabled = false, disabledReason = '', preset = '' }: { servers: Server[]; selectedServer: string; setSelectedServer?: (id: string) => void; onSubmit: (prompt: string, policy: ChatPolicy) => Promise<void>; compact?: boolean; disabled?: boolean; disabledReason?: string; preset?: string }) {
  const [prompt, setPrompt] = useState(preset)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [policy, setPolicy] = useState<ChatPolicy>('approval_required')
  const [policyOpen, setPolicyOpen] = useState(false)
  const policyRoot = useRef<HTMLDivElement>(null)
  useEffect(() => { if (preset) setPrompt(preset) }, [preset])
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!policyRoot.current?.contains(event.target as Node)) setPolicyOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPolicyOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])
  const submit = async () => {
    if (!prompt.trim() || disabled || submitting || !selectedServer) return
    setSubmitting(true); setError('')
    try { await onSubmit(prompt.trim(), policy); setPrompt('') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to send message') }
    finally { setSubmitting(false) }
  }
  return <div className={cn('composer', compact && 'compact-composer')}>
    <textarea value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder={compact ? 'Ask a follow-up...' : 'Describe what you want to inspect...'} aria-label="Ask OpsAI" rows={compact ? 1 : 3} disabled={disabled || submitting} />
    {error && <div className="auth-error composer-error" role="alert"><AlertTriangle size={14} /> {error}</div>}
    <div className="composer-footer"><div className="composer-tools">{setSelectedServer && <ServerPicker servers={servers} value={selectedServer} onChange={setSelectedServer} />}<div className="composer-tool-popover" ref={policyRoot}><button type="button" className={cn('mode-button', policyOpen && 'active')} onClick={() => setPolicyOpen(open => !open)} aria-label="Execution policy" aria-haspopup="listbox" aria-expanded={policyOpen}><ShieldCheck size={15} /> {policies.find(item => item.value === policy)?.label} <ChevronDown size={13} /></button>{policyOpen && <div className="tool-menu policy-menu" role="listbox" aria-label="Execution policy options"><header><span>Execution policy</span><small>For this message</small></header>{policies.map(item => <button type="button" role="option" aria-selected={item.value === policy} className={item.value === policy ? 'selected' : ''} key={item.value} onClick={() => { setPolicy(item.value); setPolicyOpen(false) }}><i><ShieldCheck size={15} /></i><span><b>{item.label}</b><small>{item.description}</small></span>{item.value === policy && <Check size={14} />}</button>)}</div>}</div>{submitting && <span className="composer-planning"><span className="tiny-spinner" /> {policy === 'explain_only' ? 'Analyzing context...' : 'Planning operation...'}</span>}</div><button className="send-button" onClick={() => void submit()} disabled={!prompt.trim() || disabled || submitting || !selectedServer} aria-label="Send">{submitting ? <span className="tiny-spinner" /> : <Sparkles size={17} />}</button></div>
    <p className="composer-policy-scope">{policies.find(item => item.value === policy)?.description}</p>
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
  useEffect(() => {
    serversApi.list().then(result => {
      setServers(result.servers)
      const initial = result.servers.find(server => server.status === 'Online') || result.servers[0]
      setSelected(initial?.id || '')
    }).catch(caught => setError(caught instanceof Error ? caught.message : 'Unable to load chat configuration')).finally(() => setLoading(false))
  }, [])
  const submit = async (content: string, policy: ChatPolicy) => {
    const created = await chatApi.createThread({ serverId: selected, title: content.slice(0, 80) })
    try { await chatApi.sendMessage(created.id, { content, policy }) }
    catch (caught) { try { await chatApi.deleteThread(created.id) } catch { /* Best-effort cleanup keeps original planning error. */ }; await refresh(); throw caught }
    await refresh(); navigate(`/chat/${created.id}`)
  }
  const online = servers.filter(server => server.status === 'Online').length
  return <div className="home-page page-enter"><div className="ambient-grid" /><section className="hero"><div className="ai-orb"><div className="orb-core" /><div className="orb-ring ring-one" /><div className="orb-ring ring-two" /></div><div className="eyebrow"><span className="live-dot" /> {loading ? 'Loading server scope' : `${online} ${online === 1 ? 'server' : 'servers'} online`}</div><h1>What needs attention<br />across your <em>servers?</em></h1><p className="hero-copy">Diagnose incidents, inspect infrastructure, and execute approved commands from one focused workspace.</p>
    {(error || configError) && <div className="auth-error" role="alert"><AlertTriangle size={14} /> {error || configError}</div>}
    {!loading && !configLoading && !error && !configError && config?.configured === false ? <div className="chat-empty-state"><AlertTriangle size={24} /><strong>Workspace AI unavailable</strong><p>Workspace AI is not configured. Ask platform admin to assign an active model and token quota.</p></div> : !loading && !configLoading && !error && !configError && servers.length === 0 ? <><div className="chat-empty-state"><ServerIcon size={24} /><strong>No servers connected</strong><p>Connect a server before starting an operational chat.</p><NavLink className="button dark" to="/servers">Connect a server</NavLink></div><Composer servers={[]} selectedServer="" onSubmit={submit} disabled disabledReason="Connect a server to start a chat." /></> : config?.configured !== false && <Composer servers={servers} selectedServer={selected} setSelectedServer={setSelected} onSubmit={submit} preset={preset} disabled={loading || configLoading || Boolean(error || configError)} />}
    <div className="trust-line"><ShieldCheck size={14} /> Selected server defines operation scope. Every execution requires approval.</div></section>
    <section className="suggestions"><div className="section-kicker">Prompt templates</div><div className="suggestion-grid">{suggestions.map(([prompt, meta], index) => <button key={prompt} className="suggestion-card" style={{ animationDelay: `${index * 80 + 200}ms` }} disabled={!selected} onClick={() => setPreset(prompt)}><div className="suggestion-icon"><Command size={18} /></div><div><strong>{prompt}</strong><span>{meta}</span></div></button>)}</div></section>
  </div>
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
  return { events, connection, summaryText, summaryMessageId, summaryPhase }
}

function OperationCard({ operation, summarizing, mutate }: { operation: Operation; summarizing: boolean; mutate: (action: 'approve' | 'reject' | 'cancel') => Promise<void> }) {
  const completed = operation.steps.filter(step => ['completed', 'succeeded', 'success'].includes(step.status)).length
  const progress = summarizing ? 100 : operation.steps.length ? Math.round(completed / operation.steps.length * 100) : 0
  const pendingApproval = approvalStatuses.has(operation.status)
  return <div className="plan-card"><div className="plan-head"><div><i><Command size={17} /></i><span><strong>{operation.title}</strong><small>{operation.steps.length} steps / {operation.status.replaceAll('_', ' ')}</small></span></div><span className={cn('risk-badge', finalStatuses.has(operation.status) && 'complete')}><ShieldCheck size={13} /> {operation.status.replaceAll('_', ' ')}</span></div>
    {(busyStatuses.has(operation.status) || summarizing) && <div className="operation-progress"><div><span>Operation progress</span><b>{progress}%</b></div><i><b style={{ width: `${progress}%` }} /></i><small>{summarizing ? 'Commands complete. Generating explanation...' : `${completed} of ${operation.steps.length} steps completed`}</small></div>}
    {operation.summary && <p className="operation-summary">{operation.summary}</p>}
    <div className="plan-steps">{operation.steps.map((step, index) => <div key={step.id} className={cn(['completed', 'succeeded', 'success'].includes(step.status) && 'done', step.status === 'running' && 'running')}><i>{['completed', 'succeeded', 'success'].includes(step.status) ? <Check size={13} /> : index + 1}</i><span>{step.title}{step.command && <code className="plan-command">{step.command}</code>}{step.stdout && <code className="plan-step-output">{step.stdout}</code>}{step.stderr && <code className="plan-step-output stderr">{step.stderr}</code>}</span><b>{step.exitCode != null ? `${step.status} (${step.exitCode})` : step.status}</b></div>)}</div>
    {operation.error && <div className="auth-error" role="alert"><AlertTriangle size={14} /> {operation.error}</div>}
    {pendingApproval && <div className="plan-actions"><button className="button secondary" onClick={() => void mutate('reject')}>Reject</button><button className="button dark" onClick={() => void mutate('approve')}><Play size={13} /> Approve & run</button></div>}
  </div>
}

function ExecutionPanel({ operation, events, connection, cancel }: { operation: Operation; events: OperationEvent[]; connection: string; cancel: () => Promise<void> }) {
  const [filter, setFilter] = useState<'session' | 'stderr'>('session')
  const output = filter === 'stderr' ? events.filter(event => event.type === 'stderr') : events.filter(event => ['stdout', 'stderr', 'command', 'system', 'message'].includes(event.type))
  const download = () => {
    const value = events.map(event => `${event.createdAt || ''} [${event.type}] ${event.text}`).join('\n')
    const url = URL.createObjectURL(new Blob([value], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = `operation-${operation.id}.log`; link.click(); URL.revokeObjectURL(url)
  }
  return <aside className="execution-panel"><div className="execution-head"><div><span className={cn('execution-state', busyStatuses.has(operation.status) && 'running', finalStatuses.has(operation.status) && 'complete')}><i />{operation.status.replaceAll('_', ' ')}</span><h3>SSH terminal</h3></div><button className="icon-button" onClick={download} aria-label="Download log"><Download size={16} /></button></div><div className="execution-context"><span><ServerIcon size={14} /> {operation.serverName || operation.serverId || 'Server scope unavailable'}</span><span><Clock3 size={14} /> {connection}</span></div>
    <div className="terminal"><div className="terminal-toolbar"><span>Operation event stream</span><div><button className={filter === 'session' ? 'active' : ''} onClick={() => setFilter('session')}>session</button><button className={filter === 'stderr' ? 'active' : ''} onClick={() => setFilter('stderr')}>stderr</button></div></div><div className="terminal-lines">{output.length === 0 ? <div className="terminal-filter-empty"><Terminal size={22} /><strong>No {filter === 'stderr' ? 'stderr ' : ''}output yet</strong><span>{connection === 'reconnecting' ? 'Reconnecting to event stream...' : 'Waiting for operation events.'}</span></div> : output.map((event, index) => <div className={cn('log-line', event.type)} key={event.id || index}><span className="log-time">{event.createdAt ? new Date(event.createdAt).toLocaleTimeString() : ''}</span><code>{event.text || ' '}</code></div>)}</div></div>
    <div className="execution-foot"><span>{operation.exitCode != null ? <><CheckCircle2 size={15} /> Exit code {operation.exitCode}</> : connection === 'reconnecting' ? 'Reconnecting...' : connection}</span>{busyStatuses.has(operation.status) && <button onClick={() => void cancel()}><Square size={12} fill="currentColor" /> Stop</button>}</div>
  </aside>
}

export function ChatThreadPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { refresh: refreshThreads } = useChatThreads()
  const [thread, setThread] = useState<ChatThread | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [operation, setOperation] = useState<Operation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const mounted = useRef(true)
  const currentId = useRef(id)
  const loadGeneration = useRef(0)
  currentId.current = id
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    const requestedId = id
    try {
      const [nextThread, nextMessages, operations] = await Promise.all([chatApi.getThread(requestedId), chatApi.listMessages(requestedId), chatApi.listOperations({ threadId: requestedId })])
      if (!mounted.current || currentId.current !== requestedId || loadGeneration.current !== generation) return
      setThread(nextThread); setMessages(nextMessages); setOperation(operations[0] || null); setError('')
    } catch (caught) { if (mounted.current && currentId.current === requestedId && loadGeneration.current === generation) setError(caught instanceof Error ? caught.message : 'Unable to load chat') }
    finally { if (mounted.current && currentId.current === requestedId && loadGeneration.current === generation) setLoading(false) }
  }, [id])
  useEffect(() => { setLoading(true); void load() }, [load])
  const { events, connection, summaryText, summaryMessageId, summaryPhase } = useOperationEvents(operation, () => { void load() })
  const mutate = async (action: 'approve' | 'reject' | 'cancel') => {
    if (!operation) return
    try {
      if (action === 'approve') await chatApi.approveOperation(operation.id)
      else if (action === 'reject') await chatApi.rejectOperation(operation.id)
      else await chatApi.cancelOperation(operation.id)
      await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : `Unable to ${action} operation`) }
  }
  const followUp = async (content: string, policy: ChatPolicy) => {
    try {
      const result = await chatApi.sendMessage(id, { content, policy })
      if (result.operation && mounted.current && currentId.current === id) setOperation(result.operation)
      await load(); await refreshThreads()
      if (!result.operation && result.message && mounted.current && currentId.current === id) setMessages(current => current.some(message => message.id === result.message?.id || (message.role === 'assistant' && message.content === result.message?.content)) ? current : [...current, result.message!])
    } catch (caught) {
      await load(); await refreshThreads()
      throw caught
    }
  }
  const rename = async () => { if (!thread) return; const title = window.prompt('Thread title', thread.title)?.trim(); if (!title) return; await chatApi.updateThread(id, { title, status: 'active' }); setMenu(false); await load(); await refreshThreads() }
  const archive = async () => { if (!thread || busy) return; const title = thread.title; await chatApi.updateThread(id, { title, status: 'archived' }); await refreshThreads(); navigate('/chat') }
  const remove = async () => { if (busy) return; if (!window.confirm('Delete this chat permanently?')) return; await chatApi.deleteThread(id); await refreshThreads(); navigate('/chat') }
  if (loading) return <div className="content-page"><p>Loading chat...</p></div>
  if (!thread) return <div className="content-page"><div className="auth-error" role="alert">{error || 'Chat not found'}</div></div>
  const busy = operation ? busyStatuses.has(operation.status) || approvalStatuses.has(operation.status) || summaryPhase === 'summarizing' : false
  const summaryPersisted = messages.some(message => message.role === 'assistant' && ((summaryMessageId && message.id === summaryMessageId) || (summaryText && message.content === summaryText)))
  const showStreamedSummary = summaryPhase !== 'idle' && !summaryPersisted && (summaryPhase === 'summarizing' || Boolean(summaryText))
  return <div className="thread-layout page-enter"><section className="thread-main"><div className="thread-header"><div><span className="page-eyebrow">AI operation / {thread.serverName || 'Scoped server'}</span><h2>{thread.title}</h2></div><div className="thread-menu"><button className="icon-button bordered" onClick={() => setMenu(value => !value)} aria-label="Thread actions"><MoreHorizontal size={18} /></button>{menu && <div><button onClick={() => void rename()}>Rename</button>{busy ? <span className="thread-menu-blocked">Cancel operation first to archive or delete.</span> : <><button onClick={() => void archive()}>Archive</button><button className="danger" onClick={() => void remove()}>Delete</button></>}</div>}</div></div>
    {error && <div className="auth-error" role="alert"><AlertTriangle size={14} /> {error}</div>}
    <div className="conversation">{messages.length === 0 && !operation && <div className="chat-empty-state"><MessageSquare size={22} /><strong>No messages yet</strong></div>}{messages.map(message => <div className={cn('message', message.role === 'user' ? 'user-message' : 'ai-message')} key={message.id}><div className={cn('message-avatar', message.role !== 'user' && 'ai')}>{message.role === 'user' ? 'YOU' : <Sparkles size={16} />}</div><div className="message-content"><div className="message-meta"><strong>{message.role === 'user' ? 'You' : 'OpsAI'}</strong><span>{message.createdAt ? relativeTime(message.createdAt) : ''}</span></div><p>{message.content}</p>{message.role === 'user' && <span className="target-chip"><ServerIcon size={13} /> {thread.serverName || thread.serverId}</span>}</div></div>)}
    {!operation && messages.some(message => message.role === 'user') && !messages.some(message => message.role === 'assistant') && <div className="message ai-message"><div className="message-avatar ai"><Sparkles size={16} /></div><div><div className="message-meta"><strong>OpsAI</strong><span>planning...</span></div><p>Building operation plan for selected server scope.</p><span className="tiny-spinner" /></div></div>}
    {operation && <div className="message ai-message"><div className="message-avatar ai"><Command size={16} /></div><div className="message-content"><OperationCard operation={operation} summarizing={summaryPhase === 'summarizing'} mutate={mutate} /></div></div>}
    {showStreamedSummary && <div className="message ai-message streamed-summary" data-testid="streamed-summary"><div className="message-avatar ai"><Sparkles size={16} /></div><div className="message-content"><div className="message-meta"><strong>OpsAI</strong>{summaryPhase === 'summarizing' && <span>OpsAI sedang menjelaskan hasil...</span>}</div><p>{summaryText}{summaryPhase === 'summarizing' && <i className="summary-cursor" aria-hidden="true" />}</p></div></div>}</div>
    <div className="thread-composer"><Composer compact servers={[]} selectedServer={thread.serverId} onSubmit={followUp} disabled={busy} disabledReason={busy ? `Follow-up unavailable while operation is ${operation?.status.replaceAll('_', ' ')}.` : ''} /></div></section>
    {operation && <ExecutionPanel operation={operation} events={events} connection={connection} cancel={() => mutate('cancel')} />}
  </div>
}

export function ExecutionsPage() {
  const [operations, setOperations] = useState<Operation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { chatApi.listOperations().then(setOperations).catch(caught => setError(caught instanceof Error ? caught.message : 'Unable to load executions')).finally(() => setLoading(false)) }, [])
  return <div className="content-page page-enter"><div className="page-heading"><div><span className="page-eyebrow">Operations</span><h1>Executions</h1><p>Every command, approval, and output reported by operation API.</p></div></div>{loading && <p>Loading executions...</p>}{error && <div className="auth-error" role="alert">{error}</div>}{!loading && !error && operations.length === 0 && <div className="chat-empty-state"><Terminal size={24} /><strong>No executions yet</strong><p>Approved chat operations appear here.</p></div>}{operations.length > 0 && <div className="execution-table" data-testid="executions-table"><div className="execution-table-head"><span>Operation</span><span>Server</span><span>Status</span><span>Steps</span><span>Created</span></div>{operations.map(operation => <NavLink to={operation.threadId ? `/chat/${operation.threadId}` : '/executions'} className="execution-table-row" key={operation.id}><span><i><Terminal size={16} /></i><span><strong>{operation.title}</strong><small>{operation.id}</small></span></span><span>{operation.serverName || operation.serverId || 'Unavailable'}</span><span><b className={cn('table-status', ['failed', 'cancelled', 'canceled', 'rejected'].includes(operation.status) && 'failed')}><i />{operation.status.replaceAll('_', ' ')}</b></span><span>{operation.steps.filter(step => ['completed', 'succeeded'].includes(step.status)).length} / {operation.steps.length}</span><span>{operation.createdAt ? new Date(operation.createdAt).toLocaleString() : '-'}</span></NavLink>)}</div>}</div>
}
