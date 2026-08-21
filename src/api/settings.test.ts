import { describe, expect, it, vi } from 'vitest'
import { settingsApi } from './settings'

describe('settingsApi', () => {
  it('requests workspace settings and updates profile', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/settings/workspace') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ name: 'Updated Workspace' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/settings/workspace')) {
        return new Response(JSON.stringify({ name: 'Current Workspace' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/settings/profile') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ full_name: 'New Name' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const current = await settingsApi.getWorkspaceSettings()
    expect(current.name).toBe('Current Workspace')

    const updated = await settingsApi.updateWorkspaceSettings({ name: 'Updated Workspace' })
    expect(updated.name).toBe('Updated Workspace')

    const profile = await settingsApi.updateProfile({ full_name: 'New Name' })
    expect(profile.full_name).toBe('New Name')

    fetchMock.mockRestore()
  })
})
