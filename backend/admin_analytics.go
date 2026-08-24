package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type adminUserItem struct {
	ID             uuid.UUID  `json:"id"`
	FullName       string     `json:"full_name"`
	Email          string     `json:"email"`
	PlatformRole   string     `json:"platform_role"`
	EmailVerified  bool       `json:"email_verified"`
	IsSuspended    bool       `json:"is_suspended"`
	SuspensionNote string     `json:"suspension_note"`
	WorkspaceID    *uuid.UUID `json:"workspace_id,omitempty"`
	WorkspaceName  string     `json:"workspace_name"`
	WorkspaceRole  string     `json:"workspace_role"`
	PlanID         *uuid.UUID `json:"plan_id,omitempty"`
	PlanName       string     `json:"plan_name"`
	PlanExpiresAt  *string    `json:"plan_expires_at,omitempty"`
	CreatedAt      string     `json:"created_at"`
}

type adminUsersResponse struct {
	TotalUsers     int             `json:"total_users"`
	VerifiedUsers  int             `json:"verified_users"`
	SuspendedUsers int             `json:"suspended_users"`
	AdminUsers     int             `json:"admin_users"`
	Users          []adminUserItem `json:"users"`
}

type updateAdminUserInput struct {
	FullName         string  `json:"full_name"`
	PlatformRole     string  `json:"platform_role"`
	EmailVerified    bool    `json:"email_verified"`
	IsSuspended      bool    `json:"is_suspended"`
	SuspensionNote   string  `json:"suspension_note"`
	PlanID           *string `json:"plan_id,omitempty"`
	PlanDurationDays int     `json:"plan_duration_days,omitempty"`
}

type adminTransactionItem struct {
	ID              uuid.UUID `json:"id"`
	MerchantOrderID string    `json:"merchant_order_id"`
	DuitkuReference string    `json:"duitku_reference"`
	WorkspaceName   string    `json:"workspace_name"`
	UserEmail       string    `json:"user_email"`
	UserName        string    `json:"user_name"`
	PlanName        string    `json:"plan_name"`
	BillingPeriod   string    `json:"billing_period"`
	AmountIDR       int64     `json:"amount_idr"`
	Status          string    `json:"status"`
	PaymentMethod   string    `json:"payment_method"`
	PaidAt          *string   `json:"paid_at,omitempty"`
	CreatedAt       string    `json:"created_at"`
}

type adminTransactionsResponse struct {
	TotalRevenueIDR   int64                  `json:"total_revenue_idr"`
	MonthlyRevenueIDR int64                  `json:"monthly_revenue_idr"`
	TodayRevenueIDR   int64                  `json:"today_revenue_idr"`
	TotalOrders       int                    `json:"total_orders"`
	PaidOrders        int                    `json:"paid_orders"`
	PendingOrders     int                    `json:"pending_orders"`
	FailedOrders      int                    `json:"failed_orders"`
	Transactions      []adminTransactionItem `json:"transactions"`
}

type cronSettingsResponse struct {
	IntervalMinutes int    `json:"interval_minutes"`
	LastRunAt       string `json:"last_run_at,omitempty"`
	UpdatedAt       string `json:"updated_at,omitempty"`
}

type updateCronSettingsInput struct {
	IntervalMinutes int `json:"interval_minutes"`
}

func (s *server) listAdminUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
SELECT u.id, u.full_name, u.email, u.platform_role, COALESCE(u.email_verified, true),
       COALESCE(u.is_suspended, false), COALESCE(u.suspension_note, ''),
       w.id, COALESCE(w.name, ''), COALESCE(wm.role, ''),
       p.plan_id, COALESCE(p.name, 'Free / Default'), ws.expires_at, u.created_at
FROM users u
LEFT JOIN workspace_memberships wm ON wm.user_id = u.id
LEFT JOIN workspaces w ON w.id = wm.workspace_id
LEFT JOIN workspace_subscriptions ws ON ws.workspace_id = w.id
LEFT JOIN subscription_plan_revisions p ON p.id = ws.plan_revision_id
ORDER BY u.created_at DESC`)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer rows.Close()

	var users []adminUserItem
	totalUsers := 0
	verifiedUsers := 0
	suspendedUsers := 0
	adminUsers := 0

	for rows.Next() {
		var u adminUserItem
		var created time.Time
		var planExpiresAt *time.Time
		if err := rows.Scan(&u.ID, &u.FullName, &u.Email, &u.PlatformRole, &u.EmailVerified, &u.IsSuspended, &u.SuspensionNote, &u.WorkspaceID, &u.WorkspaceName, &u.WorkspaceRole, &u.PlanID, &u.PlanName, &planExpiresAt, &created); err != nil {
			s.dbError(w, r, err)
			return
		}
		u.CreatedAt = created.Format(time.RFC3339)
		if planExpiresAt != nil {
			expStr := planExpiresAt.Format(time.RFC3339)
			u.PlanExpiresAt = &expStr
		}
		users = append(users, u)

		totalUsers++
		if u.EmailVerified {
			verifiedUsers++
		}
		if u.IsSuspended {
			suspendedUsers++
		}
		if u.PlatformRole == "admin" {
			adminUsers++
		}
	}

	s.writeJSON(w, http.StatusOK, adminUsersResponse{
		TotalUsers:     totalUsers,
		VerifiedUsers:  verifiedUsers,
		SuspendedUsers: suspendedUsers,
		AdminUsers:     adminUsers,
		Users:          users,
	})
}

func (s *server) updateAdminUser(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}

	var in updateAdminUserInput
	if err := decodeJSON(r, &in); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid request payload")
		return
	}

	in.FullName = strings.TrimSpace(in.FullName)
	in.PlatformRole = strings.ToLower(strings.TrimSpace(in.PlatformRole))
	if in.PlatformRole != "admin" {
		in.PlatformRole = "user"
	}
	in.SuspensionNote = strings.TrimSpace(in.SuspensionNote)

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())

	_, err = tx.Exec(r.Context(), `
UPDATE users
SET full_name = COALESCE(NULLIF($2,''), full_name),
    platform_role = $3,
    email_verified = $4,
    is_suspended = $5,
    suspension_note = $6,
    updated_at = now()
WHERE id = $1`, id, in.FullName, in.PlatformRole, in.EmailVerified, in.IsSuspended, in.SuspensionNote)
	if err != nil {
		s.dbError(w, r, err)
		return
	}

	// Allocate Plan manually if specified
	if in.PlanID != nil && strings.TrimSpace(*in.PlanID) != "" {
		planUUID, parseErr := uuid.Parse(strings.TrimSpace(*in.PlanID))
		if parseErr == nil {
			var planRevisionID uuid.UUID
			var monthlyTokens int64
			var defaultModelID uuid.UUID
			planErr := tx.QueryRow(r.Context(), `
SELECT id, monthly_tokens, default_model_id
FROM subscription_plan_revisions
WHERE plan_id = $1 AND status = 'published'
ORDER BY revision DESC LIMIT 1`, planUUID).Scan(&planRevisionID, &monthlyTokens, &defaultModelID)

			if planErr == nil {
				var workspaceID uuid.UUID
				_ = tx.QueryRow(r.Context(), `
SELECT workspace_id FROM workspace_memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1`, id).Scan(&workspaceID)

				if workspaceID != uuid.Nil {
					var expiresAt *time.Time
					if in.PlanDurationDays > 0 {
						exp := time.Now().Add(time.Duration(in.PlanDurationDays) * 24 * time.Hour)
						expiresAt = &exp
					}

					_, _ = tx.Exec(r.Context(), `
INSERT INTO workspace_subscriptions (workspace_id, plan_revision_id, default_model_id, monthly_token_limit, expires_at, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (workspace_id) DO UPDATE SET
  plan_revision_id = EXCLUDED.plan_revision_id,
  default_model_id = EXCLUDED.default_model_id,
  monthly_token_limit = EXCLUDED.monthly_token_limit,
  expires_at = EXCLUDED.expires_at,
  updated_at = now()`, workspaceID, planRevisionID, defaultModelID, monthlyTokens, expiresAt)
				}
			}
		}
	}

	_ = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "user", fmt.Sprintf("Updated user %s (suspended=%v)", id, in.IsSuspended), id, in.FullName, nil)

	if err = tx.Commit(r.Context()); err != nil {
		s.dbError(w, r, err)
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "User updated successfully"})
}

func (s *server) listAdminTransactions(w http.ResponseWriter, r *http.Request) {
	var totalRevenue, monthlyRevenue, todayRevenue int64
	var totalOrders, paidOrders, pendingOrders, failedOrders int

	_ = s.db.QueryRow(r.Context(), `
SELECT
  COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_idr ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN status = 'paid' AND created_at >= date_trunc('month', now()) THEN amount_idr ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN status = 'paid' AND created_at >= date_trunc('day', now()) THEN amount_idr ELSE 0 END), 0),
  COUNT(*),
  COUNT(CASE WHEN status = 'paid' THEN 1 END),
  COUNT(CASE WHEN status = 'pending' THEN 1 END),
  COUNT(CASE WHEN status IN ('failed', 'expired', 'cancelled', 'canceled') THEN 1 END)
FROM workspace_orders`).Scan(&totalRevenue, &monthlyRevenue, &todayRevenue, &totalOrders, &paidOrders, &pendingOrders, &failedOrders)

	rows, err := s.db.Query(r.Context(), `
SELECT o.id, o.merchant_order_id, o.duitku_reference, COALESCE(w.name, 'Workspace'),
       u.email, u.full_name, p.name, o.billing_period, o.amount_idr, o.status,
       o.payment_method, o.paid_at, o.created_at
FROM workspace_orders o
JOIN workspaces w ON w.id = o.workspace_id
JOIN users u ON u.id = o.user_id
JOIN subscription_plan_revisions p ON p.id = o.plan_revision_id
ORDER BY o.created_at DESC
LIMIT 200`)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer rows.Close()

	var transactions []adminTransactionItem
	for rows.Next() {
		var t adminTransactionItem
		var created time.Time
		var paid *time.Time
		if err := rows.Scan(&t.ID, &t.MerchantOrderID, &t.DuitkuReference, &t.WorkspaceName, &t.UserEmail, &t.UserName, &t.PlanName, &t.BillingPeriod, &t.AmountIDR, &t.Status, &t.PaymentMethod, &paid, &created); err != nil {
			s.dbError(w, r, err)
			return
		}
		t.CreatedAt = created.Format(time.RFC3339)
		if paid != nil {
			paidStr := paid.Format(time.RFC3339)
			t.PaidAt = &paidStr
		}
		transactions = append(transactions, t)
	}

	s.writeJSON(w, http.StatusOK, adminTransactionsResponse{
		TotalRevenueIDR:   totalRevenue,
		MonthlyRevenueIDR: monthlyRevenue,
		TodayRevenueIDR:   todayRevenue,
		TotalOrders:       totalOrders,
		PaidOrders:        paidOrders,
		PendingOrders:     pendingOrders,
		FailedOrders:      failedOrders,
		Transactions:      transactions,
	})
}

func (s *server) getAdminCronSettings(w http.ResponseWriter, r *http.Request) {
	var interval int
	var updated time.Time
	err := s.db.QueryRow(r.Context(), `SELECT cron_interval_minutes, updated_at FROM platform_system_settings WHERE id = 'default'`).Scan(&interval, &updated)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.writeJSON(w, http.StatusOK, cronSettingsResponse{IntervalMinutes: 5})
			return
		}
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, cronSettingsResponse{
		IntervalMinutes: interval,
		UpdatedAt:       updated.Format(time.RFC3339),
	})
}

func (s *server) setAdminCronSettings(w http.ResponseWriter, r *http.Request) {
	var in updateCronSettingsInput
	if err := decodeJSON(r, &in); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid request payload")
		return
	}
	if in.IntervalMinutes < 1 || in.IntervalMinutes > 1440 {
		in.IntervalMinutes = 5
	}

	_, err := s.db.Exec(r.Context(), `
INSERT INTO platform_system_settings (id, cron_interval_minutes, updated_at)
VALUES ('default', $1, now())
ON CONFLICT (id) DO UPDATE SET
  cron_interval_minutes = EXCLUDED.cron_interval_minutes,
  updated_at = now()`, in.IntervalMinutes)
	if err != nil {
		s.dbError(w, r, err)
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]any{"success": true, "interval_minutes": in.IntervalMinutes})
}

func (s *server) startGlobalCronWorker(ctx context.Context) {
	go func() {
		// Initial startup run after 8 seconds
		select {
		case <-ctx.Done():
			return
		case <-time.After(8 * time.Second):
			s.runCronJobTasks(ctx)
		}

		for {
			interval := 5 * time.Minute
			if s.db != nil {
				var mins int
				if err := s.db.QueryRow(ctx, `SELECT cron_interval_minutes FROM platform_system_settings WHERE id='default'`).Scan(&mins); err == nil && mins > 0 {
					interval = time.Duration(mins) * time.Minute
				}
			}

			select {
			case <-ctx.Done():
				return
			case <-time.After(interval):
				s.runCronJobTasks(ctx)
			}
		}
	}()
}

func (s *server) runCronJobTasks(ctx context.Context) {
	if s == nil || s.db == nil {
		return
	}

	// 1. Auto-cancel pending orders older than 60 minutes
	_, _ = s.db.Exec(ctx, `
UPDATE workspace_orders
SET status = 'cancelled', updated_at = now()
WHERE status = 'pending' AND created_at < now() - interval '60 minutes'`)

	// 2. Check pending Duitku transactions created within the last 60 minutes
	settings, apiKey, err := s.loadDuitkuSettings(ctx)
	if err == nil && settings.MerchantCode != "" && apiKey != "" {
		rows, qErr := s.db.Query(ctx, `
SELECT id, workspace_id, plan_revision_id, merchant_order_id
FROM workspace_orders
WHERE status = 'pending' AND created_at >= now() - interval '60 minutes'
LIMIT 50`)
		if qErr == nil {
			type pendingOrder struct {
				ID, WorkspaceID, PlanRevID uuid.UUID
				MerchantOrderID            string
			}
			var pendingList []pendingOrder
			for rows.Next() {
				var p pendingOrder
				if err := rows.Scan(&p.ID, &p.WorkspaceID, &p.PlanRevID, &p.MerchantOrderID); err == nil {
					pendingList = append(pendingList, p)
				}
			}
			rows.Close()

			for _, p := range pendingList {
				if ctx.Err() != nil {
					return
				}
				status, isPaid := s.checkDuitkuTransactionStatus(ctx, settings, apiKey, p.MerchantOrderID)
				if isPaid {
					now := time.Now().UTC()
					tx, txErr := s.db.Begin(ctx)
					if txErr == nil {
						_, _ = tx.Exec(ctx, `UPDATE workspace_orders SET status = 'paid', paid_at = $2, updated_at = $2 WHERE id = $1`, p.ID, now)
						var monthlyTokens int64
						var defaultModelID uuid.UUID
						if scanErr := tx.QueryRow(ctx, `SELECT monthly_tokens, default_model_id FROM subscription_plan_revisions WHERE id = $1`, p.PlanRevID).Scan(&monthlyTokens, &defaultModelID); scanErr == nil {
							_, _ = tx.Exec(ctx, `
INSERT INTO workspace_subscriptions (workspace_id, plan_revision_id, default_model_id, monthly_token_limit, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (workspace_id) DO UPDATE SET
  plan_revision_id = EXCLUDED.plan_revision_id,
  default_model_id = EXCLUDED.default_model_id,
  monthly_token_limit = EXCLUDED.monthly_token_limit,
  updated_at = now()`, p.WorkspaceID, p.PlanRevID, defaultModelID, monthlyTokens)
						}
						_ = tx.Commit(ctx)
					}
				} else if status == "02" {
					_, _ = s.db.Exec(ctx, `UPDATE workspace_orders SET status = 'cancelled', updated_at = now() WHERE id = $1`, p.ID)
				}
			}
		}
	}

	// 3. Handle expired subscriptions (expires_at < now())
	rows, expErr := s.db.Query(ctx, `
SELECT ws.workspace_id, COALESCE(u.email, '')
FROM workspace_subscriptions ws
JOIN workspaces w ON w.id = ws.workspace_id
LEFT JOIN workspace_memberships wm ON wm.workspace_id = ws.workspace_id AND wm.role = 'owner'
LEFT JOIN users u ON u.id = wm.user_id
WHERE ws.expires_at IS NOT NULL AND ws.expires_at < now()`)
	if expErr == nil {
		type expWs struct {
			WorkspaceID uuid.UUID
			OwnerEmail  string
		}
		var expList []expWs
		for rows.Next() {
			var e expWs
			if err := rows.Scan(&e.WorkspaceID, &e.OwnerEmail); err == nil {
				expList = append(expList, e)
			}
		}
		rows.Close()

		for _, item := range expList {
			// Clear plan_revision_id or downgrade
			_, _ = s.db.Exec(ctx, `
UPDATE workspace_subscriptions
SET plan_revision_id = NULL, expires_at = NULL, updated_at = now()
WHERE workspace_id = $1`, item.WorkspaceID)

			if item.OwnerEmail != "" {
				log.Printf("workspace %s subscription expired (owner: %s)", item.WorkspaceID, item.OwnerEmail)
			}
		}
	}
}
