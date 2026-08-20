import { render, screen } from '@testing-library/react'
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
