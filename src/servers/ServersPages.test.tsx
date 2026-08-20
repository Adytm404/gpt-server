import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ServerDetailPage, ServersPage } from './ServersPages'

const server = { id: 'srv-1', name: 'Production API', host: 'api.example.com', port: 22, ssh_user: 'deploy', environment: 'production', status: 'online', region: 'sgp-1', host_fingerprint: 'SHA256:test' }

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

  it('reloads persisted server immediately after create before verification', async () => {
    let listCalls = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/v1/servers') && init?.method === 'POST') return new Response(JSON.stringify(server), { status: 201, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/api/v1/servers')) {
        listCalls += 1
        return new Response(JSON.stringify({ servers: listCalls > 1 ? [server] : [], summary: { total: listCalls > 1 ? 1 : 0, online: listCalls > 1 ? 1 : 0, offline: 0, unknown: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    render(<MemoryRouter><ServersPage /></MemoryRouter>)
    await screen.findByText('No servers connected.')
    await userEvent.click(screen.getByRole('button', { name: /Add server/ }))
    await userEvent.type(screen.getByLabelText('Server name'), 'Production API')
    await userEvent.type(screen.getByLabelText('Hostname or IP'), 'api.example.com')
    await userEvent.type(screen.getByLabelText('Private key'), 'test-private-key')
    await userEvent.click(screen.getByRole('button', { name: /Create server/ }))
    expect(await screen.findByText('Server created')).toBeInTheDocument()
    await waitFor(() => expect(listCalls).toBe(2))
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/api/v1/servers') && init?.method === 'POST')).toBe(true)
    expect(screen.getByText('of 1 servers')).toBeInTheDocument()
  })

  it('renders detail empty metrics and calls health endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      return new Response(JSON.stringify(url.endsWith('/health-check') ? { status: 'online', cpu_percent: 0, memory_percent: 0 } : server), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    render(<MemoryRouter initialEntries={['/servers/srv-1']}><Routes><Route path="/servers/:id" element={<ServerDetailPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByText(/No metrics snapshot available/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Run health check/i }))
    await waitFor(() => expect(screen.getByText('Health check completed')).toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/v1/servers/srv-1/health-check'))).toBe(true)
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
    await userEvent.click(await screen.findByRole('button', { name: 'Test network endpoint' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('connection refused')
    expect(screen.getByText('Production API')).toBeInTheDocument()
    expect(screen.queryByText('connection refused', { selector: '.health-banner *' })).not.toBeInTheDocument()
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
