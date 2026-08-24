import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import CheckoutPage from './CheckoutPage'
import { adminApi, listPublicPlans } from '../api/admin'

describe('CheckoutPage', () => {
  const plan = {
    id: 'plan-pro',
    revisionId: 'rev-1',
    revision: 1,
    name: 'Professional',
    slug: 'professional',
    description: 'For growing infra',
    priceCents: 150000,
    annualPriceCents: 120000,
    status: 'Published' as const,
    maxWorkspaces: 1,
    maxServers: 10,
    monthlyTokens: 500000,
    inputTokens: 250000,
    outputTokens: 250000,
    overLimit: 'Block requests',
    defaultModel: 'model-1',
    fallbackModel: 'model-1',
    allowedModels: [],
    features: ['Live Terminal Logs', 'Automated Health Alerts'],
    visibility: 'Public',
  }

  it('renders order confirmation with plan details and IDR pricing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/public/plans')) return new Response(JSON.stringify({ plans: [{ id: 'plan-pro', name: 'Professional', slug: 'professional', description: 'For growing infra', price_cents: 150000, annual_price_cents: 120000, status: 'published', max_workspaces: 1, max_servers: 10, monthly_tokens: 500000, input_tokens: 250000, output_tokens: 250000, over_limit: 'block_requests', default_model_id: 'm1', fallback_model_id: 'm1', allowed_model_ids: [], features: ['Live Terminal Logs'], visibility: 'public' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/public/billing/config')) return new Response(JSON.stringify({ duitku_enabled: true, duitku_environment: 'sandbox', merchant_code: 'D1234' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      throw new Error(`Unexpected request: ${url}`)
    })

    render(
      <MemoryRouter initialEntries={['/checkout/plan-pro']}>
        <Routes>
          <Route path="/checkout/:planId" element={<CheckoutPage />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('Subscribe to Professional')).toBeInTheDocument()
    expect(screen.getByText('Order Confirmation')).toBeInTheDocument()
    expect(screen.getByText(/10 servers/)).toBeInTheDocument()
    expect(screen.getByText('Pay with Duitku')).toBeInTheDocument()
  })

  it('triggers checkout order creation on clicking Pay', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/public/plans')) return new Response(JSON.stringify({ plans: [{ id: 'plan-pro', name: 'Professional', slug: 'professional', description: 'For growing infra', price_cents: 150000, annual_price_cents: 120000, status: 'published', max_workspaces: 1, max_servers: 10, monthly_tokens: 500000, input_tokens: 250000, output_tokens: 250000, over_limit: 'block_requests', default_model_id: 'm1', fallback_model_id: 'm1', allowed_model_ids: [], features: [], visibility: 'public' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/public/billing/config')) return new Response(JSON.stringify({ duitku_enabled: true, duitku_environment: 'sandbox', merchant_code: 'D1234' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/billing/checkout')) return new Response(JSON.stringify({ order_id: 'ord-1', merchant_order_id: 'OPS-123', reference: 'REF-1', payment_url: 'https://app-sandbox.duitku.com/redirect', amount_idr: 150000, environment: 'sandbox', plan_name: 'Professional', billing_period: 'monthly' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      throw new Error(`Unexpected request: ${url}`)
    })

    render(
      <MemoryRouter initialEntries={['/checkout/plan-pro']}>
        <Routes>
          <Route path="/checkout/:planId" element={<CheckoutPage />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('Subscribe to Professional')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Pay with Duitku/i }))

    await waitFor(() => {
      expect(screen.getByText(/Open Payment in New Tab/i)).toBeInTheDocument()
    })
  })
})
