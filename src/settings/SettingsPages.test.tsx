import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProfilePage, SettingsPage } from './SettingsPages'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const mockWorkspace = {
  id: 'w-1',
  name: 'Northstar Ops',
  slug: 'northstar-ops',
  default_region: 'Singapore (SGP)',
  timezone: 'Asia/Jakarta',
  log_density: 'Comfortable',
  approval_required_default: true,
  approval_timeout_minutes: 15,
  notify_failed_executions: true,
  notify_completed_executions: false,
  strict_host_key_checking: true,
  key_rotation_days: 90,
  data_retention_days: 90,
  role: 'owner',
}

const mockProfile = {
  id: 'u-1',
  full_name: 'Aria Rahman',
  display_name: 'Aria',
  email: 'arya@northstar.dev',
  job_title: 'Platform engineer',
  timezone: 'Asia/Jakarta',
  command_output_density: 'Detailed',
  platform_role: 'user',
  workspace_role: 'owner',
  created_at: '2026-08-21T10:00:00Z',
}

describe('Settings & Profile Pages', () => {
  it('loads and saves workspace settings', async () => {
    let updateBody: Record<string, unknown> | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/settings/workspace') && init?.method === 'PATCH') {
        updateBody = JSON.parse(String(init.body))
        return json({ ...mockWorkspace, ...updateBody })
      }
      if (url.endsWith('/settings/workspace')) {
        return json(mockWorkspace)
      }
      return json({ status: 'ok' })
    })

    render(<SettingsPage />)
    expect(await screen.findByDisplayValue('Northstar Ops')).toBeInTheDocument()

    const nameInput = screen.getByDisplayValue('Northstar Ops')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Renamed Ops')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateBody).toMatchObject({ name: 'Renamed Ops' }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('loads and updates user profile and handles password change', async () => {
    let profileUpdate: Record<string, unknown> | null = null
    let passwordChange: Record<string, unknown> | null = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/settings/profile') && init?.method === 'PATCH') {
        profileUpdate = JSON.parse(String(init.body))
        return json({ ...mockProfile, ...profileUpdate })
      }
      if (url.endsWith('/settings/profile')) {
        return json(mockProfile)
      }
      if (url.endsWith('/settings/change-password') && init?.method === 'POST') {
        passwordChange = JSON.parse(String(init.body))
        return json({ status: 'password updated' })
      }
      return json({ status: 'ok' })
    })

    render(<ProfilePage />)
    expect(await screen.findByDisplayValue('Aria Rahman')).toBeInTheDocument()
    expect(screen.getByDisplayValue('arya@northstar.dev')).toBeDisabled()

    const titleInput = screen.getByDisplayValue('Platform engineer')
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, 'Principal SRE')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(profileUpdate).toMatchObject({ job_title: 'Principal SRE' }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })
})
