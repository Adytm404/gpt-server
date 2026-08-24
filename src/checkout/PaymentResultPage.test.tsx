import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import PaymentResultPage from './PaymentResultPage'

describe('PaymentResultPage', () => {
  it('renders order error when no order id supplied', () => {
    render(
      <MemoryRouter initialEntries={['/checkout/result']}>
        <Routes>
          <Route path="/checkout/result" element={<PaymentResultPage />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('Order not found')).toBeInTheDocument()
    expect(screen.getByText('No order ID specified.')).toBeInTheDocument()
  })

  it('renders paid subscription status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      order_id: 'ord-1',
      merchant_order_id: 'OPS-12345',
      reference: 'REF-123',
      plan_name: 'Professional',
      billing_period: 'monthly',
      amount_idr: 150000,
      status: 'paid',
      payment_method: 'QRIS',
      payment_url: 'https://app.duitku.com/pay',
      created_at: '2026-08-24T00:00:00Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    render(
      <MemoryRouter initialEntries={['/checkout/result?merchantOrderId=OPS-12345']}>
        <Routes>
          <Route path="/checkout/result" element={<PaymentResultPage />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('Subscription Active!')).toBeInTheDocument()
    expect(screen.getByText('Payment Verified')).toBeInTheDocument()
    expect(screen.getByText('Open Workspace')).toBeInTheDocument()
  })
})
