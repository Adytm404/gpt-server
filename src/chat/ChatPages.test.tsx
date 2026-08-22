import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ChatHomePage, ChatThreadPage, ChatThreadsProvider, ExecutionsPage, RecentChats } from './ChatPages'
import { DialogProvider } from '../ui/DialogProvider'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const server = { id: 'srv-real-uuid', name: 'Edge One', host: 'edge.example.com', port: 22, ssh_user: 'ops', auth_method: 'ssh_key', environment: 'production', status: 'online', region: 'eu', host_fingerprint: '' }
const thread = { id: 'thread-1', title: 'Inspect edge load', server_id: server.id, server_name: server.name, created_at: '2026-08-21T10:00:00Z', updated_at: '2026-08-21T10:02:00Z' }
const operation = { id: 'op-1', thread_id: thread.id, server_id: server.id, server_name: server.name, title: 'Inspect load', status: 'pending_approval', steps: [{ id: 'step-1', title: 'Read load average', status: 'pending', command: 'uptime' }] }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function ThreadDestination() {
  const location = useLocation()
  return <div>thread destination:{JSON.stringify(location.state)}</div>
}

function renderWithThreads(node: React.ReactNode, route = '/chat') {
  return render(<MemoryRouter initialEntries={[route]}><DialogProvider><ChatThreadsProvider>{node}</ChatThreadsProvider></DialogProvider></MemoryRouter>)
}

describe('real chat workspace', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('creates a thread and navigates with pending prompt before sending any message', async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) : undefined
      requests.push({ url, body })
      if (url.endsWith('/chat/config')) return json({ configured: true, model_id: 'model-1', model_name: 'Backend Model', monthly_token_limit: 1000, used_tokens: 20 })
      if (url.endsWith('/servers')) return json({ servers: [server] })
      if (url.endsWith('/chat/threads') && init?.method === 'POST') return json({ thread }, 201)
      if (url.endsWith('/chat/threads')) return json({ threads: [] })
      throw new Error(`Unexpected request: ${url}`)
    })
    renderWithThreads(<Routes><Route path="/chat" element={<ChatHomePage />} /><Route path="/chat/:id" element={<ThreadDestination />} /></Routes>)

    expect(await screen.findByText('Select server')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Select server/ }))
    await userEvent.click(screen.getByRole('option', { name: /Edge One/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Execution policy' }))
    await userEvent.click(within(screen.getByRole('listbox', { name: 'Execution policy options' })).getByRole('option', { name: /Approval required/ }))
    await userEvent.type(screen.getByLabelText('Ask OpsAI'), 'Check load')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/thread destination/)).toHaveTextContent('"prompt":"Check load"')
    expect(screen.getByText(/thread destination/)).toHaveTextContent('"policy":"approval_required"')
    expect(requests.find(request => request.url.endsWith('/chat/threads') && request.body)?.body).toMatchObject({ server_id: 'srv-real-uuid' })
    expect(requests.some(request => request.url.endsWith('/messages'))).toBe(false)
  })

  it('offers explicit policies and sends exact explain_only body', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input); const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (url.endsWith('/chat/config')) return json({ configured: true, model_id: 'model-1', monthly_token_limit: 1000, used_tokens: 0 })
      if (url.endsWith('/servers')) return json({ servers: [server] })
      if (url.endsWith('/chat/threads') && init?.method === 'POST') return json({ thread }, 201)
      if (url.includes('/messages') && init?.method === 'POST') { requests.push(body); return json({ message: { id: 'answer-1', role: 'assistant', content: 'Stored context is healthy.' } }, 201) }
      if (url.endsWith('/chat/threads')) return json({ threads: [] })
      throw new Error(`Unexpected request: ${url}`)
    })
    renderWithThreads(<Routes><Route path="/chat" element={<ChatHomePage />} /><Route path="/chat/:id" element={<ThreadDestination />} /></Routes>)
    await userEvent.click(screen.getByRole('button', { name: /Select server/ }))
    await userEvent.click(screen.getByRole('option', { name: /Edge One/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Execution policy' }))
    const options = screen.getByRole('listbox', { name: 'Execution policy options' })
    expect(within(options).getAllByRole('option')).toHaveLength(3)
    expect(within(options).getByText('Approval required')).toBeInTheDocument()
    expect(within(options).getByText('Full access')).toBeInTheDocument()
    expect(within(options).getByText(/No command approval prompts/i)).toBeInTheDocument()
    expect(within(options).getByText('Explain only')).toBeInTheDocument()
    expect(screen.queryByText('Auto execute')).not.toBeInTheDocument()
    await userEvent.click(within(options).getByRole('option', { name: /Explain only/ }))
    expect(screen.getByText(/No commands will run\./)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Ask OpsAI'), 'Explain latest state')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/thread destination/)).toHaveTextContent('"policy":"explain_only"')
    expect(requests).toEqual([])
  })

  it('shows optimistic user and approval thinking messages while request is pending and clears text', async () => {
    const pending = deferred<Response>()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/messages') && init?.method === 'POST') return pending.promise
      if (url.includes('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) return json({ operations: [] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Execution policy' }))
    await userEvent.click(within(screen.getByRole('listbox', { name: 'Execution policy options' })).getByRole('option', { name: /Approval required/ }))
    const composer = await screen.findByLabelText('Ask OpsAI')
    await userEvent.type(composer, 'Check memory pressure')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(composer).toHaveValue('')
    expect(screen.getByText('Check memory pressure')).toBeInTheDocument()
    expect(screen.getByText('OpsAI is processing request and determining steps...')).toBeInTheDocument()
    expect(screen.getByText('Check memory pressure').closest('.message')).toHaveClass('user-message', 'right-message')
    expect(screen.getByText('OpsAI is processing request and determining steps...').closest('.message')).toHaveClass('ai-message', 'left-message')
    expect(screen.getByText('Edge One')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(screen.queryByText('Planning operation...')).not.toBeInTheDocument()

    pending.resolve(json({ message: { id: 'm-user', role: 'user', content: 'Check memory pressure', kind: 'chat' }, operation }, 201))
  })

  it('restores submitted text after follow-up failure', async () => {
    const pending = deferred<Response>()
    let messageLists = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/messages') && init?.method === 'POST') return pending.promise
      if (url.includes('/messages')) { messageLists += 1; return json({ messages: [] }) }
      if (url.includes('/operations?')) return json({ operations: [] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Execution policy' }))
    await userEvent.click(within(screen.getByRole('listbox', { name: 'Execution policy options' })).getByRole('option', { name: /Approval required/ }))
    const composer = await screen.findByLabelText('Ask OpsAI')
    await userEvent.type(composer, 'Retry this request')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    pending.resolve(json({ error: 'Planning failed' }, 500))

    expect(await screen.findByRole('alert')).toHaveTextContent('Planning failed')
    expect(composer).toHaveValue('Retry this request')
    expect(messageLists).toBeGreaterThan(1)
  })

  it('uses snapshot analysis copy for optimistic explain-only follow-up', async () => {
    const pending = deferred<Response>()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/messages') && init?.method === 'POST') return pending.promise
      if (url.includes('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) return json({ operations: [] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Execution policy' }))
    await userEvent.click(screen.getByRole('option', { name: /Explain only/ }))
    await userEvent.type(screen.getByLabelText('Ask OpsAI'), 'Explain snapshot')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByText('OpsAI is analyzing server snapshot...')).toBeInTheDocument()
    pending.resolve(json({ message: { id: 'answer', role: 'assistant', content: 'Healthy', kind: 'chat' } }, 201))
  })

  it('hides plan messages and renders operation before persisted result', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/messages')) return json({ messages: [
        { id: 'm1', role: 'user', content: 'Inspect load', kind: 'chat', created_at: '2026-08-21T10:00:00Z' },
        { id: 'm2', role: 'assistant', content: 'Generic context', kind: 'chat', created_at: '2026-08-21T10:00:01Z' },
        { id: 'm3', role: 'assistant', content: 'Hidden plan summary', kind: 'plan', operation_id: operation.id, created_at: '2026-08-21T10:00:02Z' },
        { id: 'm4', role: 'assistant', content: 'Final operation result', kind: 'result', operation_id: operation.id, created_at: '2026-08-21T10:00:03Z' },
      ] })
      if (url.includes('/operations?')) return json({ operations: [{ ...operation, status: 'succeeded' }] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    const generic = await screen.findByText('Generic context')
    const card = screen.getByText('Read load average')
    const result = screen.getByText('Final operation result')
    const user = screen.getByText('Inspect load', { selector: 'p' })
    expect(screen.queryByText('Hidden plan summary')).not.toBeInTheDocument()
    expect(user.closest('.message')).toHaveClass('user-message', 'right-message')
    expect(generic.closest('.message')).toHaveClass('ai-message', 'left-message')
    expect(card.closest('.message')).toHaveClass('ai-message', 'left-message', 'operation-message')
    expect(result.closest('.message')).toHaveClass('ai-message', 'left-message')
    expect(generic.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('orders same-timestamp replies by explicit sequence instead of response ID or API order', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/messages')) return json({ messages: [
        { id: '000-assistant', role: 'assistant', content: 'Sequence answer', kind: 'chat', sequence: 12, reply_to_message_id: 'fff-user', created_at: '2026-08-21T10:00:00Z' },
        { id: 'fff-user', role: 'user', content: 'Sequence question', kind: 'chat', sequence: 11, created_at: '2026-08-21T10:00:00Z' },
      ] })
      if (url.includes('/operations?')) return json({ operations: [] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')

    const conversation = (await screen.findByText('Sequence question')).closest<HTMLElement>('.conversation')!
    expect(within(conversation).getAllByTestId(/^message-/).map(item => item.getAttribute('data-testid'))).toEqual(['message-fff-user', 'message-000-assistant'])
  })

  it('places an ordinary linked reply directly after its user message', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/messages')) return json({ messages: [
        { id: 'reply', role: 'assistant', content: 'Linked answer', kind: 'chat', reply_to_message_id: 'question', created_at: '2026-08-21T09:59:00Z' },
        { id: 'question', role: 'user', content: 'Linked question', kind: 'chat', created_at: '2026-08-21T10:00:00Z' },
        { id: 'later', role: 'user', content: 'Later question', kind: 'chat', created_at: '2026-08-21T10:01:00Z' },
      ] })
      if (url.includes('/operations?')) return json({ operations: [] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')

    const conversation = (await screen.findByText('Linked question')).closest<HTMLElement>('.conversation')!
    expect(within(conversation).getAllByTestId(/^message-/).map(item => item.getAttribute('data-testid'))).toEqual(['message-question', 'message-reply', 'message-later'])
  })

  it('orders legacy same-timestamp user messages before assistant messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/messages')) return json({ messages: [
        { id: '000-ai', role: 'assistant', content: 'Legacy answer', kind: 'chat', created_at: '2026-08-21T10:00:00Z' },
        { id: 'fff-user', role: 'user', content: 'Legacy question', kind: 'chat', created_at: '2026-08-21T10:00:00Z' },
      ] })
      if (url.includes('/operations?')) return json({ operations: [] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')

    const conversation = (await screen.findByText('Legacy question')).closest<HTMLElement>('.conversation')!
    expect(within(conversation).getAllByTestId(/^message-/).map(item => item.getAttribute('data-testid'))).toEqual(['message-fff-user', 'message-000-ai'])
  })

  it('renders two interleaved operations old-to-new with only latest approval controls', async () => {
    const older = {
      ...operation,
      id: 'op-older',
      title: 'Inspect disk',
      status: 'pending_approval',
      created_at: '2026-08-21T10:00:02Z',
      steps: [{ id: 'disk-step', title: 'Read disk usage', status: 'pending', command: 'df -h' }],
    }
    const latest = {
      ...operation,
      id: 'op-latest',
      title: 'Inspect memory',
      status: 'pending_approval',
      created_at: '2026-08-21T10:05:02Z',
      steps: [{ id: 'memory-step', title: 'Read memory usage', status: 'pending', command: 'free -m' }],
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/messages')) return json({ messages: [
        { id: 'user-1', role: 'user', content: 'Check disk', kind: 'chat', operation_id: older.id, created_at: '2026-08-21T10:00:00Z' },
        { id: 'plan-1', role: 'assistant', content: 'Hidden disk plan', kind: 'plan', operation_id: older.id, created_at: '2026-08-21T10:00:01Z' },
        { id: 'result-1', role: 'assistant', content: 'Disk is healthy', kind: 'result', operation_id: older.id, created_at: '2026-08-21T10:00:03Z' },
        { id: 'chat-1', role: 'assistant', content: 'What should I inspect next?', kind: 'chat', created_at: '2026-08-21T10:00:04Z' },
        { id: 'user-2', role: 'user', content: 'Check memory', kind: 'chat', operation_id: latest.id, created_at: '2026-08-21T10:05:00Z' },
        { id: 'plan-2', role: 'assistant', content: 'Hidden memory plan', kind: 'plan', operation_id: latest.id, created_at: '2026-08-21T10:05:01Z' },
      ] })
      if (url.includes('/operations?')) return json({ operations: [latest, older] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')

    const conversation = (await screen.findByText('Check disk')).closest<HTMLElement>('.conversation')!
    const ordered = within(conversation).getAllByTestId(/^(message|operation-op)/).map(item => item.getAttribute('data-testid'))
    expect(ordered).toEqual(['message-user-1', 'operation-op-older', 'message-result-1', 'message-chat-1', 'message-user-2', 'operation-op-latest'])
    expect(screen.queryByText('Hidden disk plan')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden memory plan')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Approve & run' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(1)
    expect(screen.getByTestId('operation-op-latest')).toContainElement(screen.getByRole('button', { name: 'Approve & run' }))
    expect(screen.getByText('SSH terminal')).toBeInTheDocument()
  })

  it.each([
    ['planning', ['done', 'current', 'pending', 'pending', 'pending']],
    ['pending_approval', ['done', 'done', 'current', 'pending', 'pending']],
    ['running', ['done', 'done', 'done', 'current', 'pending']],
    ['summarizing', ['done', 'done', 'done', 'done', 'current']],
    ['succeeded', ['done', 'done', 'done', 'done', 'done']],
  ])('shows five operation stages for %s', async (status, states) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/messages')) return json({ messages: [{ id: 'm1', role: 'user', content: 'Inspect load', kind: 'chat', operation_id: operation.id, created_at: '2026-08-21T10:00:00Z' }] })
      if (url.includes('/operations?')) return json({ operations: [{ ...operation, status, created_at: '2026-08-21T10:00:01Z' }] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')

    const stages = within(await screen.findByTestId('operation-stages')).getAllByRole('listitem')
    expect(stages.map(stage => stage.getAttribute('data-state'))).toEqual(states)
    for (const label of ['Request received', 'AI determining action', 'Flow ready', 'Executing', 'Explanation']) expect(within(screen.getByTestId('operation-stages')).getByText(label)).toBeInTheDocument()
  })

  it('renders explain_only assistant response without terminal or plan', async () => {
    let messageLists = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/messages') && init?.method === 'POST') return json({ message: { id: 'answer-1', role: 'assistant', content: 'No commands were run.' } }, 201)
      if (url.includes('/messages')) { messageLists += 1; return json({ messages: messageLists > 1 ? [{ id: 'answer-1', role: 'assistant', content: 'No commands were run.', kind: 'chat' }] : [] }) }
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
      if (url.includes('/messages')) return json({ messages: [{ id: 'm1', role: 'user', content: 'Inspect load' }, { id: 'm2', role: 'assistant', content: 'Review plan before execution.' }] })
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
    await userEvent.click(await screen.findByRole('button', { name: /Select server/ }))
    await userEvent.click(screen.getByRole('option', { name: /Edge One/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Execution policy' }))
    await userEvent.click(within(screen.getByRole('listbox', { name: 'Execution policy options' })).getByRole('option', { name: /Approval required/ }))
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
      if (url.includes('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) { operationLists += 1; return json({ operations: [operationLists > 1 ? { ...operation, status: 'running', steps: [{ ...operation.steps[0], status: 'running' }] } : operation] }) }
      if (url.endsWith('/approve') && init?.method === 'POST') return json({ id: operation.id, status: 'approved' }, 202)
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      if (url.endsWith('/chat/threads/thread-1')) return json(thread)
      throw new Error(`Unexpected request: ${url}`)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Approve & run' }))
    await userEvent.click(screen.getByRole('dialog', { name: 'Approve server operation?' }).querySelector<HTMLButtonElement>('.dialog-confirm')!)
    await waitFor(() => expect(operationLists).toBeGreaterThan(1))
    expect((await screen.findAllByText('running')).length).toBeGreaterThan(0)
    expect(screen.getByText('Read load average')).toBeInTheDocument()
  })

  it('shows every step and command before approval and calls API only after confirmation', async () => {
    const detailedOperation = { ...operation, steps: [
      { id: 'step-1', title: 'Read load average', status: 'pending', command: 'uptime' },
      { id: 'step-2', title: 'Inspect processes', status: 'pending', command: 'ps aux --sort=-%cpu' },
    ] }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) return json({ operations: [detailedOperation] })
      if (url.endsWith('/approve') && init?.method === 'POST') return json({ id: operation.id, status: 'approved' })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Approve & run' }))
    const modal = screen.getByRole('dialog', { name: 'Approve server operation?' })
    expect(within(modal).getByText(/Edge One.*bounded read-only investigation/)).toBeInTheDocument()
    expect(within(modal).getByText('Read load average')).toBeInTheDocument()
    expect(within(modal).getByText('uptime')).toBeInTheDocument()
    expect(within(modal).getByText('Inspect processes')).toBeInTheDocument()
    expect(within(modal).getByText('ps aux --sort=-%cpu')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/approve'))).toBe(false)
    await userEvent.click(within(modal).getByRole('button', { name: 'Approve & run' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/approve'))).toBe(true))
  })

  it('confirms chat deletion before calling API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) return json({ operations: [] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<RecentChats />)
    await userEvent.click(await screen.findByRole('button', { name: `Actions for ${thread.title}` }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('dialog', { name: 'Delete chat?' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url],) => String(url).endsWith('/chat/threads/thread-1') && fetchMock.mock.calls.find(call => call[0] === url)?.[1]?.method === 'DELETE')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Delete chat' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/chat/threads/thread-1') && init?.method === 'DELETE')).toBe(true))
  })

  it('refreshes flow on agent events, shows thinking stage, new steps, and round', async () => {
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
      if (url.includes('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) {
        operationLists += 1
        const steps = operationLists > 1 ? [...operation.steps, { id: 'step-2', title: 'Inspect processes', status: 'pending', command: 'ps aux' }] : operation.steps
        return json({ operations: [{ ...operation, status: 'planning', agent_round: 2, steps }] })
      }
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await screen.findByText('Round 2')
    await waitFor(() => expect(EventSourceMock.instance).toBeDefined())
    await act(async () => EventSourceMock.instance.emit('agent.thinking', {}, '40'))
    expect(screen.getByText('AI determining next step').closest('li')).toHaveClass('current')
    await act(async () => EventSourceMock.instance.emit('flow.updated', {}, '41'))
    await waitFor(() => expect(operationLists).toBeGreaterThan(1))
    expect(await screen.findByText('Inspect processes')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('prepares a failed operation retry after confirmation', async () => {
    const failed = { ...operation, status: 'failed', error: 'diagnostic step failed', steps: [{ ...operation.steps[0], status: 'failed' }] }
    const requests: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) return json({ operations: [failed] })
      if (url.endsWith('/retry') && init?.method === 'POST') { requests.push(url); return json({ id: failed.id, status: 'pending_approval' }) }
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Retry operation' }))
    expect(screen.getByRole('dialog', { name: 'Retry failed operation?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Prepare retry' }))
    await waitFor(() => expect(requests).toHaveLength(1))
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
      if (url.includes('/messages')) return json({ messages: [] })
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
      if (url.includes('/messages')) { messageLists += 1; return json({ messages: messageLists > 1 ? [{ id: 'summary-1', role: 'assistant', content: 'Host is healthy.' }] : [] }) }
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
    expect(screen.getByText('OpsAI is explaining results...')).toBeInTheDocument()
    expect(screen.getByText('Commands complete. Generating explanation...')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    await act(async () => { EventSourceMock.instance.emit('summary.completed', { payload: { message_id: 'summary-1' } }, '33') })
    await waitFor(() => expect(messageLists).toBeGreaterThan(1))
    await waitFor(() => expect(screen.queryByTestId('streamed-summary')).not.toBeInTheDocument())
    expect(screen.getAllByText('Host is healthy.')).toHaveLength(1)
    expect(EventSourceMock.instance.closed).toBe(true)
    vi.unstubAllGlobals()
  })

  it('toggles terminal preview minimize in thread page', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/messages')) return json({ messages: [] })
      if (url.includes('/operations?')) return json({ operations: [operation] })
      if (url.endsWith('/chat/threads')) return json({ threads: [thread] })
      if (url.endsWith('/chat/config')) return json({ configured: true, model_id: 'model-1', monthly_token_limit: 1000, used_tokens: 0 })
      return json(thread)
    })
    renderWithThreads(<Routes><Route path="/chat/:id" element={<ChatThreadPage />} /></Routes>, '/chat/thread-1')
    expect(await screen.findByText('SSH terminal')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Minimize terminal' }))
    expect(screen.queryByText('SSH terminal')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show terminal' }))
    expect(screen.getByText('SSH terminal')).toBeInTheDocument()
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
      if (url.includes('/messages')) return json({ messages: [] })
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
