import { serverFromDTO, serversApi, type CreateServerDTO } from './servers'

const base = { id: 'server-1', name: 'Server', host: 'host.test', port: 22, ssh_user: 'root', auth_method: 'ssh_key' as const, environment: 'production' as const, status: 'online' as const, region: '', host_fingerprint: '' }

afterEach(() => vi.restoreAllMocks())

it.each([
  ['captured_at', { captured_at: '2026-08-20T01:00:00Z' }],
  ['checked_at', { checked_at: '2026-08-20T02:00:00Z' }],
])('maps latest snapshot %s timestamp', (_, timestamp) => {
  const server = serverFromDTO({ ...base, latest_snapshot: { cpu_percent: 10, memory_percent: 20, disk_percent: 30, ...timestamp } })
  expect(server.latestSnapshot?.capturedAt).toBe(Object.values(timestamp)[0])
})

it.each([
  [174600, '2d 30m'],
  [174600 + (12 * 60 * 60), '2d 12h'],
  [7500, '2h 5m'],
  [2700, '45m'],
])('formats %i uptime seconds as %s', (uptimeSeconds, expected) => {
  expect(serverFromDTO({ ...base, uptime_seconds: uptimeSeconds }).uptime).toBe(expected)
})

it('maps services from latest snapshot with top-level fallback', () => {
  const snapshotServices = [{ name: 'nginx', status: 'running' }]
  const topLevelServices = [{ name: 'postgres', status: 'running', detail: 'primary' }]

  expect(serverFromDTO({ ...base, latest_snapshot: { cpu_percent: 1, memory_percent: 2, disk_percent: 3, services: snapshotServices }, services: topLevelServices }).services)
    .toEqual([{ ...snapshotServices[0], detail: '' }])
  expect(serverFromDTO({ ...base, services: topLevelServices }).services).toEqual(topLevelServices)
})

it.each([
  { auth_method: 'ssh_key' as const, credentials: { private_key: 'secret-key', password: 'discard-me' }, included: 'private_key' as const, excluded: 'password' as const },
  { auth_method: 'password' as const, credentials: { password: 'secret-password', private_key: 'discard-me' }, included: 'password' as const, excluded: 'private_key' as const },
])('sends only selected $auth_method credential when testing a draft', async ({ auth_method, credentials, included, excluded }) => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true, auth_method, latency_ms: 18 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  await serversApi.testDraft({ name: 'Server', host: 'host.test', port: 22, username: 'root', environment: 'production', auth_method, ...credentials } as CreateServerDTO)

  const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
  expect(body).toMatchObject({ auth_method, ssh_user: 'root', [included]: credentials[included] })
  expect(body).not.toHaveProperty(excluded)
})
