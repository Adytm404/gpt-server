import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AdminConsole from './AdminConsole'

afterEach(() => vi.restoreAllMocks())

it('loads models for admin models route', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ models: [{ id: 'model-api', model_id: 'backend-model', name: 'Backend Model', provider: 'Provider', context_window: 32000, status: 'active', fallback: false }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter initialEntries={['/models']}><AdminConsole /></MemoryRouter>)
  expect(await screen.findByText('Backend Model')).toBeInTheDocument()
  expect(screen.queryByText(/GPT|Claude|OpenAI/i)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Test model/i })).not.toBeInTheDocument()
  expect(screen.queryByText('Latency')).not.toBeInTheDocument()
})

it.each([
  ['/models', 'No models configured.'],
  ['/plans', 'No plans configured.'],
  ['/history', 'No history events found.'],
])('renders API empty state without seeded names at %s', async (route, emptyState) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(route === '/models' ? { models: [] } : route === '/plans' ? { plans: [] } : { events: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter initialEntries={[route]}><AdminConsole /></MemoryRouter>)
  expect(await screen.findByText(emptyState)).toBeInTheDocument()
  expect(screen.queryByText(/GPT|Claude|OpenAI/i)).not.toBeInTheDocument()
})

it('starts new model form blank', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter initialEntries={['/models']}><AdminConsole /></MemoryRouter>)
  await screen.findByText('No models configured.')
  await userEvent.click(screen.getByRole('button', { name: /Add model/i }))
  expect(screen.getByLabelText('Display name')).toHaveValue('')
  expect(screen.getByLabelText('Model ID')).toHaveValue('')
  expect(screen.getByLabelText('Provider')).toHaveValue('')
  expect(screen.getByLabelText('Context window')).toHaveValue('')
  expect(screen.getByLabelText('OpenAI-compatible base URL')).toHaveValue('')
  expect(screen.getByLabelText(/Credential reference/)).toHaveValue('')
  expect(screen.getByLabelText('Display name')).toHaveAttribute('placeholder', 'GPT-4.1 Mini')
  expect(screen.getByLabelText('Model ID')).toHaveAttribute('placeholder', 'gpt-4.1-mini')
  expect(screen.getByLabelText('Provider')).toHaveAttribute('placeholder', 'OpenAI-compatible')
  expect(screen.getByLabelText('Context window')).toHaveAttribute('placeholder', '128K')
  expect(screen.getByLabelText('OpenAI-compatible base URL')).toHaveAttribute('placeholder', 'https://api.openai.com/v1')
  expect(screen.getByLabelText(/Credential reference/)).toHaveAttribute('placeholder', 'vault://models/openai')
  expect(screen.getByLabelText('API key (optional)')).toHaveValue('')
  expect(screen.getByLabelText('API key (optional)')).toHaveAttribute('placeholder', 'sk-...')
  expect(screen.getByText(/endpoint must expose.*OpenAI-compatible.*\/chat\/completions/i)).toBeInTheDocument()
  expect(screen.getByText(/sent to the backend for encrypted storage.*keyless\/local endpoint.*never displayed/i)).toBeInTheDocument()
  expect(screen.getByText(/alternative server-side secret reference/i)).toBeInTheDocument()
})

it('tests current model form and displays successful latency', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, latency_ms: 73 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter initialEntries={['/models']}><AdminConsole /></MemoryRouter>)
  await screen.findByText('No models configured.')
  await userEvent.click(screen.getByRole('button', { name: /Add model/i }))
  await userEvent.type(screen.getByLabelText('Display name'), 'Draft Model')
  await userEvent.type(screen.getByLabelText('Model ID'), 'draft-model')
  await userEvent.type(screen.getByLabelText('API key (optional)'), 'sk-draft')
  await userEvent.click(screen.getByRole('button', { name: /^Test connection$/i }))
  expect(await screen.findByText(/Connection successful.*73 ms/i)).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(screen.getByLabelText('API key (optional)')).toHaveValue('sk-draft')
})

it('blocks Test & save when draft connection test fails', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Provider rejected credentials' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter initialEntries={['/models']}><AdminConsole /></MemoryRouter>)
  await screen.findByText('No models configured.')
  await userEvent.click(screen.getByRole('button', { name: /Add model/i }))
  await userEvent.type(screen.getByLabelText('Display name'), 'Draft Model')
  await userEvent.type(screen.getByLabelText('Model ID'), 'draft-model')
  await userEvent.click(screen.getByRole('button', { name: /^Test & save$/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Provider rejected credentials')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('heading', { name: 'Add model' })).toBeInTheDocument()
})

it('tests an existing model from its row', async () => {
  const toast = vi.fn()
  window.addEventListener('opsai:toast', toast)
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ models: [model] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, latency_ms: 31 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter initialEntries={['/models']}><AdminConsole /></MemoryRouter>)
  await screen.findByText('Backend Model')
  await userEvent.click(screen.getByRole('button', { name: /^Test connection$/i }))
  expect(fetchMock.mock.calls[1][0]).toEqual(expect.stringMatching(/\/models\/model-1\/test$/))
  expect(toast).toHaveBeenCalled()
  expect((toast.mock.calls[0][0] as CustomEvent<string>).detail).toMatch(/Connection successful.*31 ms/i)
  window.removeEventListener('opsai:toast', toast)
})

it('starts new plan with zero limits, no models, and no fake feature', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter initialEntries={['/plans/new']}><AdminConsole /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Create plan' })
  for (const label of ['Monthly price (cents)', 'Annual monthly-equivalent (cents)', 'Max workspaces', 'Servers / workspace', 'Monthly tokens', 'Max input', 'Max output']) {
    expect(screen.getByLabelText(label)).toHaveValue(0)
  }
  expect(screen.getByLabelText('Visibility')).toHaveValue('Private')
  expect(screen.getByLabelText('Default model')).toHaveValue('')
  expect(screen.getByLabelText('Fallback model')).toHaveValue('')
  expect(screen.getByLabelText('Included features')).toHaveValue('')
  expect(screen.queryByText(/GPT|Claude|OpenAI|Approval-first execution/i)).not.toBeInTheDocument()
})

it('shows starter recommendations without changing plan values', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter initialEntries={['/plans/new']}><AdminConsole /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Create plan' })
  expect(screen.getByText('Recommended starter: 1 workspace per account')).toBeInTheDocument()
  expect(screen.getByText('Recommended starter: 3 servers per workspace')).toBeInTheDocument()
  expect(screen.getByText('Recommended starter: 1,000,000 tokens per workspace')).toBeInTheDocument()
  expect(screen.getByText(/Recommended starter: 32,000; keep within model context/)).toBeInTheDocument()
  expect(screen.getByText(/Recommended starter: 8,000; keep within model output limit/)).toBeInTheDocument()
  expect(screen.getByText(/Recommended starter: Block requests/)).toBeInTheDocument()
  expect(screen.getByLabelText('Max workspaces')).toHaveValue(0)
  expect(screen.getByLabelText('Monthly tokens')).toHaveValue(0)
})

const plan = { id: 'plan-1', name: 'Private Plan', slug: 'private-plan', description: 'Private', price_cents: 5999, annual_price_cents: 4799, status: 'draft', max_workspaces: 1, max_servers: 3, monthly_tokens: 100, input_tokens: 10, output_tokens: 5, over_limit: 'block_requests', default_model_id: 'model-1', fallback_model_id: 'model-1', allowed_model_ids: ['model-1'], features: ['Feature'], visibility: 'private' }
const model = { id: 'model-1', model_id: 'backend-model', name: 'Backend Model', provider: 'Provider', context_window: 32000, status: 'active', fallback: false }

it('keeps plan editor mounted with input after failed save', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => init?.method === 'POST'
    ? new Response(JSON.stringify({ error: 'invalid plan fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    : new Response(JSON.stringify({ models: [model] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter initialEntries={['/plans/new']}><AdminConsole /></MemoryRouter>)
  const name = await screen.findByLabelText('Plan name')
  await userEvent.type(name, 'Unsaved Plan')
  await userEvent.click(screen.getByRole('button', { name: /Save draft/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid plan fields')
  expect(screen.getByLabelText('Plan name')).toHaveValue('Unsaved Plan')
})

it('states private published plan remains hidden', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(plan), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter initialEntries={['/plans/plan-1/preview']}><AdminConsole /></MemoryRouter>)
  await userEvent.click(await screen.findByRole('button', { name: /Publish plan/ }))
  expect(screen.getByText(/remain hidden from public catalog/)).toBeInTheDocument()
  expect(screen.getByText('Unchanged')).toBeInTheDocument()
})

it('configures workspace AI with selected model and monthly quota', async () => {
  const requests: Array<{ url: string; body?: unknown }> = []
  let resolveSave!: (response: Response) => void
  const saveResponse = new Promise<Response>(resolve => { resolveSave = resolve })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input); requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/admin/workspaces')) return new Response(JSON.stringify({ workspaces: [{ id: 'workspace-1', name: 'Northstar', created_at: '2026-08-21T00:00:00Z' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.endsWith('/admin/models')) return new Response(JSON.stringify({ models: [model] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.endsWith('/ai-config') && !init?.method) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    if (url.endsWith('/ai-config') && init?.method === 'POST') return saveResponse
    throw new Error(`Unexpected request: ${url}`)
  })
  render(<MemoryRouter initialEntries={['/workspaces']}><AdminConsole /></MemoryRouter>)
  expect(await screen.findByText('Northstar')).toBeInTheDocument()
  expect(screen.getByText('0 disables chat for this workspace.')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Model for Northstar'), 'model-1')
  await userEvent.clear(screen.getByLabelText('Monthly token limit for Northstar'))
  await userEvent.type(screen.getByLabelText('Monthly token limit for Northstar'), '250000')
  await userEvent.click(screen.getByRole('button', { name: 'Save Northstar AI configuration' }))
  expect(screen.getByLabelText('Model for Northstar')).toBeDisabled()
  expect(screen.getByLabelText('Monthly token limit for Northstar')).toBeDisabled()
  await waitFor(() => expect(requests.find(request => request.body)).toMatchObject({ body: { default_model_id: 'model-1', monthly_token_limit: 250000 } }))
  resolveSave(new Response(JSON.stringify({ workspace_id: 'workspace-1', default_model_id: 'model-1', monthly_token_limit: 250000, model_status: 'active' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  await waitFor(() => expect(screen.getByLabelText('Model for Northstar')).not.toBeDisabled())
})

it('loads and displays authentication & SMTP settings', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith('/auth-settings/google')) {
      return new Response(JSON.stringify({ provider: 'google', client_id: 'google-client-id', redirect_uri: 'http://localhost:5173/auth/google/callback', enabled: true, has_client_secret: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.endsWith('/admin/smtp')) {
      return new Response(JSON.stringify({ host: 'smtp.domain.com', port: 587, username: 'alerts@domain.com', from_email: 'alerts@domain.com', from_name: 'OpsAI', encryption: 'starttls', enabled: true, require_email_verification: true, has_password: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (url.endsWith('/admin/duitku')) {
      return new Response(JSON.stringify({ merchant_code: 'DS1234', environment: 'sandbox', enabled: true, callback_url: 'http://localhost:8080/callback', return_url: 'http://localhost:5173/result', expiry_period_minutes: 60, has_api_key: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  render(<MemoryRouter initialEntries={['/auth']}><AdminConsole /></MemoryRouter>)
  expect(await screen.findByText('Authentication & Email Settings')).toBeInTheDocument()
  expect(screen.getByText('Google OAuth 2.0')).toBeInTheDocument()
  expect(screen.getByText('SMTP Email & Registration Verification')).toBeInTheDocument()
  expect(screen.getByText('Duitku POP Payment Gateway')).toBeInTheDocument()
  expect(screen.getByDisplayValue('smtp.domain.com')).toBeInTheDocument()
  expect(screen.getByDisplayValue('DS1234')).toBeInTheDocument()
  expect(screen.getAllByDisplayValue('alerts@domain.com')).toHaveLength(2)
})
