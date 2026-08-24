package main

import (
	"net/http"
	"time"

	"github.com/google/uuid"
)

type adminUserItem struct {
	ID            uuid.UUID `json:"id"`
	FullName      string    `json:"full_name"`
	Email         string    `json:"email"`
	PlatformRole  string    `json:"platform_role"`
	EmailVerified bool      `json:"email_verified"`
	WorkspaceName string    `json:"workspace_name"`
	WorkspaceRole string    `json:"workspace_role"`
	PlanName      string    `json:"plan_name"`
	CreatedAt     string    `json:"created_at"`
}

type adminUsersResponse struct {
	TotalUsers    int             `json:"total_users"`
	VerifiedUsers int             `json:"verified_users"`
	AdminUsers    int             `json:"admin_users"`
	Users         []adminUserItem `json:"users"`
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

func (s *server) listAdminUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `
SELECT u.id, u.full_name, u.email, u.platform_role, COALESCE(u.email_verified, true),
       COALESCE(w.name, ''), COALESCE(wm.role, ''),
       COALESCE(p.name, 'Free / Default'), u.created_at
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
	adminUsers := 0

	for rows.Next() {
		var u adminUserItem
		var created time.Time
		if err := rows.Scan(&u.ID, &u.FullName, &u.Email, &u.PlatformRole, &u.EmailVerified, &u.WorkspaceName, &u.WorkspaceRole, &u.PlanName, &created); err != nil {
			s.dbError(w, r, err)
			return
		}
		u.CreatedAt = created.Format(time.RFC3339)
		users = append(users, u)

		totalUsers++
		if u.EmailVerified {
			verifiedUsers++
		}
		if u.PlatformRole == "admin" {
			adminUsers++
		}
	}

	s.writeJSON(w, http.StatusOK, adminUsersResponse{
		TotalUsers:    totalUsers,
		VerifiedUsers: verifiedUsers,
		AdminUsers:    adminUsers,
		Users:         users,
	})
}

func (s *server) listAdminTransactions(w http.ResponseWriter, r *http.Request) {
	// Revenue calculations
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
