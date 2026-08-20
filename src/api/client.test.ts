import { ApiError, apiRequest, getCsrfToken, unwrapOne } from './client'

describe('apiRequest', () => {
  afterEach(() => vi.restoreAllMocks())

  it('includes credentials and decoded CSRF token on mutations', async () => {
    Object.defineProperty(document, 'cookie', { configurable: true, value: 'opsai_csrf=token%2Bvalue' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    await apiRequest('/api/v1/admin/plans/one/archive', { method: 'POST' })
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('token+value')
    expect(getCsrfToken()).toBe('token+value')
  })

  it('throws consistent API errors with request IDs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'not allowed', request_id: 'req-7' }), { status: 403, headers: { 'Content-Type': 'application/json' } }))
    await expect(apiRequest('/api/v1/admin/models')).rejects.toEqual(expect.objectContaining({ message: 'not allowed', status: 403, requestId: 'req-7' }))
  })

  it('explains how to start an unreachable backend', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(apiRequest('/api/v1/admin/models')).rejects.toEqual(expect.objectContaining({
      message: 'Cannot reach backend at same origin. Start it with cd backend && go run .',
      status: 0,
    }))
  })
})

describe('unwrapOne', () => {
  it('returns direct resource objects without requiring an envelope', () => {
    const model = { id: 'model-1', name: 'Direct model' }
    expect(unwrapOne(model, 'model')).toBe(model)
  })

  it('still supports named and data envelopes', () => {
    expect(unwrapOne({ plan: { id: 'plan-1' } }, 'plan')).toEqual({ id: 'plan-1' })
    expect(unwrapOne({ data: { id: 'server-1' } }, 'server')).toEqual({ id: 'server-1' })
  })
})
