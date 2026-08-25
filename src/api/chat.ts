import { API_URL, apiRequest, unwrapList, unwrapOne } from './client'

export type ChatThread = {
  id: string
  title: string
  serverId: string
  serverName?: string
  status?: 'active' | 'archived' | string
  archivedAt?: string
  createdAt?: string
  updatedAt?: string
}

export type ChatMessage = {
  id: string
  threadId?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt?: string
  sequence?: number
  replyToMessageId?: string
  operationId?: string
  kind: 'chat' | 'plan' | 'result'
}

export type OperationStep = {
  id: string
  title: string
  status: string
  command?: string
  output?: string
  stdout?: string
  stderr?: string
  exitCode?: number
}

export type Operation = {
  id: string
  threadId?: string
  serverId?: string
  serverName?: string
  title: string
  summary?: string
  status: string
  policy?: ChatPolicy
  steps: OperationStep[]
  exitCode?: number
  error?: string
  createdAt?: string
  startedAt?: string
  completedAt?: string
  agentRound?: number
}

export type OperationEvent = {
  id: string
  type: string
  text: string
  status?: string
  stepId?: string
  exitCode?: number
  createdAt?: string
  messageId?: string
}

export type ChatPolicy = 'approval_required' | 'explain_only' | 'unrestricted_approval' | 'autonomous_full_access'

export type ChatConfig = {
  configured: boolean
  modelId?: string
  modelName?: string
  monthlyTokenLimit: number
  usedTokens: number
  modelStatus?: string
}

export type ChatContext = {
  threadId: string
  contextWindow: number
  estimatedTokens: number
  usagePercent: number
  compacted: boolean
  compactedAt?: string
}

export type OperationStatusAck = { id: string; status: string }

type AnyDTO = Record<string, unknown>
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const number = (value: unknown) => typeof value === 'number' ? value : undefined

function threadFromDTO(value: unknown): ChatThread {
  const dto = (value || {}) as AnyDTO
  const server = (dto.server || {}) as AnyDTO
  return { id: text(dto.id), title: text(dto.title, 'Untitled chat'), serverId: text(dto.server_id ?? server.id), serverName: text(dto.server_name ?? server.name) || undefined, status: text(dto.status) || undefined, archivedAt: text(dto.archived_at) || undefined, createdAt: text(dto.created_at) || undefined, updatedAt: text(dto.updated_at) || undefined }
}

function messageFromDTO(value: unknown): ChatMessage {
  const dto = (value || {}) as AnyDTO
  const rawRole = text(dto.role, 'assistant')
  const role = ['user', 'assistant', 'system'].includes(rawRole) ? rawRole as ChatMessage['role'] : 'assistant'
  const rawKind = text(dto.kind, 'chat')
  const kind = ['chat', 'plan', 'result'].includes(rawKind) ? rawKind as ChatMessage['kind'] : 'chat'
  return { id: text(dto.id), threadId: text(dto.thread_id) || undefined, role, content: text(dto.content ?? dto.text ?? dto.message), createdAt: text(dto.created_at) || undefined, sequence: number(dto.sequence), replyToMessageId: text(dto.reply_to_message_id) || undefined, operationId: text(dto.operation_id) || undefined, kind }
}

function stepFromDTO(value: unknown, index: number): OperationStep {
  const dto = (value || {}) as AnyDTO
  const executable = text(dto.executable)
  const args = Array.isArray(dto.args) ? dto.args.filter((arg): arg is string => typeof arg === 'string') : []
  const quote = (value: string) => /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`
  const command = text(dto.command) || (executable ? [quote(executable), ...args.map(quote)].join(' ') : '')
  const stdout = text(dto.stdout)
  const stderr = text(dto.stderr)
  return { id: text(dto.id, `step-${index + 1}`), title: text(dto.title ?? dto.name ?? dto.description, `Step ${index + 1}`), status: text(dto.status, 'pending'), command: command || undefined, output: text(dto.output) || stdout || undefined, stdout, stderr, exitCode: number(dto.exit_code) }
}

export function operationFromDTO(value: unknown): Operation {
  const dto = (value || {}) as AnyDTO
  const server = (dto.server || {}) as AnyDTO
  const rawSteps = Array.isArray(dto.steps) ? dto.steps : Array.isArray(dto.plan) ? dto.plan : []
  return { id: text(dto.id), threadId: text(dto.thread_id) || undefined, serverId: text(dto.server_id ?? server.id) || undefined, serverName: text(dto.server_name ?? server.name) || undefined, title: text(dto.title ?? dto.name ?? dto.prompt, 'Operation'), summary: text(dto.summary) || undefined, status: text(dto.status, 'planning'), policy: text(dto.policy) as ChatPolicy || undefined, steps: rawSteps.map(stepFromDTO), exitCode: number(dto.exit_code), error: text(dto.error) || undefined, createdAt: text(dto.created_at) || undefined, startedAt: text(dto.started_at) || undefined, completedAt: text(dto.finished_at ?? dto.completed_at) || undefined, agentRound: number(dto.agent_round) }
}

function operationFromResponse(body: unknown): Operation | undefined {
  if (!body || typeof body !== 'object') return undefined
  const dto = body as AnyDTO
  const value = dto.operation ?? dto.data
  if (value && typeof value === 'object' && ('status' in (value as AnyDTO) || 'steps' in (value as AnyDTO))) return operationFromDTO(value)
  if ('status' in dto && 'id' in dto) return operationFromDTO(dto)
  return undefined
}

export const chatApi = {
  async getConfig(): Promise<ChatConfig> {
    const dto = await apiRequest<AnyDTO>('/api/v1/chat/config')
    const modelId = text(dto.model_id ?? dto.default_model_id) || undefined
    const modelName = text(dto.model_name) || undefined
    const monthlyTokenLimit = number(dto.monthly_token_limit) || 0
    const usedTokens = number(dto.used_tokens) || 0
    const modelStatus = text(dto.model_status) || undefined
    return { configured: typeof dto.configured === 'boolean' ? dto.configured : Boolean(modelId && monthlyTokenLimit > 0 && (!modelStatus || modelStatus === 'active')), modelId, modelName, monthlyTokenLimit, usedTokens, modelStatus }
  },
  async listThreads() { return unwrapList<unknown>(await apiRequest('/api/v1/chat/threads'), 'threads').map(threadFromDTO) },
  async createThread(input: { serverId: string; title?: string }) { return threadFromDTO(unwrapOne(await apiRequest('/api/v1/chat/threads', { method: 'POST', body: JSON.stringify({ server_id: input.serverId, ...(input.title ? { title: input.title } : {}) }) }), 'thread')) },
  async getThread(id: string) { return threadFromDTO(unwrapOne(await apiRequest(`/api/v1/chat/threads/${encodeURIComponent(id)}`), 'thread')) },
  async updateThread(id: string, input: { title: string; status: 'active' | 'archived' }) { return threadFromDTO(unwrapOne(await apiRequest(`/api/v1/chat/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }), 'thread')) },
  async deleteThread(id: string) { return apiRequest<void>(`/api/v1/chat/threads/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
  async listMessages(id: string, pagination?: { limit?: number; beforeSequence?: number }) {
    const params = new URLSearchParams()
    if (pagination?.limit) params.set('limit', String(pagination.limit))
    if (pagination?.beforeSequence != null) params.set('before_sequence', String(pagination.beforeSequence))
    const query = params.toString() ? `?${params.toString()}` : ''
    return unwrapList<unknown>(await apiRequest(`/api/v1/chat/threads/${encodeURIComponent(id)}/messages${query}`), 'messages').map(messageFromDTO)
  },
  async getContext(id: string) {
    const dto = await apiRequest<AnyDTO>(`/api/v1/chat/threads/${encodeURIComponent(id)}/context`)
    return { threadId: text(dto.thread_id), contextWindow: number(dto.context_window) || 0, estimatedTokens: number(dto.estimated_tokens) || 0, usagePercent: number(dto.usage_percent) || 0, compacted: Boolean(dto.compacted), compactedAt: text(dto.compacted_at) || undefined } satisfies ChatContext
  },
  async compactContext(id: string) {
    return apiRequest<{ success: boolean; summary: string }>(`/api/v1/chat/threads/${encodeURIComponent(id)}/compact`, { method: 'POST', body: JSON.stringify({}) })
  },
  async sendMessage(id: string, input: { content: string; policy: ChatPolicy }) {
    const body = await apiRequest<unknown>(`/api/v1/chat/threads/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ content: input.content, policy: input.policy }) })
    const dto = (body || {}) as AnyDTO
    return { message: dto.message ? messageFromDTO(dto.message) : ('role' in dto ? messageFromDTO(dto) : undefined), operation: operationFromResponse(body) }
  },
  async listOperations(filters: { threadId?: string; page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams()
    if (filters.threadId) params.set('thread_id', filters.threadId)
    if (filters.page) params.set('page', String(filters.page))
    if (filters.pageSize) params.set('page_size', String(filters.pageSize))
    const query = params.toString() ? `?${params}` : ''
    const body = await apiRequest<Record<string, unknown>>(`/api/v1/operations${query}`)
    return {
      operations: unwrapList<unknown>(body, 'operations').map(operationFromDTO),
      page: typeof body.page === 'number' ? body.page : filters.page || 1,
      pageSize: typeof body.page_size === 'number' ? body.page_size : filters.pageSize || 20,
      total: typeof body.total === 'number' ? body.total : 0,
      totalPages: typeof body.total_pages === 'number' ? body.total_pages : 0,
    }
  },
  async getOperation(id: string) { return operationFromDTO(unwrapOne(await apiRequest(`/api/v1/operations/${encodeURIComponent(id)}`), 'operation')) },
  async approveOperation(id: string) { return unwrapOne<OperationStatusAck>(await apiRequest(`/api/v1/operations/${encodeURIComponent(id)}/approve`, { method: 'POST' }), 'operation') },
  async rejectOperation(id: string) { return unwrapOne<OperationStatusAck>(await apiRequest(`/api/v1/operations/${encodeURIComponent(id)}/reject`, { method: 'POST' }), 'operation') },
  async cancelOperation(id: string) { return unwrapOne<OperationStatusAck>(await apiRequest(`/api/v1/operations/${encodeURIComponent(id)}/cancel`, { method: 'POST' }), 'operation') },
  async retryOperation(id: string) { return unwrapOne<OperationStatusAck>(await apiRequest(`/api/v1/operations/${encodeURIComponent(id)}/retry`, { method: 'POST' }), 'operation') },
}

export function operationEventsUrl(id: string, lastEventId?: string) {
  const query = lastEventId ? `?last_event_id=${encodeURIComponent(lastEventId)}` : ''
  return `${API_URL}/api/v1/operations/${encodeURIComponent(id)}/events${query}`
}

export function operationEventFromMessage(message: MessageEvent): OperationEvent {
  let envelope: AnyDTO = {}
  try { envelope = JSON.parse(String(message.data)) as AnyDTO } catch { envelope = { text: String(message.data) } }
  const nested = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload as AnyDTO : {}
  const payload = { ...envelope, ...nested }
  const type = message.type !== 'message' ? message.type : text(envelope.event_type ?? envelope.type ?? payload.stream, 'message')
  const envelopeId = envelope.id ?? envelope.event_id
  return { id: message.lastEventId || (typeof envelopeId === 'number' ? String(envelopeId) : text(envelopeId)), type, text: text(payload.delta ?? payload.chunk ?? payload.text ?? payload.output ?? payload.data ?? payload.message), status: text(payload.status ?? payload.state) || undefined, stepId: text(envelope.step_id ?? payload.step_id) || undefined, exitCode: number(payload.exit_code), createdAt: text(envelope.created_at ?? envelope.timestamp ?? payload.created_at ?? payload.timestamp) || undefined, messageId: text(envelope.message_id ?? payload.message_id) || undefined }
}

export function reduceOperationEvents(current: OperationEvent[], incoming: OperationEvent[]) {
  const keys = new Set(current.map((event, index) => event.id || `${event.type}:${event.createdAt}:${index}`))
  return incoming.reduce((events, event) => {
    const key = event.id || `${event.type}:${event.createdAt}:${event.text}`
    if (keys.has(key)) return events
    keys.add(key)
    return [...events, event]
  }, current)
}
