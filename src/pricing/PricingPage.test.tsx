import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import PricingPage from './PricingPage'

it('renders public API plans without hardcoded fallback pricing', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ plans: [{ id: 'api-plan', name: 'API Plan', slug: 'api-plan', description: 'From API', price_cents: 7399, annual_price_cents: 6199, status: 'published', max_workspaces: 1, max_servers: 9, monthly_tokens: 100, input_tokens: 10, output_tokens: 5, over_limit: 'block', default_model_id: 'm', fallback_model_id: 'm', allowed_model_ids: ['m'], features: ['API feature'], visibility: 'public' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  render(<MemoryRouter><PricingPage /></MemoryRouter>)
  expect(await screen.findByText('API Plan')).toBeInTheDocument()
  expect(screen.getByText('61.99')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Monthly' }))
  expect(screen.getByText('73.99')).toBeInTheDocument()
  expect(screen.queryByText('Operator')).not.toBeInTheDocument()
})
