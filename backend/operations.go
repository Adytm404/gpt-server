package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/ssh"
)

const maxOperationOutput = 1 << 20

func (s *server) operationRoutes(r chi.Router) {
	r.Get("/", s.listOperations)
	r.Get("/{id}", s.getOperation)
	r.With(s.requireMutation).Post("/{id}/approve", s.requireWorkspaceAction("operate", s.approveOperation))
	r.With(s.requireMutation).Post("/{id}/reject", s.requireWorkspaceAction("operate", s.rejectOperation))
	r.With(s.requireMutation).Post("/{id}/cancel", s.requireWorkspaceAction("operate", s.cancelOperation))
	r.Get("/{id}/events", s.operationEvents)
}

const operationSelect = `SELECT id,thread_id,server_id,created_by,model_id,status,policy,risk,title,summary,error,approved_by,rejected_by,approved_at,rejected_at,started_at,finished_at,created_at,updated_at FROM operations`

func scanOperation(row pgx.Row) (operationResponse, error) {
	var o operationResponse
	err := row.Scan(&o.ID, &o.ThreadID, &o.ServerID, &o.CreatedBy, &o.ModelID, &o.Status, &o.Policy, &o.Risk, &o.Title, &o.Summary, &o.Error, &o.ApprovedBy, &o.RejectedBy, &o.ApprovedAt, &o.RejectedAt, &o.StartedAt, &o.FinishedAt, &o.CreatedAt, &o.UpdatedAt)
	return o, err
}

func (s *server) loadOperation(ctx context.Context, id, workspaceID uuid.UUID) (operationResponse, error) {
	o, err := scanOperation(s.db.QueryRow(ctx, operationSelect+` WHERE id=$1 AND workspace_id=$2`, id, workspaceID))
	if err != nil {
		return o, err
	}
	o.Steps, err = s.loadOperationSteps(ctx, id)
	return o, err
}

func (s *server) loadOperationSteps(ctx context.Context, id uuid.UUID) ([]operationStepResponse, error) {
	rows, err := s.db.Query(ctx, `SELECT id,position,description,executable,args,status,exit_code,stdout,stderr,started_at,finished_at FROM operation_steps WHERE operation_id=$1 ORDER BY position`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	steps := []operationStepResponse{}
	for rows.Next() {
		var x operationStepResponse
		if err = rows.Scan(&x.ID, &x.Position, &x.Description, &x.Executable, &x.Args, &x.Status, &x.ExitCode, &x.Stdout, &x.Stderr, &x.StartedAt, &x.FinishedAt); err != nil {
			return nil, err
		}
		steps = append(steps, x)
	}
	return steps, rows.Err()
}

func (s *server) listOperations(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r.Context())
	args := []any{a.WorkspaceID}
	where := "workspace_id=$1"
	if thread := r.URL.Query().Get("thread_id"); thread != "" {
		id, err := uuid.Parse(thread)
		if err != nil {
			s.writeError(w, r, 400, "invalid thread id")
			return
		}
		args = append(args, id)
		where += " AND thread_id=$2"
	}
	rows, err := s.db.Query(r.Context(), operationSelect+` WHERE `+where+` ORDER BY created_at DESC LIMIT 200`, args...)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer rows.Close()
	out := []operationResponse{}
	for rows.Next() {
		o, e := scanOperation(rows)
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		s.dbError(w, r, err)
		return
	}
	rows.Close()
	for i := range out {
		out[i].Steps, err = s.loadOperationSteps(r.Context(), out[i].ID)
		if err != nil {
			s.dbError(w, r, err)
			return
		}
	}
	s.writeJSON(w, 200, map[string]any{"operations": out})
}
func (s *server) getOperation(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	o, err := s.loadOperation(r.Context(), id, authFrom(r.Context()).WorkspaceID)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, o)
}

func (s *server) approveOperation(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	a := authFrom(r.Context())
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	tag, err := tx.Exec(r.Context(), `UPDATE operations SET status='approved',approved_by=$3,approved_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status='pending_approval'`, id, a.WorkspaceID, a.UserID)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		s.writeError(w, r, 409, "operation is not pending approval")
		return
	}
	if err = insertOperationEvent(r.Context(), tx, id, "approved", uuid.Nil, map[string]any{"approved_by": a.UserID}); err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	go s.runOperation(id, a.WorkspaceID)
	s.writeJSON(w, 202, map[string]any{"id": id, "status": "approved"})
}
func (s *server) rejectOperation(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	a := authFrom(r.Context())
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	tag, err := tx.Exec(r.Context(), `UPDATE operations SET status='rejected',rejected_by=$3,rejected_at=now(),finished_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status='pending_approval'`, id, a.WorkspaceID, a.UserID)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		s.writeError(w, r, 409, "operation is not pending approval")
		return
	}
	if err = insertOperationEvent(r.Context(), tx, id, "rejected", uuid.Nil, map[string]any{"rejected_by": a.UserID}); err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, map[string]any{"id": id, "status": "rejected"})
}
func (s *server) cancelOperation(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	a := authFrom(r.Context())
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	tag, err := tx.Exec(r.Context(), `UPDATE operations SET status='cancelled',error='operation cancelled',finished_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status IN ('planning','pending_approval','approved','running')`, id, a.WorkspaceID)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		s.writeError(w, r, 409, "operation cannot be cancelled")
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE operation_steps SET status='cancelled',finished_at=now(),updated_at=now() WHERE operation_id=$1 AND status IN ('pending','running')`, id); err == nil {
		err = insertOperationEvent(r.Context(), tx, id, "cancelled", uuid.Nil, map[string]any{})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.cancelMu.Lock()
	cancel := s.operationCancels[id]
	s.cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
	s.writeJSON(w, 200, map[string]any{"id": id, "status": "cancelled"})
}

func (s *server) failStaleOperations(ctx context.Context) error {
	_, err := s.db.Exec(ctx, `WITH stale AS (UPDATE operations SET status='failed',error='server restarted before operation completed',finished_at=now(),updated_at=now() WHERE status IN ('planning','approved','running') RETURNING id) INSERT INTO operation_events(operation_id,event_type,payload) SELECT id,'failed','{"error":"server restarted"}'::jsonb FROM stale`)
	return err
}

func (s *server) runOperation(id, workspaceID uuid.UUID) {
	ctx, cancel := context.WithCancel(context.Background())
	s.cancelMu.Lock()
	if s.operationCancels == nil {
		s.operationCancels = map[uuid.UUID]context.CancelFunc{}
	}
	s.operationCancels[id] = cancel
	s.cancelMu.Unlock()
	defer func() { cancel(); s.cancelMu.Lock(); delete(s.operationCancels, id); s.cancelMu.Unlock() }()
	tag, err := s.db.Exec(ctx, `UPDATE operations SET status='running',started_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status='approved'`, id, workspaceID)
	if err != nil || tag.RowsAffected() == 0 {
		return
	}
	_ = insertOperationEvent(ctx, s.db, id, "running", uuid.Nil, map[string]any{})
	var target sshConnectionTarget
	var ciphertext []byte
	err = s.db.QueryRow(ctx, `SELECT s.host,s.port,s.ssh_user,s.auth_method,s.host_fingerprint,CASE WHEN s.auth_method='password' THEN s.password_ciphertext ELSE s.private_key_ciphertext END FROM operations o JOIN servers s ON s.id=o.server_id AND s.workspace_id=o.workspace_id WHERE o.id=$1 AND o.workspace_id=$2 AND s.deleted_at IS NULL AND s.updated_at=o.server_updated_at`, id, workspaceID).Scan(&target.Host, &target.Port, &target.SSHUser, &target.AuthMethod, &target.HostFingerprint, &ciphertext)
	if err != nil {
		s.finishOperation(ctx, id, "failed", "server configuration changed after planning")
		return
	}
	if target.HostFingerprint == "" {
		s.finishOperation(ctx, id, "failed", "server host fingerprint is required")
		return
	}
	secret, err := decryptServerCredential(s.cfg.serverKeyEncryptionKey, ciphertext)
	if err != nil {
		s.finishOperation(ctx, id, "failed", "server credential unavailable")
		return
	}
	connectCtx, connectCancel := context.WithTimeout(ctx, normalizedSSHTimeout(s.cfg.sshConnectTimeout))
	client, _, err := dialAuthenticatedSSH(connectCtx, target, secret)
	connectCancel()
	if err != nil {
		s.finishOperation(ctx, id, "failed", sanitizeSSHError(err.Error()))
		return
	}
	defer client.Close()
	rows, err := s.db.Query(ctx, `SELECT id,position,description,executable,args FROM operation_steps WHERE operation_id=$1 ORDER BY position`, id)
	if err != nil {
		s.finishOperation(ctx, id, "failed", "operation steps unavailable")
		return
	}
	var steps []operationStepResponse
	for rows.Next() {
		var x operationStepResponse
		if rows.Scan(&x.ID, &x.Position, &x.Description, &x.Executable, &x.Args) != nil {
			rows.Close()
			s.finishOperation(ctx, id, "failed", "operation steps invalid")
			return
		}
		steps = append(steps, x)
	}
	rows.Close()
	for _, step := range steps {
		if ctx.Err() != nil {
			s.markOperationStepsCancelled(context.Background(), id)
			return
		}
		if err = s.runOperationStep(ctx, client, id, step, len(steps)); err != nil {
			if ctx.Err() != nil {
				s.markOperationStepsCancelled(context.Background(), id)
				return
			}
			s.finishOperation(context.Background(), id, "failed", "diagnostic step failed")
			return
		}
	}
	s.finishOperation(ctx, id, "succeeded", "")
}

func (s *server) runOperationStep(parent context.Context, client *ssh.Client, opID uuid.UUID, step operationStepResponse, total int) error {
	command, err := shellQuoteCommand(step.Executable, step.Args)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(parent, `UPDATE operation_steps SET status='running',started_at=now(),updated_at=now() WHERE id=$1 AND status='pending'`, step.ID)
	if err != nil {
		return err
	}
	_ = insertOperationEvent(parent, s.db, opID, "step.started", step.ID, map[string]any{"position": step.Position, "total": total, "description": step.Description})
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	defer cancel()
	session, err := client.NewSession()
	if err != nil {
		return err
	}
	defer session.Close()
	stdout := newEventBuffer(s, opID, step.ID, "stdout")
	stderr := newEventBuffer(s, opID, step.ID, "stderr")
	session.Stdout = stdout
	session.Stderr = stderr
	done := make(chan error, 1)
	go func() { done <- session.Run(command) }()
	select {
	case err = <-done:
	case <-ctx.Done():
		_ = session.Close()
		<-done
		err = ctx.Err()
	}
	stdout.Flush()
	stderr.Flush()
	exitCode := 0
	if err != nil {
		exitCode = -1
		var exitErr *ssh.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitStatus()
		}
	}
	status := operationStepFinalStatus(parent.Err(), err)
	_, dbErr := s.db.Exec(context.Background(), `UPDATE operation_steps SET status=$2,exit_code=$3,stdout=$4,stderr=$5,finished_at=now(),updated_at=now() WHERE id=$1 AND status='running'`, step.ID, status, exitCode, stdout.String(), stderr.String())
	if dbErr != nil {
		return dbErr
	}
	_ = insertOperationEvent(context.Background(), s.db, opID, "step.completed", step.ID, map[string]any{"position": step.Position, "total": total, "status": status, "exit_code": exitCode, "output_truncated": stdout.Truncated() || stderr.Truncated()})
	return err
}

type eventBuffer struct {
	mu           sync.Mutex
	buf          bytes.Buffer
	truncated    bool
	s            *server
	opID, stepID uuid.UUID
	event        string
	pending      bytes.Buffer
}

func newEventBuffer(s *server, opID, stepID uuid.UUID, event string) *eventBuffer {
	return &eventBuffer{s: s, opID: opID, stepID: stepID, event: event}
}
func (b *eventBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	remain := maxOperationOutput - b.buf.Len()
	chunk := p
	if remain <= 0 {
		b.truncated = true
		chunk = nil
	} else if len(chunk) > remain {
		chunk = chunk[:remain]
		b.truncated = true
	}
	if len(chunk) > 0 {
		_, _ = b.buf.Write(chunk)
		_, _ = b.pending.Write(chunk)
	}
	var eventChunk []byte
	if b.pending.Len() >= 4096 {
		eventChunk = append([]byte(nil), b.pending.Bytes()...)
		b.pending.Reset()
	}
	b.mu.Unlock()
	b.emit(eventChunk)
	return len(p), nil
}
func (b *eventBuffer) Flush() {
	b.mu.Lock()
	chunk := append([]byte(nil), b.pending.Bytes()...)
	b.pending.Reset()
	b.mu.Unlock()
	b.emit(chunk)
}
func (b *eventBuffer) emit(chunk []byte) {
	if len(chunk) == 0 || b.s == nil || b.s.db == nil {
		return
	}
	safe := redactOperationalOutput(strings.ToValidUTF8(string(chunk), ""))
	_ = insertOperationEvent(context.Background(), b.s.db, b.opID, b.event, b.stepID, map[string]any{"chunk": safe})
}
func (b *eventBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return redactOperationalOutput(strings.ToValidUTF8(b.buf.String(), ""))
}
func (b *eventBuffer) Truncated() bool { b.mu.Lock(); defer b.mu.Unlock(); return b.truncated }
func (s *server) markStepCancelled(ctx context.Context, id uuid.UUID) {
	_, _ = s.db.Exec(ctx, `UPDATE operation_steps SET status='cancelled',finished_at=now(),updated_at=now() WHERE id=$1 AND status IN ('pending','running')`, id)
}
func (s *server) markOperationStepsCancelled(ctx context.Context, operationID uuid.UUID) {
	_, _ = s.db.Exec(ctx, `UPDATE operation_steps SET status='cancelled',finished_at=now(),updated_at=now() WHERE operation_id=$1 AND status IN ('pending','running')`, operationID)
}
func operationStepFinalStatus(parentErr, runErr error) string {
	if parentErr != nil {
		return "cancelled"
	}
	if runErr != nil {
		return "failed"
	}
	return "succeeded"
}
func (s *server) finishOperation(ctx context.Context, id uuid.UUID, status, message string) {
	event := status
	if status == "succeeded" {
		event = "completed"
	}
	tag, _ := s.db.Exec(ctx, `UPDATE operations SET status=$2,error=$3,finished_at=now(),updated_at=now() WHERE id=$1 AND status='running'`, id, status, message)
	if tag.RowsAffected() > 0 {
		_ = insertOperationEvent(ctx, s.db, id, event, uuid.Nil, map[string]any{"status": status})
	}
}

func (s *server) operationEvents(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	a := authFrom(r.Context())
	release, ok := s.acquireSSEStream(a.UserID, a.WorkspaceID, id)
	if !ok {
		s.writeError(w, r, http.StatusTooManyRequests, "too many event streams")
		return
	}
	defer release()
	var exists bool
	if s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM operations WHERE id=$1 AND workspace_id=$2)`, id, a.WorkspaceID).Scan(&exists) != nil || !exists {
		s.writeError(w, r, 404, "not found")
		return
	}
	last := int64(0)
	raw := r.Header.Get("Last-Event-ID")
	if q := r.URL.Query().Get("last_event_id"); q != "" {
		raw = q
	}
	if raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			s.writeError(w, r, 400, "invalid last event id")
			return
		}
		last = parsed
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		s.writeError(w, r, 500, "streaming unavailable")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	heartbeat := time.NewTicker(15 * time.Second)
	poll := time.NewTicker(500 * time.Millisecond)
	defer heartbeat.Stop()
	defer poll.Stop()
	terminalSince := time.Time{}
	streamDeadline := time.NewTimer(15 * time.Minute)
	defer streamDeadline.Stop()
	for {
		events, terminal, hasMore, err := s.loadEvents(r.Context(), id, a.WorkspaceID, last)
		if err != nil {
			return
		}
		for _, e := range events {
			last = e.ID
			raw, _ := json.Marshal(e.Payload)
			fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", e.ID, e.Type, raw)
			flusher.Flush()
		}
		if terminal && !hasMore && len(events) == 0 && terminalSince.IsZero() {
			terminalSince = time.Now()
		}
		if !terminalSince.IsZero() && time.Since(terminalSince) > 2*time.Second {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-streamDeadline.C:
			return
		case <-heartbeat.C:
			fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		case <-poll.C:
		}
	}
}

type operationEventDTO struct {
	ID      int64
	Type    string
	Payload json.RawMessage
}

func (s *server) loadEvents(ctx context.Context, opID, workspaceID uuid.UUID, last int64) ([]operationEventDTO, bool, bool, error) {
	rows, err := s.db.Query(ctx, `SELECT e.id,e.event_type,e.payload FROM operation_events e JOIN operations o ON o.id=e.operation_id WHERE e.operation_id=$1 AND o.workspace_id=$2 AND e.id>$3 ORDER BY e.id LIMIT 201`, opID, workspaceID, last)
	if err != nil {
		return nil, false, false, err
	}
	defer rows.Close()
	out := []operationEventDTO{}
	for rows.Next() {
		var e operationEventDTO
		if rows.Scan(&e.ID, &e.Type, &e.Payload) != nil {
			return nil, false, false, rows.Err()
		}
		out = append(out, e)
	}
	hasMore := len(out) > 200
	if hasMore {
		out = out[:200]
	}
	var terminal bool
	err = s.db.QueryRow(ctx, `SELECT status IN ('succeeded','failed','rejected','cancelled') FROM operations WHERE id=$1 AND workspace_id=$2`, opID, workspaceID).Scan(&terminal)
	return out, terminal, hasMore, err
}

func (s *server) acquireSSEStream(userID, workspaceID, operationID uuid.UUID) (func(), bool) {
	key := userID.String() + ":" + workspaceID.String() + ":" + operationID.String()
	s.sseMu.Lock()
	defer s.sseMu.Unlock()
	if s.sseStreams == nil {
		s.sseStreams = make(map[string]int)
	}
	if s.sseStreams[key] >= 3 {
		return nil, false
	}
	s.sseStreams[key]++
	return func() {
		s.sseMu.Lock()
		defer s.sseMu.Unlock()
		s.sseStreams[key]--
		if s.sseStreams[key] == 0 {
			delete(s.sseStreams, key)
		}
	}, true
}

var _ io.Writer = (*eventBuffer)(nil)
