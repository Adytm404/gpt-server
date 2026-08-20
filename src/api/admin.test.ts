import { adminApi, modelFromDTO, modelToInput, planFromDTO, planToInput } from './admin'

const modelResponse = { id: 'model-uuid', model_id: 'gpt-5-mini', name: 'GPT mini', provider: 'OpenAI', context_window: 128000, status: 'active' as const, fallback: false, last_test_latency_ms: null }
const planResponse = { id: 'plan-uuid', name: 'Control', slug: 'control', description: 'Teams', price_cents: 5900, annual_price_cents: 4700, status: 'published' as const, max_workspaces: 3, max_servers: 15, monthly_tokens: 1000, input_tokens: 64, output_tokens: 16, over_limit: 'allow_with_warning' as const, default_model_id: 'a', fallback_model_id: 'b', allowed_model_ids: ['a', 'b'], features: ['Feature'], visibility: 'public' as const, subscribers: 2 }

describe('admin DTO mapping', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps snake_case model fields to UI fields', () => {
    expect(modelFromDTO({ id: 'uuid', model_id: 'gpt', name: 'GPT', provider: 'OpenAI', context_window: 128000, status: 'active', fallback: true, last_test_latency_ms: 820 })).toMatchObject({ context: '128K', status: 'Active', fallback: true, latency: '820ms' })
  })

  it('round trips plan policy fields', () => {
    expect(planToInput(planFromDTO({ ...planResponse, status: 'draft', visibility: 'private', over_limit: 'block_requests' }))).toEqual({ name: 'Control', slug: 'control', description: 'Teams', price_cents: 5900, annual_price_cents: 4700, max_workspaces: 3, max_servers: 15, monthly_tokens: 1000, input_tokens: 64, output_tokens: 16, over_limit: 'block_requests', default_model_id: 'a', fallback_model_id: 'b', allowed_model_ids: ['a', 'b'], features: ['Feature'], visibility: 'private' })
  })

  it('builds model input with only backend-accepted fields', () => {
    expect(modelToInput(modelFromDTO(modelResponse))).toEqual({ name: 'GPT mini', provider: 'OpenAI', model_id: 'gpt-5-mini', context_window: 128000 })
  })

  it('posts exact model input fields and accepts direct model response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(modelResponse), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    await adminApi.saveModel({ id: '', modelId: 'gpt-5-mini', name: 'GPT mini', provider: 'OpenAI', context: '128K', status: 'Active', fallback: false, latency: '-' }, true)
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'GPT mini', provider: 'OpenAI', model_id: 'gpt-5-mini', context_window: 128000 })
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
    expect(modelToInput({ ...modelFromDTO(modelResponse), credentialRef: ' vault://models/openai ' })).toEqual({ name: 'GPT mini', provider: 'OpenAI', model_id: 'gpt-5-mini', context_window: 128000, credential_ref: 'vault://models/openai' })
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
})
