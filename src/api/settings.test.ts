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

  it('fetches and cancels workspace subscription', async () => {
    const subDTO = { plan_name: 'Pro', slug: 'pro', price_cents: 50000, annual_price_cents: 40000, max_servers: 10, monthly_tokens: 500000, used_tokens: 12000, has_active_plan: true, role: 'owner' }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(subDTO), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, message: 'Cancelled' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(settingsApi.getWorkspaceSubscription()).resolves.toEqual(subDTO)
    await expect(settingsApi.cancelWorkspaceSubscription()).resolves.toEqual({ success: true, message: 'Cancelled' })
  })
})
