package main

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type workspaceSettingsResponse struct {
	ID                         string `json:"id"`
	Name                       string `json:"name"`
	Slug                       string `json:"slug"`
	DefaultRegion              string `json:"default_region"`
	Timezone                   string `json:"timezone"`
	LogDensity                 string `json:"log_density"`
	ApprovalRequiredDefault    bool   `json:"approval_required_default"`
	ApprovalTimeoutMinutes     int    `json:"approval_timeout_minutes"`
	NotifyFailedExecutions     bool   `json:"notify_failed_executions"`
	NotifyCompletedExecutions  bool   `json:"notify_completed_executions"`
	StrictHostKeyChecking      bool   `json:"strict_host_key_checking"`
	KeyRotationDays            int    `json:"key_rotation_days"`
	DataRetentionDays          int    `json:"data_retention_days"`
	Role                       string `json:"role"`
}

type updateWorkspaceSettingsInput struct {
	Name                      string `json:"name"`
	Slug                      string `json:"slug"`
	DefaultRegion             string `json:"default_region"`
	Timezone                  string `json:"timezone"`
	LogDensity                string `json:"log_density"`
	ApprovalRequiredDefault   *bool  `json:"approval_required_default"`
	ApprovalTimeoutMinutes    *int   `json:"approval_timeout_minutes"`
	NotifyFailedExecutions    *bool  `json:"notify_failed_executions"`
	NotifyCompletedExecutions *bool  `json:"notify_completed_executions"`
	StrictHostKeyChecking     *bool  `json:"strict_host_key_checking"`
	KeyRotationDays           *int   `json:"key_rotation_days"`
	DataRetentionDays         *int   `json:"data_retention_days"`
}

type userProfileResponse struct {
	ID                   string `json:"id"`
	FullName             string `json:"full_name"`
	DisplayName          string `json:"display_name"`
	Email                string `json:"email"`
	JobTitle             string `json:"job_title"`
	Timezone             string `json:"timezone"`
	CommandOutputDensity string `json:"command_output_density"`
	PlatformRole         string `json:"platform_role"`
	WorkspaceRole        string `json:"workspace_role"`
	CreatedAt            string `json:"created_at"`
}

type updateUserProfileInput struct {
	FullName             string `json:"full_name"`
	DisplayName          string `json:"display_name"`
	JobTitle             string `json:"job_title"`
	Timezone             string `json:"timezone"`
	CommandOutputDensity string `json:"command_output_density"`
}

type changePasswordInput struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (s *server) settingsRoutes(r chi.Router) {
	r.Get("/workspace", s.getWorkspaceSettings)
	r.With(s.requireMutation).Patch("/workspace", s.requireWorkspaceAction("settings", s.updateWorkspaceSettings))
	r.Get("/subscription", s.getWorkspaceSubscription)
	r.With(s.requireMutation).Post("/subscription/cancel", s.requireWorkspaceAction("settings", s.cancelWorkspaceSubscription))
	r.Get("/profile", s.getUserProfile)
	r.With(s.requireMutation).Patch("/profile", s.updateUserProfile)
	r.With(s.requireMutation).Post("/change-password", s.changePassword)
}

func (s *server) getWorkspaceSettings(w http.ResponseWriter, r *http.Request) {
	auth := authFrom(r.Context())
	var out workspaceSettingsResponse
	err := s.db.QueryRow(r.Context(), `
SELECT w.id, w.name, COALESCE(w.slug, ''), w.default_region, w.timezone, w.log_density,
       w.approval_required_default, w.approval_timeout_minutes, w.notify_failed_executions,
       w.notify_completed_executions, w.strict_host_key_checking, w.key_rotation_days, w.data_retention_days,
       wm.role
FROM workspaces w
JOIN workspace_memberships wm ON wm.workspace_id = w.id AND wm.user_id = $1
WHERE w.id = $2`, auth.UserID, auth.WorkspaceID).Scan(
		&out.ID, &out.Name, &out.Slug, &out.DefaultRegion, &out.Timezone, &out.LogDensity,
		&out.ApprovalRequiredDefault, &out.ApprovalTimeoutMinutes, &out.NotifyFailedExecutions,
		&out.NotifyCompletedExecutions, &out.StrictHostKeyChecking, &out.KeyRotationDays, &out.DataRetentionDays,
		&out.Role,
	)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *server) updateWorkspaceSettings(w http.ResponseWriter, r *http.Request) {
	auth := authFrom(r.Context())
	var in updateWorkspaceSettingsInput
	if err := decodeJSON(r, &in); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len(in.Name) > 200 {
		s.writeError(w, r, http.StatusBadRequest, "workspace name must be 1-200 characters")
		return
	}

	slug := strings.ToLower(strings.TrimSpace(in.Slug))
	if slug != "" && (len(slug) > 100 || !slugPattern.MatchString(slug)) {
		s.writeError(w, r, http.StatusBadRequest, "invalid workspace slug")
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())

	var out workspaceSettingsResponse
	err = tx.QueryRow(r.Context(), `
UPDATE workspaces SET
  name = $2,
  slug = $3,
  default_region = COALESCE(NULLIF($4, ''), default_region),
  timezone = COALESCE(NULLIF($5, ''), timezone),
  log_density = COALESCE(NULLIF($6, ''), log_density),
  approval_required_default = COALESCE($7, approval_required_default),
  approval_timeout_minutes = COALESCE($8, approval_timeout_minutes),
  notify_failed_executions = COALESCE($9, notify_failed_executions),
  notify_completed_executions = COALESCE($10, notify_completed_executions),
  strict_host_key_checking = COALESCE($11, strict_host_key_checking),
  key_rotation_days = COALESCE($12, key_rotation_days),
  data_retention_days = COALESCE($13, data_retention_days),
  updated_at = now()
WHERE id = $1
RETURNING id, name, COALESCE(slug, ''), default_region, timezone, log_density,
          approval_required_default, approval_timeout_minutes, notify_failed_executions,
          notify_completed_executions, strict_host_key_checking, key_rotation_days, data_retention_days`,
		auth.WorkspaceID, in.Name, slug, in.DefaultRegion, in.Timezone, in.LogDensity,
		in.ApprovalRequiredDefault, in.ApprovalTimeoutMinutes, in.NotifyFailedExecutions,
		in.NotifyCompletedExecutions, in.StrictHostKeyChecking, in.KeyRotationDays, in.DataRetentionDays,
	).Scan(
		&out.ID, &out.Name, &out.Slug, &out.DefaultRegion, &out.Timezone, &out.LogDensity,
		&out.ApprovalRequiredDefault, &out.ApprovalTimeoutMinutes, &out.NotifyFailedExecutions,
		&out.NotifyCompletedExecutions, &out.StrictHostKeyChecking, &out.KeyRotationDays, &out.DataRetentionDays,
	)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	out.Role = auth.WorkspaceRole

	_ = insertAudit(r.Context(), tx, auth.UserID, "workspace", "Updated workspace settings", auth.WorkspaceID, out.Name, nil)

	if err = tx.Commit(r.Context()); err != nil {
		s.dbError(w, r, err)
		return
	}

	s.writeJSON(w, http.StatusOK, out)
}

func (s *server) getUserProfile(w http.ResponseWriter, r *http.Request) {
	auth := authFrom(r.Context())
	var out userProfileResponse
	err := s.db.QueryRow(r.Context(), `
SELECT u.id, u.full_name, COALESCE(u.display_name, ''), u.email, COALESCE(u.job_title, ''),
       COALESCE(u.timezone, 'Asia/Jakarta'), COALESCE(u.command_output_density, 'Detailed'),
       u.platform_role, wm.role, u.created_at::text
FROM users u
JOIN workspace_memberships wm ON wm.user_id = u.id AND wm.workspace_id = $2
WHERE u.id = $1`, auth.UserID, auth.WorkspaceID).Scan(
		&out.ID, &out.FullName, &out.DisplayName, &out.Email, &out.JobTitle,
		&out.Timezone, &out.CommandOutputDensity,
		&out.PlatformRole, &out.WorkspaceRole, &out.CreatedAt,
	)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *server) updateUserProfile(w http.ResponseWriter, r *http.Request) {
	auth := authFrom(r.Context())
	var in updateUserProfileInput
	if err := decodeJSON(r, &in); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	in.FullName = strings.TrimSpace(in.FullName)
	if in.FullName == "" || len(in.FullName) > 200 {
		s.writeError(w, r, http.StatusBadRequest, "full name must be 1-200 characters")
		return
	}
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	if len(in.DisplayName) > 100 {
		s.writeError(w, r, http.StatusBadRequest, "display name must be under 100 characters")
		return
	}
	if in.DisplayName == "" {
		in.DisplayName = in.FullName
	}

	var out userProfileResponse
	err := s.db.QueryRow(r.Context(), `
UPDATE users SET
  full_name = $2,
  display_name = $3,
  job_title = $4,
  timezone = COALESCE(NULLIF($5, ''), timezone),
  command_output_density = COALESCE(NULLIF($6, ''), command_output_density),
  updated_at = now()
WHERE id = $1
RETURNING id, full_name, display_name, email, job_title, timezone, command_output_density, platform_role, created_at::text`,
		auth.UserID, in.FullName, in.DisplayName, strings.TrimSpace(in.JobTitle), in.Timezone, in.CommandOutputDensity,
	).Scan(
		&out.ID, &out.FullName, &out.DisplayName, &out.Email, &out.JobTitle,
		&out.Timezone, &out.CommandOutputDensity, &out.PlatformRole, &out.CreatedAt,
	)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	out.WorkspaceRole = auth.WorkspaceRole

	s.writeJSON(w, http.StatusOK, out)
}

func (s *server) changePassword(w http.ResponseWriter, r *http.Request) {
	auth := authFrom(r.Context())
	var in changePasswordInput
	if err := decodeJSON(r, &in); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(in.NewPassword) < 12 || len(in.NewPassword) > 1024 {
		s.writeError(w, r, http.StatusBadRequest, "new password must be at least 12 characters")
		return
	}

	var currentHash string
	err := s.db.QueryRow(r.Context(), `SELECT password_hash FROM users WHERE id = $1`, auth.UserID).Scan(&currentHash)
	if err != nil {
		s.dbError(w, r, err)
		return
	}

	if !verifyPassword(in.CurrentPassword, currentHash) {
		s.writeError(w, r, http.StatusUnprocessableEntity, "current password is incorrect")
		return
	}

	newHash, err := hashPassword(in.NewPassword)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "internal error")
		return
	}

	_, err = s.db.Exec(r.Context(), `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, auth.UserID, newHash)
	if err != nil {
		s.dbError(w, r, err)
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]string{"status": "password updated"})
}

type workspaceSubscriptionResponse struct {
	PlanID           *uuid.UUID `json:"plan_id,omitempty"`
	PlanRevisionID   *uuid.UUID `json:"plan_revision_id,omitempty"`
	PlanName         string     `json:"plan_name"`
	Slug             string     `json:"slug"`
	PriceCents       int        `json:"price_cents"`
	AnnualPriceCents int        `json:"annual_price_cents"`
	MaxServers       int        `json:"max_servers"`
	MonthlyTokens    int64      `json:"monthly_tokens"`
	UsedTokens       int64      `json:"used_tokens"`
	ExpiresAt        *string    `json:"expires_at,omitempty"`
	HasActivePlan    bool       `json:"has_active_plan"`
	Role             string     `json:"role"`
}

func (s *server) getWorkspaceSubscription(w http.ResponseWriter, r *http.Request) {
	auth := authFrom(r.Context())
	var out workspaceSubscriptionResponse
	out.Role = auth.WorkspaceRole

	var expiresAt *time.Time
	err := s.db.QueryRow(r.Context(), `
SELECT p.plan_id, p.id, p.name, p.slug, p.price_cents, p.annual_price_cents, p.max_servers,
       COALESCE(ws.monthly_token_limit, p.monthly_tokens, 0),
       ws.expires_at,
       COALESCE((SELECT sum(total_tokens) FROM token_usage WHERE workspace_id = $1 AND period_start = date_trunc('month', now())::date), 0)
FROM workspace_subscriptions ws
JOIN subscription_plan_revisions p ON p.id = ws.plan_revision_id
WHERE ws.workspace_id = $1`, auth.WorkspaceID).Scan(
		&out.PlanID, &out.PlanRevisionID, &out.PlanName, &out.Slug, &out.PriceCents, &out.AnnualPriceCents,
		&out.MaxServers, &out.MonthlyTokens, &expiresAt, &out.UsedTokens,
	)

	if err != nil {
		// If no active paid plan revision
		var defaultLimit int64
		_ = s.db.QueryRow(r.Context(), `
SELECT COALESCE(ws.monthly_token_limit, 0),
       COALESCE((SELECT sum(total_tokens) FROM token_usage WHERE workspace_id = $1 AND period_start = date_trunc('month', now())::date), 0)
FROM workspace_subscriptions ws
WHERE ws.workspace_id = $1`, auth.WorkspaceID).Scan(&defaultLimit, &out.UsedTokens)

		out.PlanName = "Free / Starter"
		out.Slug = "free"
		out.MonthlyTokens = defaultLimit
		out.MaxServers = 3
		out.HasActivePlan = false
		s.writeJSON(w, http.StatusOK, out)
		return
	}

	out.HasActivePlan = true
	if expiresAt != nil {
		expStr := expiresAt.Format(time.RFC3339)
		out.ExpiresAt = &expStr
	}

	s.writeJSON(w, http.StatusOK, out)
}

func (s *server) cancelWorkspaceSubscription(w http.ResponseWriter, r *http.Request) {
	auth := authFrom(r.Context())
	if auth.WorkspaceRole != "owner" {
		s.writeError(w, r, http.StatusForbidden, "only workspace owners can cancel subscriptions")
		return
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())

	_, err = tx.Exec(r.Context(), `
UPDATE workspace_subscriptions
SET plan_revision_id = NULL, expires_at = NULL, updated_at = now()
WHERE workspace_id = $1`, auth.WorkspaceID)
	if err != nil {
		s.dbError(w, r, err)
		return
	}

	_ = insertAudit(r.Context(), tx, auth.UserID, "billing", "Cancelled workspace subscription plan", auth.WorkspaceID, "subscription", nil)

	if err = tx.Commit(r.Context()); err != nil {
		s.dbError(w, r, err)
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Subscription plan cancelled successfully"})
}
