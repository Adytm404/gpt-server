import { apiRequest } from './client'

export type WorkspaceSettingsDTO = {
  id: string
  name: string
  slug: string
  default_region: string
  timezone: string
  log_density: string
  approval_required_default: boolean
  approval_timeout_minutes: number
  notify_failed_executions: boolean
  notify_completed_executions: boolean
  strict_host_key_checking: boolean
  key_rotation_days: number
  data_retention_days: number
  role: string
}

export type UpdateWorkspaceSettingsDTO = {
  name: string
  slug?: string
  default_region?: string
  timezone?: string
  log_density?: string
  approval_required_default?: boolean
  approval_timeout_minutes?: number
  notify_failed_executions?: boolean
  notify_completed_executions?: boolean
  strict_host_key_checking?: boolean
  key_rotation_days?: number
  data_retention_days?: number
}

export type UserProfileDTO = {
  id: string
  full_name: string
  display_name: string
  email: string
  job_title: string
  timezone: string
  command_output_density: string
  platform_role: string
  workspace_role: string
  created_at: string
}

export type UpdateUserProfileDTO = {
  full_name: string
  display_name?: string
  job_title?: string
  timezone?: string
  command_output_density?: string
}

export type WorkspaceSubscriptionDTO = {
  plan_id?: string
  plan_revision_id?: string
  plan_name: string
  slug: string
  price_cents: number
  annual_price_cents: number
  max_servers: number
  monthly_tokens: number
  used_tokens: number
  expires_at?: string
  has_active_plan: boolean
  role: string
}

export const settingsApi = {
  async getWorkspaceSubscription() {
    return apiRequest<WorkspaceSubscriptionDTO>('/api/v1/settings/subscription')
  },
  async cancelWorkspaceSubscription() {
    return apiRequest<{ success: boolean; message: string }>('/api/v1/settings/subscription/cancel', {
      method: 'POST',
    })
  },
  async getWorkspaceSettings() {
    return apiRequest<WorkspaceSettingsDTO>('/api/v1/settings/workspace')
  },
  async updateWorkspaceSettings(input: UpdateWorkspaceSettingsDTO) {
    return apiRequest<WorkspaceSettingsDTO>('/api/v1/settings/workspace', {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
  async getProfile() {
    return apiRequest<UserProfileDTO>('/api/v1/settings/profile')
  },
  async updateProfile(input: UpdateUserProfileDTO) {
    return apiRequest<UserProfileDTO>('/api/v1/settings/profile', {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
  async changePassword(currentPassword: string, newPassword: string) {
    return apiRequest<{ status: string }>('/api/v1/settings/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    })
  },
}
