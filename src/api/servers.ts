import { apiRequest, unwrapList, unwrapOne } from './client'

export type ServerStatus = 'Online' | 'Offline' | 'Unknown'
export type ServerSpecification = {
  hostname?: string
  architecture?: string
  kernel?: string
  cpuModel?: string
  cpuCores?: number
  memoryTotalBytes?: number
  diskTotalBytes?: number
  virtualization?: string
}
export type Server = {
  id: string; name: string; host: string; port: number; username: string
  authMethod: 'ssh_key' | 'password'
  environment: 'Production' | 'Staging' | 'Development'; status: ServerStatus
  region: string; operatingSystem: string; uptime: string; fingerprint: string
  latestSnapshot: null | { cpuPercent: number; memoryPercent: number; diskPercent: number; capturedAt: string }
  specification: ServerSpecification
  services: Array<{ name: string; status: string; detail: string }>
}

export type ServerDTO = {
  id: string; name: string; host: string; port: number; ssh_user: string
  auth_method: 'ssh_key' | 'password'
  environment: 'production' | 'staging' | 'development'; status: 'online' | 'offline' | 'unknown'
  region: string; operating_system?: string; uptime?: string; uptime_seconds?: number; host_fingerprint: string
  latest_snapshot?: { cpu_percent: number; memory_percent: number; disk_percent: number; captured_at?: string; checked_at?: string; services?: Array<{ name: string; status: string; detail?: string }>; details?: { hostname?: string; architecture?: string; kernel?: string; cpu_model?: string; cpu_cores?: number; memory_total_bytes?: number; disk_total_bytes?: number; virtualization?: string } } | null
  services?: Array<{ name: string; status: string; detail?: string }>
}

export type ServerSummaryDTO = { total: number; online: number; offline: number; unknown: number }
export type CreateServerDTO = { name: string; host: string; port: number; username: string; auth_method: 'ssh_key' | 'password'; password?: string; private_key?: string; host_fingerprint?: string; environment: string; region?: string }
export type ConnectionTestResult = { ok: boolean; message: string; authMethod?: 'ssh_key' | 'password'; latencyMs?: number }

export function formatUptime(seconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days) return `${days}d${hours ? ` ${hours}h` : minutes ? ` ${minutes}m` : ''}`
  if (hours) return `${hours}h${minutes ? ` ${minutes}m` : ''}`
  return `${minutes}m`
}

export function formatBytes(bytes: number): string {
  const terabyte = 1024 ** 4
  const unit = bytes >= terabyte ? terabyte : 1024 ** 3
  const value = Number((bytes / unit).toFixed(1))
  return `${value} ${bytes >= terabyte ? 'TB' : 'GB'}`
}

export function serverFromDTO(dto: ServerDTO): Server {
  const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
  const services = dto.latest_snapshot?.services ?? dto.services ?? []
  const details = dto.latest_snapshot?.details
  return { id: dto.id, name: dto.name, host: dto.host, port: dto.port, username: dto.ssh_user, authMethod: dto.auth_method || 'ssh_key', environment: title(dto.environment) as Server['environment'], status: title(dto.status) as ServerStatus, region: dto.region || '-', operatingSystem: dto.operating_system || '-', uptime: dto.uptime_seconds == null ? dto.uptime || '-' : formatUptime(dto.uptime_seconds), fingerprint: dto.host_fingerprint || '', latestSnapshot: dto.latest_snapshot ? { cpuPercent: dto.latest_snapshot.cpu_percent, memoryPercent: dto.latest_snapshot.memory_percent, diskPercent: dto.latest_snapshot.disk_percent, capturedAt: dto.latest_snapshot.captured_at || dto.latest_snapshot.checked_at || '' } : null, specification: details ? { hostname: details.hostname, architecture: details.architecture, kernel: details.kernel, cpuModel: details.cpu_model, cpuCores: details.cpu_cores, memoryTotalBytes: details.memory_total_bytes, diskTotalBytes: details.disk_total_bytes, virtualization: details.virtualization } : {}, services: services.map(service => ({ ...service, detail: service.detail || '' })) }
}

function serverInput(input: CreateServerDTO) {
  const { username, password, private_key, ...fields } = input
  const credential = input.auth_method === 'password' ? { password } : { private_key }
  return { ...fields, ...credential, ssh_user: username, region: input.region || '' }
}

function connectionResult(result: { success?: boolean; ok?: boolean; status?: string; error?: string; message?: string; auth_method?: 'ssh_key' | 'password'; latency_ms?: number }): ConnectionTestResult {
  const ok = result.success ?? result.ok ?? ['ok', 'online', 'success', 'verified'].includes(result.status || '')
  return { ok, message: result.error || result.message || (ok ? 'SSH connection successful' : 'SSH connection failed'), authMethod: result.auth_method, latencyMs: result.latency_ms }
}

export const serversApi = {
  async list() {
    const body = await apiRequest<ServerDTO[] | { servers: ServerDTO[]; summary?: ServerSummaryDTO }>('/api/v1/servers')
    return { servers: unwrapList<ServerDTO>(body, 'servers').map(serverFromDTO), summary: !Array.isArray(body) ? body.summary : undefined }
  },
  async get(id: string) { return serverFromDTO(unwrapOne<ServerDTO>(await apiRequest(`/api/v1/servers/${encodeURIComponent(id)}`), 'server')) },
  async create(input: CreateServerDTO) { return serverFromDTO(unwrapOne<ServerDTO>(await apiRequest('/api/v1/servers', { method: 'POST', body: JSON.stringify(serverInput(input)) }), 'server')) },
  async testDraft(input: CreateServerDTO) { return connectionResult(await apiRequest('/api/v1/servers/test-draft', { method: 'POST', body: JSON.stringify(serverInput(input)) })) },
  async testConnection(id: string) { return connectionResult(await apiRequest(`/api/v1/servers/${encodeURIComponent(id)}/test`, { method: 'POST' })) },
  async healthCheck(id: string) { await apiRequest(`/api/v1/servers/${encodeURIComponent(id)}/health-check`, { method: 'POST' }); return serversApi.get(id) },
  async remove(id: string) { return apiRequest<void>(`/api/v1/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }) },
}
