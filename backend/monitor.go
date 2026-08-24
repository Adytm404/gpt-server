package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type serverMonitorTarget struct {
	ID                   uuid.UUID
	WorkspaceID          uuid.UUID
	Name                 string
	Host                 string
	Port                 int
	AlertEnabled         bool
	AlertRecipientEmails string
	OwnerEmail           string
}

type serverAlertState struct {
	LastStatus          string
	ConsecutiveFailures int
	DownSince           *time.Time
	LastAlertSentAt     *time.Time
	LastResolvedSentAt  *time.Time
}

func (s *server) startServerMonitoringWorker(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Minute)
	go func() {
		defer ticker.Stop()
		// Initial run on startup after 10 seconds
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Second):
			s.runMonitoringCheck(ctx)
		}

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runMonitoringCheck(ctx)
			}
		}
	}()
}

func (s *server) runMonitoringCheck(ctx context.Context) {
	targets, err := s.loadMonitoringTargets(ctx)
	if err != nil {
		log.Printf("monitor: failed to load servers: %v", err)
		return
	}

	for _, target := range targets {
		if ctx.Err() != nil {
			return
		}
		s.checkSingleServerReachability(ctx, target)
	}
}

func (s *server) loadMonitoringTargets(ctx context.Context) ([]serverMonitorTarget, error) {
	rows, err := s.db.Query(ctx, `
SELECT s.id, s.workspace_id, s.name, s.host, s.port,
       COALESCE(w.alert_server_down_email, true),
       COALESCE(w.alert_recipient_emails, ''),
       COALESCE(u.email, '')
FROM servers s
JOIN workspaces w ON w.id = s.workspace_id
LEFT JOIN workspace_memberships wm ON wm.workspace_id = s.workspace_id AND wm.role = 'owner'
LEFT JOIN users u ON u.id = wm.user_id
WHERE s.deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var targets []serverMonitorTarget
	for rows.Next() {
		var t serverMonitorTarget
		if err := rows.Scan(&t.ID, &t.WorkspaceID, &t.Name, &t.Host, &t.Port, &t.AlertEnabled, &t.AlertRecipientEmails, &t.OwnerEmail); err != nil {
			continue
		}
		targets = append(targets, t)
	}
	return targets, rows.Err()
}

func (s *server) checkSingleServerReachability(ctx context.Context, target serverMonitorTarget) {
	address := net.JoinHostPort(target.Host, strconv.Itoa(target.Port))
	dialer := net.Dialer{Timeout: 5 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", address)

	var alertState serverAlertState
	var dbDownSince, dbLastAlert, dbLastResolved *time.Time
	stateErr := s.db.QueryRow(ctx, `
SELECT last_status, consecutive_failures, down_since, last_alert_sent_at, last_resolved_sent_at
FROM server_alert_states
WHERE server_id = $1`, target.ID).Scan(&alertState.LastStatus, &alertState.ConsecutiveFailures, &dbDownSince, &dbLastAlert, &dbLastResolved)

	alertState.DownSince = dbDownSince
	alertState.LastAlertSentAt = dbLastAlert
	alertState.LastResolvedSentAt = dbLastResolved

	now := time.Now().UTC()

	if err == nil {
		_ = conn.Close()
		// Server reachable
		isRecovery := false
		if alertState.LastAlertSentAt != nil {
			if alertState.LastResolvedSentAt == nil || alertState.LastResolvedSentAt.Before(*alertState.LastAlertSentAt) {
				isRecovery = true
			}
		}

		if isRecovery && target.AlertEnabled {
			recipients := s.resolveAlertRecipients(target)
			s.sendServerRestoredAlarm(ctx, target.Name, target.Host, target.Port, recipients)
		}

		if errors.Is(stateErr, pgx.ErrNoRows) {
			_, _ = s.db.Exec(ctx, `
INSERT INTO server_alert_states (server_id, last_status, consecutive_failures, down_since, last_checked_at, last_resolved_sent_at, updated_at)
VALUES ($1, 'online', 0, NULL, $2, CASE WHEN $3 THEN $2 ELSE NULL END, $2)`, target.ID, now, isRecovery)
		} else {
			_, _ = s.db.Exec(ctx, `
UPDATE server_alert_states
SET last_status = 'online', consecutive_failures = 0, down_since = NULL, last_checked_at = $2,
    last_resolved_sent_at = CASE WHEN $3 THEN $2 ELSE last_resolved_sent_at END,
    updated_at = $2
WHERE server_id = $1`, target.ID, now, isRecovery)
		}
		return
	}

	// Server unreachable
	failureReason := fmt.Sprintf("TCP dial to %s failed: %v", address, err)
	newFailures := alertState.ConsecutiveFailures + 1
	downSince := now
	if alertState.DownSince != nil && alertState.LastStatus == "down" {
		downSince = *alertState.DownSince
	}

	shouldSendDownAlert := false
	// Trigger alarm if down for at least 5 minutes
	if now.Sub(downSince) >= 5*time.Minute {
		// Only send once per downtime session
		if alertState.LastAlertSentAt == nil || alertState.LastAlertSentAt.Before(downSince) {
			shouldSendDownAlert = true
		}
	}

	if shouldSendDownAlert && target.AlertEnabled {
		recipients := s.resolveAlertRecipients(target)
		s.sendServerDownAlarm(ctx, target.Name, target.Host, target.Port, failureReason, recipients)
	}

	if errors.Is(stateErr, pgx.ErrNoRows) {
		_, _ = s.db.Exec(ctx, `
INSERT INTO server_alert_states (server_id, last_status, consecutive_failures, down_since, last_alert_sent_at, last_checked_at, updated_at)
VALUES ($1, 'down', $2, $3, CASE WHEN $4 THEN $3 ELSE NULL END, $3, $3)`, target.ID, newFailures, downSince, shouldSendDownAlert)
	} else {
		_, _ = s.db.Exec(ctx, `
UPDATE server_alert_states
SET last_status = 'down', consecutive_failures = $2, down_since = $3,
    last_alert_sent_at = CASE WHEN $4 THEN $5 ELSE last_alert_sent_at END,
    last_checked_at = $5, updated_at = $5
WHERE server_id = $1`, target.ID, newFailures, downSince, shouldSendDownAlert, now)
	}
}

func (s *server) resolveAlertRecipients(target serverMonitorTarget) []string {
	var list []string
	if target.AlertRecipientEmails != "" {
		for _, email := range strings.Split(target.AlertRecipientEmails, ",") {
			email = strings.TrimSpace(email)
			if email != "" && validEmail(email) {
				list = append(list, email)
			}
		}
	}
	if len(list) == 0 && target.OwnerEmail != "" && validEmail(target.OwnerEmail) {
		list = append(list, target.OwnerEmail)
	}
	return list
}
