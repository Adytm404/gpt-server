import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ChatHomePage, ChatThreadPage, ChatThreadsProvider, ExecutionsPage, RecentChats } from './ChatPages'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const server = { id: 'srv-real-uuid', name: 'Edge One', host: 'edge.example.com', port: 22, ssh_user: 'ops', auth_method: 'ssh_key', environment: 'production', status: 'online', region: 'eu', host_fingerprint: '' }
const thread = { id: 'thread-1', title: 'Inspect edge load', server_id: server.id, server_name: server.name, created_at: '2026-08-21T10:00:00Z', updated_at: '2026-08-21T10:02:00Z' }
const operation = { id: 'op-1', thread_id: thread.id, server_id: server.id, server_name: server.name, title: 'Inspect load', status: 'pending_approval', steps: [{ id: 'step-1', title: 'Read load average', status: 'pending', command: 'uptime' }] }

function renderWithThreads(node: React.ReactNode, route = '/chat') {
  return render(<MemoryRouter initialEntries={[route]}><ChatThreadsProvider>{node}</ChatThreadsProvider></MemoryRouter>)
}

describe('real chat workspace', () => {
  afterEach(() => vi.restoreAllMocks())

  it('loads servers and sends chosen UUID when creating first message', async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) : undefined
      requests.push({ url, body })
      if (url.endsWith('/chat/config')) return json({ configured: true, model_id: 'model-1', model_name: 'Backend Model', monthly_token_limit: 1000, used_tokens: 20 })
      if (url.endsWith('/servers')) return json({ servers: [server] })
      if (url.endsWith('/chat/threads') && init?.method === 'POST') return json({ thread }, 201)
      if (url.endsWith('/messages') && init?.method === 'POST') return json({ message: { id: 'msg-1', role: 'user', content: body.content }, operation }, 201)
      if (url.endsWith('/chat/threads')) return json({ threads: [] })
      throw new Error(`Unexpected request: ${url}`)
    })
    renderWithThreads(<Routes><Route path="/chat" element={<ChatHomePage />} /><Route path="/chat/:id" element={<div>thread destination</div>} /></Routes>)

    expect(await screen.findByText('Edge One')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Ask OpsAI'), 'Check load')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('thread destination')).toBeInTheDocument()
    expect(requests.find(request => request.url.endsWith('/chat/threads') && request.body)?.body).toMatchObject({ server_id: 'srv-real-uuid' })
    expect(requests.find(request => request.url.endsWith('/messages'))?.body).toEqual({ content: 'Check load', policy: 'approval_required' })
  })

  it('offers only safe policies and sends exact explain_only body', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (url.endsWith('/chat/config')) return json({ configured: true, model_id: 'model-1', monthly_token_limit: 1000, used_tokens: 0 })
      if (url.endsWith('/servers')) return json({ servers: [server] })
      if (url.endsWith('/chat/threads') && init?.method === 'POST') return json({ thread }, 201)
      if (url.endsWith('/messages') && init?.method === 'POST') { requests.push(body); return json({ message: { id: 'answer-1', role: 'assistant', content: 'Stored context is healthy.' } }, 201) }
      if (url.endsWith('/chat/threads')) return json({ threads: [] })
      throw new Error(`Unexpected request: ${url}`)
    })
    renderWithThreads(<Routes><Route path="/chat" element={<ChatHomePage />} /><Route path="/chat/:id" element={<div>thread destination</div>} /></Routes>)
    await userEvent.click(await screen.findByRole('button', { name: 'Execution policy' }))
    const options = screen.getByRole('listbox', { name: 'Execution policy options' })
    expect(within(options).getAllByRole('option')).toHaveLength(2)
    expect(within(options).getByText('Approval required')).toBeInTheDocument()
    expect(within(options).getByText('Explain only')).toBeInTheDocument()
    expect(screen.queryByText('Auto execute')).not.toBeInTheDocument()
    await userEvent.click(within(options).getByRole('option', { name: /Explain only/ }))
    expect(screen.getByText(/No commands will run\./)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Ask OpsAI'), 'Explain latest state')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('thread destination')).toBeInTheDocument()
    expect(requests).toEqual([{ content: 'Explain latest state', policy: 'explain_only' }])
  })

  it('renders explain_only assistant response without terminal or plan', async () => {
    let messageLists = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/messages') && init?.method === 'POST') return json({ message: { id: 'answer-1', role: 'assistant', content: 'No commands were run.' } }, 201)
      if (url.endsWith('/messages')) { messageLists += 1; return json({ messages: [] }) }
      if (url.includes('/operations?')) return json({ operations: [] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Execution policy' }))
    await userEvent.click(screen.getByRole('option', { name: /Explain only/ }))
    await userEvent.type(screen.getByLabelText('Ask OpsAI'), 'Explain stored context')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('No commands were run.')).toBeInTheDocument()
    expect(messageLists).toBeGreaterThan(1)
    expect(screen.queryByText('SSH terminal')).not.toBeInTheDocument()
    expect(screen.queryByText('Approve & run')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Ask OpsAI')).toBeEnabled()
  })

  it('shows honest empty server state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => json(String(input).endsWith('/chat/config') ? { configured: true, model_id: 'model-1', monthly_token_limit: 1000, used_tokens: 0 } : String(input).endsWith('/servers') ? { servers: [] } : { threads: [] }))
    renderWithThreads(<ChatHomePage />)
    expect(await screen.findByText('No servers connected')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect a server' })).toHaveAttribute('href', '/servers')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('renders sidebar threads from API without fixture labels', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ threads: [thread] }))
    renderWithThreads(<RecentChats />)
    expect(await screen.findByText('Inspect edge load')).toBeInTheDocument()
    expect(screen.getByText('Edge One')).toBeInTheDocument()
    expect(screen.queryByText('Diagnose worker CPU')).not.toBeInTheDocument()
  })

  it('renders real messages, plan, and approval controls', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/messages')) return json({ messages: [{ id: 'm1', role: 'user', content: 'Inspect load' }, { id: 'm2', role: 'assistant', content: 'Review plan before execution.' }] })
      if (url.includes('/operations?')) return json({ operations: [operation] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      if (url.endsWith('/chat/threads/thread-1')) return json(thread)
      throw new Error(`Unexpected request: ${url}`)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    expect(await screen.findByText('Review plan before execution.')).toBeInTheDocument()
    expect(screen.getByText('Read load average')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve & run' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(screen.queryByText(/node dist\/worker/)).not.toBeInTheDocument()
  })

  it('shows backend 422 guard message at composer', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/chat/config')) return json({ configured: true, model_id: 'model-1', monthly_token_limit: 1000, used_tokens: 0 })
      if (url.endsWith('/servers')) return json({ servers: [server] })
      if (url.endsWith('/chat/threads') && init?.method === 'POST') return json({ error: 'Prompt blocked by workspace safety guard' }, 422)
      return json({ threads: [] })
    })
    renderWithThreads(<ChatHomePage />)
    await userEvent.type(await screen.findByLabelText('Ask OpsAI'), 'unsafe prompt')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Prompt blocked by workspace safety guard')
  })

  it('shows unconfigured workspace AI state and does not expose composer', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/chat/config')) return json({ configured: false, monthly_token_limit: 0 })
      if (url.endsWith('/servers')) return json({ servers: [server] })
      return json({ threads: [] })
    })
    renderWithThreads(<ChatHomePage />)
    expect(await screen.findByText('Workspace AI is not configured. Ask platform admin to assign an active model and token quota.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Ask OpsAI')).not.toBeInTheDocument()
  })

  it('refetches operation state after partial approval acknowledgement', async () => {
    let operationLists = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) { operationLists += 1; return json({ operations: [operationLists > 1 ? { ...operation, status: 'running', steps: [{ ...operation.steps[0], status: 'running' }] } : operation] }) }
      if (url.endsWith('/approve') && init?.method === 'POST') return json({ id: operation.id, status: 'approved' }, 202)
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      if (url.endsWith('/chat/threads/thread-1')) return json(thread)
      throw new Error(`Unexpected request: ${url}`)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Approve & run' }))
    await waitFor(() => expect(operationLists).toBeGreaterThan(1))
    expect((await screen.findAllByText('running')).length).toBeGreaterThan(0)
    expect(screen.getByText('Read load average')).toBeInTheDocument()
  })

  it('shows only streamed terminal output, including stderr', async () => {
    class EventSourceMock {
      static instance: EventSourceMock
      onopen: (() => void) | null = null; onerror: (() => void) | null = null; listeners: Record<string, (event: MessageEvent) => void> = {}
      constructor() { EventSourceMock.instance = this }
      addEventListener(type: string, listener: EventListener) { this.listeners[type] = listener as (event: MessageEvent) => void }
      close() {}
      emit(type: string, data: object, id: string) { this.listeners[type]?.({ data: JSON.stringify(data), lastEventId: id, type } as MessageEvent) }
    }
    vi.stubGlobal('EventSource', EventSourceMock)
    let operationLists = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) { operationLists += 1; return json({ operations: [{ ...operation, status: 'running' }] }) }
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await screen.findByText('SSH terminal')
    await waitFor(() => expect(EventSourceMock.instance).toBeDefined())
    EventSourceMock.instance.onopen?.()
    EventSourceMock.instance.emit('stdout', { text: 'real output' }, '1')
    EventSourceMock.instance.emit('stdout', { text: 'second chunk' }, '2')
    EventSourceMock.instance.emit('stdout', { text: 'third chunk' }, '3')
    EventSourceMock.instance.emit('stderr', { text: 'real warning' }, '4')
    expect(await screen.findByText('real output')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'stderr' }))
    expect(screen.getByText('real warning')).toBeInTheDocument()
    expect(screen.queryByText(/load average: 0.84/)).not.toBeInTheDocument()
    await new Promise(resolve => window.setTimeout(resolve, 350))
    expect(operationLists).toBe(1)
    vi.unstubAllGlobals()
  })

  it('concatenates summary deltas, shows summarizing progress, then refetches without duplicate', async () => {
    class EventSourceMock {
      static instance: EventSourceMock
      onopen: (() => void) | null = null; onerror: (() => void) | null = null; listeners: Record<string, (event: MessageEvent) => void> = {}; closed = false
      constructor() { EventSourceMock.instance = this }
      addEventListener(type: string, listener: EventListener) { this.listeners[type] = listener as (event: MessageEvent) => void }
      close() { this.closed = true }
      emit(type: string, data: object, id: string) { this.listeners[type]?.({ data: JSON.stringify(data), lastEventId: id, type } as MessageEvent) }
    }
    vi.stubGlobal('EventSource', EventSourceMock)
    let messageLists = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/messages')) { messageLists += 1; return json({ messages: messageLists > 1 ? [{ id: 'summary-1', role: 'assistant', content: 'Host is healthy.' }] : [] }) }
      if (url.includes('/operations?')) return json({ operations: [{ ...operation, status: 'succeeded', steps: [{ ...operation.steps[0], status: 'succeeded' }] }] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await screen.findByText('SSH terminal')
    await waitFor(() => expect(EventSourceMock.instance).toBeDefined())
    await act(async () => {
      EventSourceMock.instance.emit('summary.started', {}, '30')
      EventSourceMock.instance.emit('assistant.delta', { payload: { delta: 'Host is ' } }, '31')
      EventSourceMock.instance.emit('assistant.delta', { payload: { delta: 'healthy.' } }, '32')
    })
    expect(screen.getByTestId('streamed-summary')).toHaveTextContent('Host is healthy.')
    expect(screen.getByText('OpsAI sedang menjelaskan hasil...')).toBeInTheDocument()
    expect(screen.getByText('Commands complete. Generating explanation...')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    await act(async () => { EventSourceMock.instance.emit('summary.completed', { payload: { message_id: 'summary-1' } }, '33') })
    await waitFor(() => expect(messageLists).toBeGreaterThan(1))
    await waitFor(() => expect(screen.queryByTestId('streamed-summary')).not.toBeInTheDocument())
    expect(screen.getAllByText('Host is healthy.')).toHaveLength(1)
    expect(EventSourceMock.instance.closed).toBe(true)
    vi.unstubAllGlobals()
  })

  it('hides archive and delete while operation is busy', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) return json({ operations: [{ ...operation, status: 'running' }] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      if (url.endsWith('/chat/config')) return json({ configured: true, model_id: 'model-1', monthly_token_limit: 1000, used_tokens: 0 })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Thread actions' }))
    expect(screen.getByText('Cancel operation first to archive or delete.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('refetches but keeps stream open for summary after backend completed event', async () => {
    class EventSourceMock {
      static instance: EventSourceMock
      onopen: (() => void) | null = null; onerror: (() => void) | null = null; listeners: Record<string, (event: MessageEvent) => void> = {}; closed = false
      constructor(_url: string, options?: EventSourceInit) { expect(options).toEqual({ withCredentials: true }); EventSourceMock.instance = this }
      addEventListener(type: string, listener: EventListener) { this.listeners[type] = listener as (event: MessageEvent) => void }
      close() { this.closed = true }
      emit(type: string, data: object, id: string) { this.listeners[type]?.({ data: JSON.stringify(data), lastEventId: id, type } as MessageEvent) }
    }
    vi.stubGlobal('EventSource', EventSourceMock)
    let operationLists = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) { operationLists += 1; return json({ operations: [{ ...operation, status: operationLists > 1 ? 'succeeded' : 'running' }] }) }
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await screen.findByText('SSH terminal')
    EventSourceMock.instance.emit('stdout', { chunk: 'backend chunk' }, '20')
    expect(await screen.findByText('backend chunk')).toBeInTheDocument()
    EventSourceMock.instance.emit('completed', {}, '21')
    await waitFor(() => expect(operationLists).toBeGreaterThan(1))
    expect(EventSourceMock.instance.closed).toBe(false)
    vi.unstubAllGlobals()
  })

  it('renders executions from operations API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ operations: [{ ...operation, status: 'succeeded', completed_at: '2026-08-21T10:00:04Z', created_at: '2026-08-21T10:00:00Z' }] }))
    render(<MemoryRouter><ExecutionsPage /></MemoryRouter>)
    const table = await screen.findByTestId('executions-table')
    expect(within(table).getByText('Inspect load')).toBeInTheDocument()
    expect(within(table).getByText('Edge One')).toBeInTheDocument()
    expect(screen.queryByText('Restart worker service')).not.toBeInTheDocument()
  })
})
