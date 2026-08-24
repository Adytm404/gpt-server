import { adminApi, modelFromDTO, modelToInput, planFromDTO, planToInput } from './admin'

const modelResponse = { id: 'model-uuid', model_id: 'backend-model', name: 'Backend Model', provider: 'Provider', context_window: 32000, base_url: 'https://api.example.com/v1', status: 'active' as const, fallback: false }
const planResponse = { id: 'plan-uuid', name: 'Control', slug: 'control', description: 'Teams', price_cents: 5900, annual_price_cents: 4700, status: 'published' as const, max_workspaces: 3, max_servers: 15, monthly_tokens: 1000, input_tokens: 64, output_tokens: 16, over_limit: 'allow_with_warning' as const, default_model_id: 'a', fallback_model_id: 'b', allowed_model_ids: ['a', 'b'], features: ['Feature'], visibility: 'public' as const }

describe('admin DTO mapping', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps snake_case model fields to UI fields', () => {
    expect(modelFromDTO(modelResponse)).toEqual({ id: 'model-uuid', modelId: 'backend-model', name: 'Backend Model', provider: 'Provider', context: '32K', baseUrl: 'https://api.example.com/v1', status: 'Active', fallback: false, credentialConfigured: undefined, credentialRef: undefined })
  })

  it('round trips plan policy fields', () => {
    expect(planToInput(planFromDTO({ ...planResponse, status: 'draft', visibility: 'private', over_limit: 'block_requests' }))).toEqual({ name: 'Control', slug: 'control', description: 'Teams', price_cents: 5900, annual_price_cents: 4700, max_workspaces: 3, max_servers: 15, monthly_tokens: 1000, input_tokens: 64, output_tokens: 16, over_limit: 'block_requests', default_model_id: 'a', fallback_model_id: 'b', allowed_model_ids: ['a', 'b'], features: ['Feature'], visibility: 'private' })
  })

  it('builds model input with only backend-accepted fields', () => {
    expect(modelToInput(modelFromDTO(modelResponse))).toEqual({ name: 'Backend Model', provider: 'Provider', model_id: 'backend-model', context_window: 32000, base_url: 'https://api.example.com/v1' })
  })

  it('posts exact model input fields and accepts direct model response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(modelResponse), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    await adminApi.saveModel({ id: '', modelId: 'backend-model', name: 'Backend Model', provider: 'Provider', context: '32K', baseUrl: 'https://api.example.com/v1', status: 'Active', fallback: false }, true)
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Backend Model', provider: 'Provider', model_id: 'backend-model', context_window: 32000, base_url: 'https://api.example.com/v1' })
  })

  it('persists desired model status and returns refreshed model', async () => {
    const disabled = { ...modelResponse, status: 'disabled' as const }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(modelResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [disabled] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const saved = await adminApi.saveModel({ ...modelFromDTO(modelResponse), status: 'Disabled' }, false)
    expect(saved.status).toBe('Disabled')
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/models\/model-uuid\/disable$/)
  })

  it('sends credential reference without exposing a secret field', () => {
    expect(modelToInput({ ...modelFromDTO(modelResponse), credentialRef: ' vault://models/provider ' })).toEqual({ name: 'Backend Model', provider: 'Provider', model_id: 'backend-model', context_window: 32000, base_url: 'https://api.example.com/v1', credential_ref: 'vault://models/provider' })
  })

  it('posts exact draft test fields including a nonblank API key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, latency_ms: 84 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await adminApi.testModelDraft({ ...modelFromDTO(modelResponse), apiKey: ' sk-test-secret ', credentialRef: ' vault://models/provider ' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/v1\/admin\/models\/test$/)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Backend Model', provider: 'Provider', model_id: 'backend-model', context_window: 32000, base_url: 'https://api.example.com/v1', api_key: 'sk-test-secret', credential_ref: 'vault://models/provider' })
  })

  it('omits API key from draft tests when blank', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, latency_ms: 12 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await adminApi.testModelDraft({ ...modelFromDTO(modelResponse), apiKey: '   ' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ name: 'Backend Model', provider: 'Provider', model_id: 'backend-model', context_window: 32000, base_url: 'https://api.example.com/v1' })
  })

  it('tests a saved model by ID without a body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, latency_ms: 21 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await adminApi.testSavedModel('model/uuid')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/v1\/admin\/models\/model%2Fuuid\/test$/)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
  })

  it('deduplicates plan revisions by plan id and prefers draft', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ plans: [planResponse, { ...planResponse, name: 'Draft Control', status: 'draft' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(adminApi.listPlans()).resolves.toEqual([expect.objectContaining({ id: 'plan-uuid', name: 'Draft Control', status: 'Draft' })])
  })

  it('creates a draft before patching a published plan', async () => {
    const draft = { ...planResponse, status: 'draft' as const }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(planResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await adminApi.savePlan(planFromDTO(planResponse), false)
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url).replace(/^.*\/api/, '/api'), init?.method || 'GET'])).toEqual([
      ['/api/v1/admin/plans/plan-uuid', 'GET'],
      ['/api/v1/admin/plans/plan-uuid/draft', 'POST'],
      ['/api/v1/admin/plans/plan-uuid/draft', 'PATCH'],
    ])
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).not.toHaveProperty('id')
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).not.toHaveProperty('status')
  })

  it('uses preview endpoint and direct plan response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(planResponse), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await adminApi.previewPlan('plan-uuid')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/v1\/admin\/plans\/plan-uuid\/preview$/)
  })

  it('maps backend history actor and plural type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ events: [{ id: 'event-1', action: 'Plan published', target_name: 'Control', actor: 'Aria', type: 'plans', created_at: '2026-08-20T00:00:00Z' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(adminApi.history()).resolves.toEqual([{ id: 'event-1', action: 'Plan published', target_name: 'Control', actorName: 'Aria', resourceType: 'plan', created_at: '2026-08-20T00:00:00Z' }])
  })

  it('maps server history events', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ events: [{ id: 'event-2', action: 'Server created', target_name: 'API', actor: 'Aria', type: 'servers', created_at: '2026-08-20T00:00:00Z' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(adminApi.history()).resolves.toEqual([expect.objectContaining({ resourceType: 'server' })])
  })

  it('fetches and updates SMTP settings', async () => {
    const smtpSettings = { host: 'smtp.mail.com', port: 587, username: 'user', from_email: 'no-reply@mail.com', from_name: 'OpsAI', encryption: 'starttls' as const, enabled: true, require_email_verification: true, has_password: true }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(smtpSettings), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(smtpSettings), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(adminApi.getSMTPSettings()).resolves.toEqual(smtpSettings)
    await expect(adminApi.setSMTPSettings({ host: 'smtp.mail.com', port: 587, username: 'user', from_email: 'no-reply@mail.com', from_name: 'OpsAI', encryption: 'starttls', enabled: true, require_email_verification: true })).resolves.toEqual(smtpSettings)
  })

  it('calls verify email and resend endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, message: 'Verified' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, message: 'Sent' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(adminApi.verifyEmail('token-123')).resolves.toEqual({ success: true, message: 'Verified' })
    await expect(adminApi.resendVerification('user@domain.com')).resolves.toEqual({ success: true, message: 'Sent' })
  })
})
