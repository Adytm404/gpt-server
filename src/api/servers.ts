import { apiRequest, unwrapList, unwrapOne } from './client'

export type ServerStatus = 'Online' | 'Offline' | 'Unknown'
export type Server = {
  id: string; name: string; host: string; port: number; username: string
  environment: 'Production' | 'Staging' | 'Development'; status: ServerStatus
  region: string; operatingSystem: string; uptime: string; fingerprint: string
  latestSnapshot: null | { cpuPercent: number; memoryPercent: number; diskPercent: number; capturedAt: string }
  services: Array<{ name: string; status: string; detail: string }>
}

export type ServerDTO = {
  id: string; name: string; host: string; port: number; ssh_user: string
  environment: 'production' | 'staging' | 'development'; status: 'online' | 'offline' | 'unknown'
  region: string; operating_system?: string; uptime?: string; host_fingerprint: string
  latest_snapshot?: { cpu_percent: number; memory_percent: number; disk_percent: number; captured_at?: string; checked_at?: string } | null
  services?: Array<{ name: string; status: string; detail?: string }>
}

export type ServerSummaryDTO = { total: number; online: number; offline: number; unknown: number }
export type CreateServerDTO = { name: string; host: string; port: number; username: string; password?: string; private_key?: string; host_fingerprint?: string; environment: string; region?: string }

export function serverFromDTO(dto: ServerDTO): Server {
  const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
  return { id: dto.id, name: dto.name, host: dto.host, port: dto.port, username: dto.ssh_user, environment: title(dto.environment) as Server['environment'], status: title(dto.status) as ServerStatus, region: dto.region || '-', operatingSystem: dto.operating_system || '-', uptime: dto.uptime || '-', fingerprint: dto.host_fingerprint || '', latestSnapshot: dto.latest_snapshot ? { cpuPercent: dto.latest_snapshot.cpu_percent, memoryPercent: dto.latest_snapshot.memory_percent, diskPercent: dto.latest_snapshot.disk_percent, capturedAt: dto.latest_snapshot.captured_at || dto.latest_snapshot.checked_at || '' } : null, services: (dto.services || []).map(service => ({ ...service, detail: service.detail || '' })) }
}

export const serversApi = {
  async list() {
    const body = await apiRequest<ServerDTO[] | { servers: ServerDTO[]; summary?: ServerSummaryDTO }>('/api/v1/servers')
    return { servers: unwrapList<ServerDTO>(body, 'servers').map(serverFromDTO), summary: !Array.isArray(body) ? body.summary : undefined }
  },
  async get(id: string) { return serverFromDTO(unwrapOne<ServerDTO>(await apiRequest(`/api/v1/servers/${encodeURIComponent(id)}`), 'server')) },
  async create(input: CreateServerDTO) { const { username, password: _password, ...fields } = input; return serverFromDTO(unwrapOne<ServerDTO>(await apiRequest('/api/v1/servers', { method: 'POST', body: JSON.stringify({ ...fields, ssh_user: username, region: input.region || '' }) }), 'server')) },
  async testConnection(id: string) { const result = await apiRequest<{ status: string; error?: string }>(`/api/v1/servers/${encodeURIComponent(id)}/test`, { method: 'POST' }); return { ok: result.status === 'online', message: result.error || `Network endpoint ${result.status}` } },
  async healthCheck(id: string) { await apiRequest(`/api/v1/servers/${encodeURIComponent(id)}/health-check`, { method: 'POST' }); return serversApi.get(id) },
  async remove(id: string) { return apiRequest<void>(`/api/v1/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
}
