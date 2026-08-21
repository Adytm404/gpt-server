import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  History,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  Terminal,
  UserRound,
  Zap,
} from 'lucide-react'
import { settingsApi, type UpdateWorkspaceSettingsDTO, type WorkspaceSettingsDTO, type UserProfileDTO, type UpdateUserProfileDTO } from '../api/settings'

const cn = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ')

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      className={cn('setting-toggle', checked && 'active')}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <i />
    </button>
  )
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <header>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <div>{children}</div>
    </section>
  )
}

function SettingRow({
  icon: Icon,
  title,
  description,
  control,
}: {
  icon: React.ComponentType<{ size?: number }>
  title: string
  description: string
  control: React.ReactNode
}) {
  return (
    <div className="setting-row">
      <i>
        <Icon size={16} />
      </i>
      <span>
        <b>{title}</b>
        <small>{description}</small>
      </span>
      <div>{control}</div>
    </div>
  )
}

export function SettingsPage() {
  const [tab, setTab] = useState('General')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<WorkspaceSettingsDTO | null>(null)

  // Form states
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [defaultRegion, setDefaultRegion] = useState('Singapore (SGP)')
  const [timezone, setTimezone] = useState('Asia/Jakarta')
  const [logDensity, setLogDensity] = useState('Comfortable')
  const [approvalRequired, setApprovalRequired] = useState(true)
  const [approvalTimeout, setApprovalTimeout] = useState(15)
  const [notifyFailure, setNotifyFailure] = useState(true)
  const [notifyComplete, setNotifyComplete] = useState(false)
  const [strictHostKey, setStrictHostKey] = useState(true)
  const [keyRotationDays, setKeyRotationDays] = useState(90)
  const [dataRetentionDays, setDataRetentionDays] = useState(90)

  useEffect(() => {
    settingsApi
      .getWorkspaceSettings()
      .then(res => {
        setSettings(res)
        setName(res.name)
        setSlug(res.slug || '')
        setDefaultRegion(res.default_region || 'Singapore (SGP)')
        setTimezone(res.timezone || 'Asia/Jakarta')
        setLogDensity(res.log_density || 'Comfortable')
        setApprovalRequired(res.approval_required_default)
        setApprovalTimeout(res.approval_timeout_minutes || 15)
        setNotifyFailure(res.notify_failed_executions)
        setNotifyComplete(res.notify_completed_executions)
        setStrictHostKey(res.strict_host_key_checking)
        setKeyRotationDays(res.key_rotation_days || 90)
        setDataRetentionDays(res.data_retention_days || 90)
      })
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Unable to load workspace settings'))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    if (!name.trim()) {
      setError('Workspace name is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload: UpdateWorkspaceSettingsDTO = {
        name: name.trim(),
        slug: slug.trim() || undefined,
        default_region: defaultRegion,
        timezone,
        log_density: logDensity,
        approval_required_default: approvalRequired,
        approval_timeout_minutes: approvalTimeout,
        notify_failed_executions: notifyFailure,
        notify_completed_executions: notifyComplete,
        strict_host_key_checking: strictHostKey,
        key_rotation_days: keyRotationDays,
        data_retention_days: dataRetentionDays,
      }
      const updated = await settingsApi.updateWorkspaceSettings(payload)
      setSettings(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="account-page page-enter">
        <p>Loading workspace settings...</p>
      </div>
    )
  }

  return (
    <div className="account-page page-enter">
      <div className="account-heading">
        <div>
          <span className="page-eyebrow">Workspace control</span>
          <h1>Settings</h1>
          <p>Configure how {settings?.name || 'Workspace'} connects, approves, and reports.</p>
        </div>
        <button className="button dark" onClick={save} disabled={saving}>
          {saved ? (
            <>
              <Check size={15} /> Saved
            </>
          ) : saving ? (
            'Saving...'
          ) : (
            'Save changes'
          )}
        </button>
      </div>

      {error && (
        <div className="auth-error" role="alert" style={{ marginBottom: 18 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      <div className="account-layout">
        <aside className="account-tabs">
          {['General', 'Execution', 'Notifications', 'Security'].map(item => (
            <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </aside>

        <section className="account-content">
          {tab === 'General' && (
            <>
              <SettingsSection title="Workspace" description="Identity and regional defaults for this operational workspace.">
                <div className="settings-form two">
                  <label>
                    <span>Workspace name</span>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Northstar Ops" />
                  </label>
                  <label>
                    <span>Default region</span>
                    <select value={defaultRegion} onChange={e => setDefaultRegion(e.target.value)}>
                      <option value="Singapore (SGP)">Singapore (SGP)</option>
                      <option value="Frankfurt (FRA)">Frankfurt (FRA)</option>
                      <option value="US East (IAD)">US East (IAD)</option>
                    </select>
                  </label>
                  <label className="wide">
                    <span>Workspace slug</span>
                    <div className="input-prefix">
                      <i>opsai.cloud/</i>
                      <input value={slug} onChange={e => setSlug(e.target.value)} placeholder="workspace-slug" />
                    </div>
                  </label>
                </div>
              </SettingsSection>
              <SettingsSection title="Interface" description="Set defaults for dates, logs, and operational output.">
                <div className="settings-form two">
                  <label>
                    <span>Timezone</span>
                    <select value={timezone} onChange={e => setTimezone(e.target.value)}>
                      <option value="Asia/Jakarta">Asia/Jakarta (UTC+7)</option>
                      <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                      <option value="UTC">UTC</option>
                      <option value="America/New_York">America/New_York (EST)</option>
                    </select>
                  </label>
                  <label>
                    <span>Log density</span>
                    <select value={logDensity} onChange={e => setLogDensity(e.target.value)}>
                      <option value="Comfortable">Comfortable</option>
                      <option value="Compact">Compact</option>
                    </select>
                  </label>
                </div>
              </SettingsSection>
            </>
          )}

          {tab === 'Execution' && (
            <>
              <SettingsSection title="Approval policy" description="Control when generated commands need human confirmation.">
                <SettingRow
                  icon={ShieldCheck}
                  title="Require approval"
                  description="Every execution plan waits for explicit approval before SSH commands run."
                  control={<Toggle checked={approvalRequired} onChange={setApprovalRequired} />}
                />
                <SettingRow
                  icon={Clock3}
                  title="Approval timeout"
                  description="Pending plans expire automatically after this period."
                  control={
                    <select value={approvalTimeout} onChange={e => setApprovalTimeout(Number(e.target.value))}>
                      <option value={15}>15 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={60}>1 hour</option>
                    </select>
                  }
                />
              </SettingsSection>
              <SettingsSection title="Command guardrails" description="Workspace-wide restrictions applied before execution.">
                <SettingRow
                  icon={Terminal}
                  title="Default mode"
                  description="Start every new operation in safe mode."
                  control={<span className="setting-badge">Safe Default</span>}
                />
                <SettingRow
                  icon={AlertTriangle}
                  title="Destructive guardrails"
                  description="System modifications require explicit policy approval."
                  control={<span className="setting-badge">12 Rules Active</span>}
                />
              </SettingsSection>
            </>
          )}

          {tab === 'Notifications' && (
            <>
              <SettingsSection title="Operational alerts" description="Choose which execution events reach your team.">
                <SettingRow
                  icon={AlertTriangle}
                  title="Failed executions"
                  description="Notify workspace members when an operation exits with an error."
                  control={<Toggle checked={notifyFailure} onChange={setNotifyFailure} />}
                />
                <SettingRow
                  icon={CheckCircle2}
                  title="Completed executions"
                  description="Notify when approved operations finish successfully."
                  control={<Toggle checked={notifyComplete} onChange={setNotifyComplete} />}
                />
              </SettingsSection>
              <SettingsSection title="Delivery channels" description="Configured notification integrations for workspace alerts.">
                <SettingRow
                  icon={Bell}
                  title="Email notifications"
                  description="Alerts sent to registered workspace member emails."
                  control={<span className="setting-badge">Enabled</span>}
                />
                <SettingRow
                  icon={Zap}
                  title="Webhook dispatch"
                  description="Forward lifecycle events to external endpoint."
                  control={<span className="setting-badge">Ready</span>}
                />
              </SettingsSection>
            </>
          )}

          {tab === 'Security' && (
            <>
              <SettingsSection title="SSH security" description="Policies used when servers establish trusted access.">
                <SettingRow
                  icon={ShieldCheck}
                  title="Strict host verification"
                  description="Reject connections when a known host fingerprint changes."
                  control={<Toggle checked={strictHostKey} onChange={setStrictHostKey} />}
                />
                <SettingRow
                  icon={KeyRound}
                  title="Key rotation policy"
                  description="Recommended interval for rotating server credentials."
                  control={
                    <select value={keyRotationDays} onChange={e => setKeyRotationDays(Number(e.target.value))}>
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                      <option value={180}>180 days</option>
                    </select>
                  }
                />
              </SettingsSection>
              <SettingsSection title="Data retention" description="Control operational evidence stored in this workspace.">
                <SettingRow
                  icon={History}
                  title="Execution history"
                  description="Plans, commands, and output retention window."
                  control={
                    <select value={dataRetentionDays} onChange={e => setDataRetentionDays(Number(e.target.value))}>
                      <option value={30}>30 days</option>
                      <option value={90}>90 days</option>
                      <option value={365}>1 year</option>
                    </select>
                  }
                />
              </SettingsSection>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export function ProfilePage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState<UserProfileDTO | null>(null)

  // Profile fields
  const [fullName, setFullName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [timezone, setTimezone] = useState('Asia/Jakarta')
  const [outputDensity, setOutputDensity] = useState('Detailed')

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  useEffect(() => {
    settingsApi
      .getProfile()
      .then(res => {
        setProfile(res)
        setFullName(res.full_name)
        setDisplayName(res.display_name || res.full_name)
        setJobTitle(res.job_title || '')
        setTimezone(res.timezone || 'Asia/Jakarta')
        setOutputDensity(res.command_output_density || 'Detailed')
      })
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Unable to load profile'))
      .finally(() => setLoading(false))
  }, [])

  const saveProfile = async () => {
    if (!fullName.trim()) {
      setError('Full name is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload: UpdateUserProfileDTO = {
        full_name: fullName.trim(),
        display_name: displayName.trim() || undefined,
        job_title: jobTitle.trim(),
        timezone,
        command_output_density: outputDensity,
      }
      const updated = await settingsApi.updateProfile(payload)
      setProfile(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save profile')
    } finally {
      setSaving(false)
    }
  }

  const changePassword = async () => {
    if (!currentPassword || !newPassword) {
      setPasswordError('Both current and new password are required')
      return
    }
    if (newPassword.length < 12) {
      setPasswordError('New password must be at least 12 characters')
      return
    }
    setPasswordSaving(true)
    setPasswordError('')
    try {
      await settingsApi.changePassword(currentPassword, newPassword)
      setPasswordSaved(true)
      setCurrentPassword('')
      setNewPassword('')
      setTimeout(() => setPasswordSaved(false), 3000)
    } catch (caught) {
      setPasswordError(caught instanceof Error ? caught.message : 'Unable to change password')
    } finally {
      setPasswordSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="account-page profile-page page-enter">
        <p>Loading profile...</p>
      </div>
    )
  }

  const initials =
    (fullName || 'Account')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join('') || 'AR'

  return (
    <div className="account-page profile-page page-enter">
      <div className="account-heading">
        <div>
          <span className="page-eyebrow">Personal account</span>
          <h1>Profile</h1>
          <p>Manage your identity and operational preferences.</p>
        </div>
        <button className="button dark" onClick={saveProfile} disabled={saving}>
          {saved ? (
            <>
              <Check size={15} /> Saved
            </>
          ) : saving ? (
            'Saving...'
          ) : (
            'Save profile'
          )}
        </button>
      </div>

      {error && (
        <div className="auth-error" role="alert" style={{ marginBottom: 18 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      <div className="profile-grid">
        <section className="profile-identity">
          <div className="profile-avatar">{initials}</div>
          <h2>{fullName || 'User'}</h2>
          <p>{jobTitle || 'Team Member'}</p>
          <span>
            <i /> Active now
          </span>
          <div className="profile-meta">
            <p>
              <small>WORKSPACE ROLE</small>
              <b>{profile?.workspace_role || 'Member'}</b>
            </p>
            <p>
              <small>PLATFORM ROLE</small>
              <b>{profile?.platform_role || 'User'}</b>
            </p>
            <p>
              <small>MEMBER SINCE</small>
              <b>{profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '-'}</b>
            </p>
          </div>
        </section>

        <div className="profile-main">
          <SettingsSection title="Personal information" description="Used in approvals, execution history, and team activity.">
            <div className="settings-form two">
              <label>
                <span>Full name</span>
                <input value={fullName} onChange={e => setFullName(e.target.value)} />
              </label>
              <label>
                <span>Display name</span>
                <input value={displayName} onChange={e => setDisplayName(e.target.value)} />
              </label>
              <label>
                <span>Email address</span>
                <input type="email" value={profile?.email || ''} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
              </label>
              <label>
                <span>Job title</span>
                <input value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="e.g. Platform Engineer" />
              </label>
            </div>
          </SettingsSection>

          <SettingsSection title="Preferences" description="Personal defaults applied only to your session.">
            <div className="settings-form two">
              <label>
                <span>Timezone</span>
                <select value={timezone} onChange={e => setTimezone(e.target.value)}>
                  <option value="Asia/Jakarta">Asia/Jakarta (UTC+7)</option>
                  <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                </select>
              </label>
              <label>
                <span>Command output</span>
                <select value={outputDensity} onChange={e => setOutputDensity(e.target.value)}>
                  <option value="Detailed">Detailed</option>
                  <option value="Condensed">Condensed</option>
                </select>
              </label>
            </div>
          </SettingsSection>

          <SettingsSection title="Account security" description="Update your login password.">
            <div className="settings-form two">
              <label>
                <span>Current password</span>
                <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
              </label>
              <label>
                <span>New password (min. 12 chars)</span>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              </label>
              {passwordError && (
                <div className="auth-error wide" role="alert" style={{ gridColumn: '1 / -1' }}>
                  <AlertTriangle size={14} /> {passwordError}
                </div>
              )}
              {passwordSaved && (
                <div className="trust-line" style={{ gridColumn: '1 / -1', color: 'var(--green)' }}>
                  <Check size={14} /> Password changed successfully.
                </div>
              )}
              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                <button className="button secondary compact" onClick={changePassword} disabled={passwordSaving}>
                  {passwordSaving ? 'Updating...' : 'Update password'}
                </button>
              </div>
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}
