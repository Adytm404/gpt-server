import { apiRequest, unwrapList, unwrapOne } from './client'

export type ModelDTO = {
  id: string
  model_id: string
  name: string
  provider: string
  context_window: number
  base_url: string
  status: 'active' | 'disabled'
  fallback: boolean
  credential_configured?: boolean
  credential_ref?: string
}

export type ModelInput = {
  name: string
  provider: string
  model_id: string
  context_window: number
  base_url: string
  api_key?: string
  credential_ref?: string
}

export type PlanDTO = {
  id: string
  name: string
  slug: string
  description: string
  price_cents: number
  annual_price_cents: number
  status: 'draft' | 'published' | 'archived'
  max_workspaces: number
  max_servers: number
  monthly_tokens: number
  input_tokens: number
  output_tokens: number
  over_limit: 'block_requests' | 'allow_with_warning'
  default_model_id: string
  fallback_model_id: string
  allowed_model_ids: string[]
  features: string[]
  visibility: 'public' | 'private'
}

export type PlanInput = Omit<PlanDTO, 'id' | 'status'>

export type HistoryEventDTO = {
  id: string
  action: string
  target_name: string
  actor: string
  type: string
  created_at: string
}

export type HistoryEvent = {
  id: string
  action: string
  target_name: string
  actorName: string
  resourceType: 'model' | 'plan' | 'server'
  created_at: string
}

export type Model = {
  id: string; modelId?: string; name: string; provider: string; context: string
  baseUrl: string
  status: 'Active' | 'Disabled'; fallback: boolean
  credentialConfigured?: boolean; credentialRef?: string; apiKey?: string
}

export type ModelTestResult = {
  success?: boolean
  status?: string
  latency_ms?: number
  message?: string
  error?: string
}

export type Plan = {
  id: string; name: string; slug: string; description: string; priceCents: number; annualPriceCents: number
  status: 'Draft' | 'Published' | 'Archived'; maxWorkspaces: number; maxServers: number; monthlyTokens: number
  inputTokens: number; outputTokens: number; overLimit: 'Block requests' | 'Allow with warning'; defaultModel: string
  fallbackModel: string; allowedModels: string[]; features: string[]; visibility: 'Public' | 'Private'
}

export function modelFromDTO(dto: ModelDTO): Model {
  return { id: dto.id, modelId: dto.model_id, name: dto.name, provider: dto.provider, context: formatTokens(dto.context_window), baseUrl: dto.base_url, status: dto.status === 'active' ? 'Active' : 'Disabled', fallback: dto.fallback, credentialConfigured: dto.credential_configured, credentialRef: dto.credential_ref }
}

export function modelToInput(model: Model): ModelInput {
  return { name: model.name, provider: model.provider, model_id: model.modelId || '', context_window: parseTokens(model.context), base_url: model.baseUrl, ...(model.apiKey?.trim() ? { api_key: model.apiKey.trim() } : {}), ...(model.credentialRef?.trim() ? { credential_ref: model.credentialRef.trim() } : {}) }
}

export function planFromDTO(dto: PlanDTO): Plan {
  return { id: dto.id, name: dto.name, slug: dto.slug, description: dto.description, priceCents: dto.price_cents, annualPriceCents: dto.annual_price_cents, status: title(dto.status) as Plan['status'], maxWorkspaces: dto.max_workspaces, maxServers: dto.max_servers, monthlyTokens: dto.monthly_tokens, inputTokens: dto.input_tokens, outputTokens: dto.output_tokens, overLimit: dto.over_limit === 'block_requests' ? 'Block requests' : 'Allow with warning', defaultModel: dto.default_model_id, fallbackModel: dto.fallback_model_id, allowedModels: dto.allowed_model_ids, features: dto.features, visibility: title(dto.visibility) as Plan['visibility'] }
}

export function planToInput(plan: Plan): PlanInput {
  return { name: plan.name, slug: plan.slug, description: plan.description, price_cents: plan.priceCents, annual_price_cents: plan.annualPriceCents, max_workspaces: plan.maxWorkspaces, max_servers: plan.maxServers, monthly_tokens: plan.monthlyTokens, input_tokens: plan.inputTokens, output_tokens: plan.outputTokens, over_limit: plan.overLimit === 'Block requests' ? 'block_requests' : 'allow_with_warning', default_model_id: plan.defaultModel, fallback_model_id: plan.fallbackModel, allowed_model_ids: plan.allowedModels, features: plan.features, visibility: plan.visibility.toLowerCase() as PlanDTO['visibility'] }
}

const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
const formatTokens = (value: number) => value >= 1_000_000 ? `${value / 1_000_000}M` : value >= 1_000 ? `${value / 1_000}K` : String(value)
const parseTokens = (value: string) => Math.round(Number.parseFloat(value) * (value.toUpperCase().endsWith('M') ? 1_000_000 : value.toUpperCase().endsWith('K') ? 1_000 : 1))
const json = (value: unknown) => JSON.stringify(value)

export const adminApi = {
  async listModels() { return unwrapList<ModelDTO>(await apiRequest('/api/v1/admin/models'), 'models').map(modelFromDTO) },
  async saveModel(model: Model, create: boolean) {
    const dto = unwrapOne<ModelDTO>(await apiRequest(create ? '/api/v1/admin/models' : `/api/v1/admin/models/${encodeURIComponent(model.id)}`, { method: create ? 'POST' : 'PATCH', body: json(modelToInput(model)) }), 'model')
    const saved = modelFromDTO(dto)
    if (saved.status !== model.status) {
      await adminApi.setModelStatus(saved.id, model.status === 'Active' ? 'active' : 'disabled')
      return (await adminApi.listModels()).find(item => item.id === saved.id) ?? { ...saved, status: model.status }
    }
    return saved
  },
  async setFallback(id: string) { return apiRequest<void>(`/api/v1/admin/models/${encodeURIComponent(id)}/fallback`, { method: 'POST' }) },
  async setModelStatus(id: string, status: ModelDTO['status']) { return apiRequest<void>(`/api/v1/admin/models/${encodeURIComponent(id)}/${status === 'active' ? 'enable' : 'disable'}`, { method: 'POST' }) },
  async testModelDraft(model: Model) { return apiRequest<ModelTestResult>('/api/v1/admin/models/test', { method: 'POST', body: json(modelToInput(model)) }) },
  async testSavedModel(id: string) { return apiRequest<ModelTestResult>(`/api/v1/admin/models/${encodeURIComponent(id)}/test`, { method: 'POST' }) },
  async listPlans() {
    const plans = unwrapList<PlanDTO>(await apiRequest('/api/v1/admin/plans'), 'plans').map(planFromDTO)
    return [...plans.reduce((byId, plan) => {
      const current = byId.get(plan.id)
      if (!current || plan.status === 'Draft') byId.set(plan.id, plan)
      return byId
    }, new Map<string, Plan>()).values()]
  },
  async getPlan(id: string) { return planFromDTO(unwrapOne<PlanDTO>(await apiRequest(`/api/v1/admin/plans/${encodeURIComponent(id)}`), 'plan')) },
  async previewPlan(id: string) { return planFromDTO(unwrapOne<PlanDTO>(await apiRequest(`/api/v1/admin/plans/${encodeURIComponent(id)}/preview`), 'plan')) },
  async savePlan(plan: Plan, create: boolean) {
    const body = json(planToInput(plan))
    if (create) return planFromDTO(unwrapOne<PlanDTO>(await apiRequest('/api/v1/admin/plans', { method: 'POST', body }), 'plan'))
    const current = await adminApi.getPlan(plan.id)
    if (current.status === 'Published') await apiRequest(`/api/v1/admin/plans/${encodeURIComponent(plan.id)}/draft`, { method: 'POST' })
    return planFromDTO(unwrapOne<PlanDTO>(await apiRequest(`/api/v1/admin/plans/${encodeURIComponent(plan.id)}/draft`, { method: 'PATCH', body }), 'plan'))
  },
  async duplicatePlan(id: string) { return planFromDTO(unwrapOne<PlanDTO>(await apiRequest(`/api/v1/admin/plans/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }), 'plan')) },
  async archivePlan(id: string) { return apiRequest<void>(`/api/v1/admin/plans/${encodeURIComponent(id)}/archive`, { method: 'POST' }) },
  async publishPlan(id: string) { await apiRequest(`/api/v1/admin/plans/${encodeURIComponent(id)}/publish`, { method: 'POST' }); return adminApi.getPlan(id) },
  async history(): Promise<HistoryEvent[]> { const events = unwrapList<HistoryEventDTO>(await apiRequest('/api/v1/admin/history'), 'events'); return events.map(event => ({ id: event.id, action: event.action, target_name: event.target_name, actorName: event.actor, resourceType: event.type.replace(/s$/, '') as HistoryEvent['resourceType'], created_at: event.created_at })) },
}

export async function listPublicPlans() {
  return unwrapList<PlanDTO>(await apiRequest('/api/v1/public/plans'), 'plans').map(planFromDTO)
}
