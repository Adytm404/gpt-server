import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ServerDetailPage, ServersPage } from './ServersPages'

const server = { id: 'srv-1', name: 'Production API', host: 'api.example.com', port: 22, ssh_user: 'deploy', auth_method: 'ssh_key', environment: 'production', status: 'online', region: 'sgp-1', host_fingerprint: 'SHA256:test' }

async function openFilledModal(authMethod: 'ssh_key' | 'password' = 'ssh_key') {
  await screen.findByText('No servers connected.')
  await userEvent.click(screen.getByRole('button', { name: /Add server/ }))
  await userEvent.type(screen.getByLabelText('Server name'), 'Production API')
  await userEvent.type(screen.getByLabelText('Hostname or IP'), 'api.example.com')
  if (authMethod === 'password') await userEvent.click(screen.getByRole('tab', { name: 'Password' }))
}

describe('server pages', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders list response and explicit missing snapshot state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ servers: [server], summary: { total: 1, online: 1, offline: 0, unknown: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(<MemoryRouter><ServersPage /></MemoryRouter>)
    expect(await screen.findByText('Production API')).toBeInTheDocument()
    expect(screen.getByText('No snapshot')).toBeInTheDocument()
  })

  it('offers backend server statuses as filters', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ servers: [server], summary: { total: 1, online: 1, offline: 0, unknown: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(<MemoryRouter><ServersPage /></MemoryRouter>)
    await screen.findByText('Production API')
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.getByRole('button', { name: 'Online' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unknown' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Healthy' })).not.toBeInTheDocument()
  })

  it('shows accessible auth tabs, defaults to key, and switches credential fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ servers: [], summary: { total: 0, online: 0, offline: 0, unknown: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(<MemoryRouter><ServersPage /></MemoryRouter>)
    await openFilledModal()

    expect(screen.getByRole('tab', { name: 'SSH key' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Password' })).toBeVisible()
    expect(screen.getByLabelText('Private key')).toBeVisible()
    expect(screen.queryByLabelText('SSH password')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Password' }))
    expect(screen.getByLabelText('SSH password')).toHaveAttribute('type', 'password')
    expect(screen.queryByLabelText('Private key')).not.toBeInTheDocument()
  })

  it('does not create when draft SSH test fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/test-draft')) return new Response(JSON.stringify({ error: 'authentication failed' }), { status: 422, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/api/v1/servers') && init?.method === 'GET') return new Response(JSON.stringify({ servers: [], summary: { total: 0, online: 0, offline: 0, unknown: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      throw new Error(`Unexpected request: ${url}`)
    })
    render(<MemoryRouter><ServersPage /></MemoryRouter>)
    await openFilledModal()
    await userEvent.type(screen.getByLabelText('Private key'), 'test-private-key')
    await userEvent.click(screen.getByRole('button', { name: /Test & add server/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('authentication failed')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('tests password then creates with password only', async () => {
    let listCalls = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/test-draft')) return new Response(JSON.stringify({ success: true, auth_method: 'password', latency_ms: 42 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/api/v1/servers') && init?.method === 'POST') return new Response(JSON.stringify(server), { status: 201, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/api/v1/servers')) {
        listCalls += 1
        return new Response(JSON.stringify({ servers: listCalls > 1 ? [server] : [], summary: { total: listCalls > 1 ? 1 : 0, online: listCalls > 1 ? 1 : 0, offline: 0, unknown: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    render(<MemoryRouter><ServersPage /></MemoryRouter>)
    await openFilledModal('password')
    await userEvent.type(screen.getByLabelText('SSH password'), 'test-password')
    await userEvent.click(screen.getByRole('button', { name: /Test & add server/ }))
    expect(await screen.findByText('Server saved')).toBeInTheDocument()
    expect(screen.getByText(/Password authentication verified in 42 ms/)).toBeInTheDocument()
    await waitFor(() => expect(listCalls).toBe(2))
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts.map(([url]) => String(url).split('/').pop())).toEqual(['test-draft', 'servers'])
    for (const [, init] of posts) {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ auth_method: 'password', password: 'test-password' })
      expect(body).not.toHaveProperty('private_key')
    }
    expect(screen.getByText('of 1 servers')).toBeInTheDocument()
  })

  it('tests and creates SSH key servers without sending password', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (init?.method === 'GET') return new Response(JSON.stringify({ servers: [], summary: { total: 0, online: 0, offline: 0, unknown: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      bodies.push(JSON.parse(String(init?.body)))
      if (url.endsWith('/test-draft')) return new Response(JSON.stringify({ success: true, auth_method: 'ssh_key', latency_ms: 9 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify(server), { status: 201, headers: { 'Content-Type': 'application/json' } })
    })
    render(<MemoryRouter><ServersPage /></MemoryRouter>)
    await openFilledModal()
    await userEvent.type(screen.getByLabelText('Private key'), 'test-private-key')
    await userEvent.click(screen.getByRole('button', { name: /Test & add server/ }))
    expect(await screen.findByText('Server saved')).toBeInTheDocument()
    expect(bodies).toHaveLength(2)
    expect(bodies.every(body => body.auth_method === 'ssh_key' && body.private_key === 'test-private-key' && !('password' in body))).toBe(true)
  })

  it('runs health collection then reloads detail metrics, OS, uptime, and services', async () => {
    let detailCalls = 0
    const refreshedServer = {
      ...server,
      operating_system: 'Ubuntu 24.04 LTS',
      uptime_seconds: 174600 + (12 * 60 * 60),
      latest_snapshot: {
        cpu_percent: 18,
        memory_percent: 42,
        disk_percent: 67,
        captured_at: '2026-08-21T10:00:00Z',
        services: [{ name: 'nginx', status: 'running', detail: 'active' }],
      },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/health-check')) return new Response(JSON.stringify({ server: refreshedServer }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      detailCalls += 1
      return new Response(JSON.stringify(detailCalls > 1 ? refreshedServer : server), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    render(<MemoryRouter initialEntries={['/servers/srv-1']}><Routes><Route path="/servers/:id" element={<ServerDetailPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByText(/No metrics collected yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Run health check/i }))
    await waitFor(() => expect(screen.getByText('Health check completed')).toBeInTheDocument())
    expect(fetchMock.mock.calls.map(([url]) => String(url).split('/').pop())).toEqual(['srv-1', 'health-check', 'srv-1'])
    expect(screen.getByText('Ubuntu 24.04 LTS')).toBeInTheDocument()
    expect(screen.getByText('2d 12h')).toBeInTheDocument()
    expect(screen.getByText('18%')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('nginx')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('shows backend list failure and retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'servers unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
    render(<MemoryRouter><ServersPage /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('servers unavailable')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows offline connection test as failure while keeping detail mounted', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => new Response(JSON.stringify(String(input).endsWith('/test')
      ? { status: 'offline', error: 'connection refused' }
      : server), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(<MemoryRouter initialEntries={['/servers/srv-1']}><Routes><Route path="/servers/:id" element={<ServerDetailPage />} /></Routes></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Test SSH connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('connection refused')
    expect(screen.getByText('Production API')).toBeInTheDocument()
    expect(screen.queryByText('connection refused', { selector: '.health-banner *' })).not.toBeInTheDocument()
  })

  it('reloads detail after successful SSH test and keeps success text', async () => {
    let detailCalls = 0
    const refreshedServer = { ...server, status: 'online', host_fingerprint: 'SHA256:discovered' }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/test')) return new Response(JSON.stringify({ success: true, message: 'SSH connection successful' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      detailCalls += 1
      return new Response(JSON.stringify(detailCalls > 1 ? refreshedServer : { ...server, status: 'unknown', host_fingerprint: '' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    render(<MemoryRouter initialEntries={['/servers/srv-1']}><Routes><Route path="/servers/:id" element={<ServerDetailPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Not reported')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Test SSH connection' }))

    expect(await screen.findByText('SSH connection successful')).toBeInTheDocument()
    expect(screen.getByText('Online', { selector: '.status-pill' })).toBeInTheDocument()
    expect(screen.getByText('Fingerprint stored')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'SSH access' }))
    expect(screen.getByText('SHA256:discovered')).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url).split('/').pop())).toEqual(['srv-1', 'test', 'srv-1'])
  })

  it('keeps detail mounted after action HTTP failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).endsWith('/health-check')
      ? new Response(JSON.stringify({ error: 'health unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify(server), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(<MemoryRouter initialEntries={['/servers/srv-1']}><Routes><Route path="/servers/:id" element={<ServerDetailPage />} /></Routes></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /Run health check/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('health unavailable')
    expect(screen.getByText('Production API')).toBeInTheDocument()
  })
})
