import { serverFromDTO } from './servers'

const base = { id: 'server-1', name: 'Server', host: 'host.test', port: 22, ssh_user: 'root', environment: 'production' as const, status: 'online' as const, region: '', host_fingerprint: '' }

it.each([
  ['captured_at', { captured_at: '2026-08-20T01:00:00Z' }],
  ['checked_at', { checked_at: '2026-08-20T02:00:00Z' }],
])('maps latest snapshot %s timestamp', (_, timestamp) => {
  const server = serverFromDTO({ ...base, latest_snapshot: { cpu_percent: 10, memory_percent: 20, disk_percent: 30, ...timestamp } })
  expect(server.latestSnapshot?.capturedAt).toBe(Object.values(timestamp)[0])
})
