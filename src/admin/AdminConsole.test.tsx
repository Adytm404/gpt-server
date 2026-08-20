import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AdminConsole from './AdminConsole'

it('loads models for admin models route', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ models: [{ id: 'model-api', model_id: 'backend-model', name: 'Backend Model', provider: 'Provider', context_window: 32000, status: 'active', fallback: false, last_test_latency_ms: null }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter initialEntries={['/models']}><AdminConsole /></MemoryRouter>)
  expect(await screen.findByText('Backend Model')).toBeInTheDocument()
  expect(screen.queryByText('GPT-5 mini')).not.toBeInTheDocument()
})

const plan = { id: 'plan-1', name: 'Private Plan', slug: 'private-plan', description: 'Private', price_cents: 5999, annual_price_cents: 4799, status: 'draft', max_workspaces: 1, max_servers: 3, monthly_tokens: 100, input_tokens: 10, output_tokens: 5, over_limit: 'block_requests', default_model_id: 'model-1', fallback_model_id: 'model-1', allowed_model_ids: ['model-1'], features: ['Feature'], visibility: 'private', subscribers: 0 }
const model = { id: 'model-1', model_id: 'backend-model', name: 'Backend Model', provider: 'Provider', context_window: 32000, status: 'active', fallback: false, last_test_latency_ms: null }

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
