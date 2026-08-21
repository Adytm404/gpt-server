package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/ssh"
)

const maxOperationOutput = 1 << 20
const maxSummaryInput = 64 << 10
const maxAgentInput = 64 << 10
const maxAgentRounds = 4
const maxOperationSteps = 12

func (s *server) operationRoutes(r chi.Router) {
	r.Get("/", s.listOperations)
	r.Get("/{id}", s.getOperation)
	r.With(s.requireMutation).Post("/{id}/approve", s.requireWorkspaceAction("operate", s.approveOperation))
	r.With(s.requireMutation).Post("/{id}/reject", s.requireWorkspaceAction("operate", s.rejectOperation))
	r.With(s.requireMutation).Post("/{id}/cancel", s.requireWorkspaceAction("operate", s.cancelOperation))
	r.With(s.requireMutation).Post("/{id}/retry", s.requireWorkspaceAction("operate", s.retryOperation))
	r.Get("/{id}/events", s.operationEvents)
}

const operationSelect = `SELECT id,thread_id,server_id,created_by,model_id,status,policy,risk,title,summary,error,approved_by,rejected_by,approved_at,rejected_at,started_at,finished_at,created_at,updated_at,agent_round FROM operations`

func scanOperation(row pgx.Row) (operationResponse, error) {
	var o operationResponse
	err := row.Scan(&o.ID, &o.ThreadID, &o.ServerID, &o.CreatedBy, &o.ModelID, &o.Status, &o.Policy, &o.Risk, &o.Title, &o.Summary, &o.Error, &o.ApprovedBy, &o.RejectedBy, &o.ApprovedAt, &o.RejectedAt, &o.StartedAt, &o.FinishedAt, &o.CreatedAt, &o.UpdatedAt, &o.AgentRound)
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
	tag, err := tx.Exec(r.Context(), `UPDATE operations SET status='cancelled',error='operation cancelled',finished_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status IN ('planning','pending_approval','approved','running','summarizing')`, id, a.WorkspaceID)
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

func (s *server) retryOperation(w http.ResponseWriter, r *http.Request) {
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
	var pending int
	err = tx.QueryRow(r.Context(), `SELECT count(*) FROM operation_steps s JOIN operations o ON o.id=s.operation_id WHERE s.operation_id=$1 AND o.workspace_id=$2 AND o.status='failed' AND s.status='pending'`, id, a.WorkspaceID).Scan(&pending)
	if err == nil && pending == 0 {
		_, err = tx.Exec(r.Context(), `UPDATE operation_steps SET status='pending',exit_code=NULL,stdout='',stderr='',started_at=NULL,finished_at=NULL,updated_at=now() WHERE id=(SELECT s.id FROM operation_steps s JOIN operations o ON o.id=s.operation_id WHERE s.operation_id=$1 AND o.workspace_id=$2 AND o.status='failed' AND s.status='failed' ORDER BY s.position DESC LIMIT 1)`, id, a.WorkspaceID)
	}
	var tag pgconn.CommandTag
	if err == nil {
		tag, err = tx.Exec(r.Context(), `UPDATE operations SET status=CASE WHEN policy='autonomous_full_access' THEN 'approved' ELSE 'pending_approval' END,error='',approved_by=CASE WHEN policy='autonomous_full_access' THEN $3 ELSE NULL END,approved_at=CASE WHEN policy='autonomous_full_access' THEN now() ELSE NULL END,rejected_by=NULL,rejected_at=NULL,started_at=NULL,finished_at=NULL,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status='failed'`, id, a.WorkspaceID, a.UserID)
	}
	if err == nil && tag.RowsAffected() != 1 {
		s.writeError(w, r, 409, "operation is not retryable")
		return
	}
	if err == nil {
		err = insertOperationEvent(r.Context(), tx, id, "retry.requested", uuid.Nil, map[string]any{"requested_by": a.UserID})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	var status string
	if err = s.db.QueryRow(r.Context(), `SELECT status FROM operations WHERE id=$1 AND workspace_id=$2`, id, a.WorkspaceID).Scan(&status); err != nil {
		s.dbError(w, r, err)
		return
	}
	if status == "approved" {
		go s.runOperation(id, a.WorkspaceID)
	}
	s.writeJSON(w, 200, map[string]any{"id": id, "status": status})
}

func (s *server) failStaleOperations(ctx context.Context) error {
	_, err := s.db.Exec(ctx, `WITH stale AS (UPDATE operations SET status='failed',error='server restarted before operation completed',finished_at=now(),updated_at=now() WHERE status IN ('planning','approved','running','summarizing') RETURNING id) INSERT INTO operation_events(operation_id,event_type,payload) SELECT id,'failed','{"error":"server restarted"}'::jsonb FROM stale`)
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
	for {
		steps, loadErr := s.loadOperationSteps(ctx, id)
		if loadErr != nil {
			s.finishOperation(ctx, id, "failed", "operation steps unavailable")
			return
		}
		for _, step := range steps {
			if step.Status != "pending" {
				continue
			}
			if ctx.Err() != nil {
				s.markOperationStepsCancelled(context.Background(), id)
				return
			}
			if err = s.runOperationStep(ctx, client, id, step, len(steps)); err != nil {
				if ctx.Err() != nil {
					s.markOperationStepsCancelled(context.Background(), id)
					return
				}
				var exitErr *ssh.ExitError
				if errors.As(err, &exitErr) {
					continue
				}
				s.finishOperation(context.Background(), id, "failed", "SSH execution failed")
				return
			}
		}
		steps, loadErr = s.loadOperationSteps(ctx, id)
		if loadErr != nil {
			s.setAgentSummaryNote(id, "Agent could not continue because operation evidence became unavailable.")
			break
		}
		round := 0
		if queryErr := s.db.QueryRow(ctx, `SELECT agent_round FROM operations WHERE id=$1 AND workspace_id=$2 AND status='running'`, id, workspaceID).Scan(&round); queryErr != nil {
			return
		}
		if !canRequestAgentDecision(round, len(steps)) {
			s.setAgentSummaryNote(id, "Agent investigation limit reached; summary uses evidence collected so far.")
			break
		}
		decision, usage, decisionErr := s.decideAgentContinuation(ctx, id, workspaceID, round+1, steps)
		if ctx.Err() != nil {
			return
		}
		if decisionErr != nil {
			s.recordAgentRound(id, workspaceID, round+1, usage, nil, "Agent could not continue safely; summary uses evidence collected so far.")
			break
		}
		if decision.Status == "complete" {
			if s.recordAgentRound(id, workspaceID, round+1, usage, nil, "") != nil {
				s.setAgentSummaryNote(id, "Agent could not persist its completion decision; summary uses evidence collected so far.")
			}
			break
		}
		if len(steps)+len(decision.Steps) > maxOperationSteps {
			s.recordAgentRound(id, workspaceID, round+1, usage, nil, "Agent investigation step limit reached; summary uses evidence collected so far.")
			break
		}
		if err = s.recordAgentRound(id, workspaceID, round+1, usage, decision.Steps, ""); err != nil {
			s.setAgentSummaryNote(id, "Agent could not append further safe checks; summary uses evidence collected so far.")
			break
		}
		var policy string
		if err = s.db.QueryRow(ctx, `SELECT policy FROM operations WHERE id=$1`, id).Scan(&policy); err != nil {
			s.finishOperation(context.Background(), id, "failed", "operation policy unavailable")
			return
		}
		if policy == "unrestricted_approval" {
			if s.pauseForAgentApproval(ctx, id) != nil {
				s.finishOperation(context.Background(), id, "failed", "unable to request command approval")
			}
			return
		}
	}
	if err := s.beginSummarizing(ctx, id); err != nil {
		log.Printf("operation %s could not start summary: %v", id, err)
		s.finishOperation(context.Background(), id, "failed", "unable to start AI result summary")
		return
	}
	s.summarizeOperation(ctx, id, workspaceID)
}

func (s *server) pauseForAgentApproval(ctx context.Context, id uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE operations SET status='pending_approval',approved_by=NULL,approved_at=NULL,updated_at=now() WHERE id=$1 AND status='running'`, id)
	if err != nil || tag.RowsAffected() != 1 {
		return errors.New("operation is no longer running")
	}
	if err = insertOperationEvent(ctx, tx, id, "approval.required", uuid.Nil, map[string]any{"reason": "agent command batch"}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type agentOperationInput struct {
	Request string                   `json:"request"`
	Server  map[string]any           `json:"server"`
	Title   string                   `json:"plan_title"`
	Plan    string                   `json:"plan_summary"`
	Steps   []agentOperationEvidence `json:"completed_steps"`
}

type agentOperationEvidence struct {
	Description string   `json:"description"`
	Executable  string   `json:"executable"`
	Args        []string `json:"args"`
	ExitCode    int      `json:"exit_code"`
	Stdout      string   `json:"stdout"`
	Stderr      string   `json:"stderr"`
}

func canRequestAgentDecision(round, stepCount int) bool {
	return round < maxAgentRounds && stepCount < maxOperationSteps
}

func nextStepPositions(current, count int) []int {
	positions := make([]int, count)
	for i := range positions {
		positions[i] = current + i + 1
	}
	return positions
}

func (s *server) decideAgentContinuation(ctx context.Context, id, workspaceID uuid.UUID, round int, steps []operationStepResponse) (agentDecision, plannerUsage, error) {
	if err := s.requireWorkspaceTokenQuota(ctx, workspaceID); err != nil {
		return agentDecision{}, plannerUsage{}, err
	}
	_ = insertOperationEvent(ctx, s.db, id, "agent.thinking", uuid.Nil, map[string]any{"round": round})
	var input agentOperationInput
	var model plannerModel
	var ciphertext []byte
	var language string
	var policy string
	err := s.db.QueryRow(ctx, `SELECT m.base_url,m.external_model_id,m.api_key_ciphertext,o.response_language,o.title,o.summary,
		COALESCE((SELECT content FROM chat_messages WHERE operation_id=o.id AND role='user' ORDER BY sequence LIMIT 1),''),
		jsonb_build_object('name',s.name,'environment',s.environment,'region',s.region,'operating_system',s.operating_system,'status',s.status,'last_checked_at',s.last_checked_at)
		FROM operations o JOIN ai_models m ON m.id=o.model_id JOIN servers s ON s.id=o.server_id AND s.workspace_id=o.workspace_id WHERE o.id=$1 AND o.workspace_id=$2 AND o.status='running'`, id, workspaceID).Scan(&model.BaseURL, &model.ExternalID, &ciphertext, &language, &input.Title, &input.Plan, &input.Request, &input.Server)
	if err != nil {
		return agentDecision{}, plannerUsage{}, err
	}
	if len(ciphertext) > 0 {
		model.APIKey, err = decryptModelAPIKey(s.cfg.modelKeyEncryptionKey, ciphertext)
		if err != nil {
			return agentDecision{}, plannerUsage{}, err
		}
	}
	prior := make([]planStep, 0, len(steps))
	for _, step := range steps {
		prior = append(prior, planStep{Description: step.Description, Executable: step.Executable, Args: step.Args})
		if step.Status == "succeeded" || step.Status == "failed" {
			exitCode := 0
			if step.ExitCode != nil {
				exitCode = *step.ExitCode
			}
			input.Steps = append(input.Steps, agentOperationEvidence{Description: boundedRedacted(step.Description, 1024), Executable: step.Executable, Args: step.Args, ExitCode: exitCode, Stdout: boundedRedacted(step.Stdout, 8192), Stderr: boundedRedacted(step.Stderr, 8192)})
		}
	}
	input.Request = boundedRedacted(input.Request, 4096)
	input.Title = boundedRedacted(input.Title, 1024)
	input.Plan = boundedRedacted(input.Plan, 4096)
	for {
		raw, _ := json.Marshal(input)
		if len(raw) <= maxAgentInput || len(input.Steps) == 0 {
			break
		}
		input.Steps = input.Steps[1:]
	}
	requestCtx, cancel := context.WithTimeout(ctx, s.cfg.modelRequestTimeout)
	defer cancel()
	if err = s.db.QueryRow(ctx, `SELECT policy FROM operations WHERE id=$1`, id).Scan(&policy); err != nil {
		return agentDecision{}, plannerUsage{}, err
	}
	return requestOpenAIAgentDecision(requestCtx, &http.Client{Timeout: s.cfg.modelRequestTimeout}, model, s.cfg.modelAllowedOrigins, language, input, prior, policy)
}

func (s *server) requireWorkspaceTokenQuota(ctx context.Context, workspaceID uuid.UUID) error {
	var limit, used int64
	err := s.db.QueryRow(ctx, `SELECT monthly_token_limit,COALESCE((SELECT sum(total_tokens) FROM token_usage WHERE workspace_id=$1 AND period_start=date_trunc('month',now())::date),0) FROM workspace_subscriptions WHERE workspace_id=$1`, workspaceID).Scan(&limit, &used)
	if err != nil {
		return err
	}
	if limit <= 0 {
		return errNoEntitlement
	}
	if used >= limit {
		return errQuotaExceeded
	}
	return nil
}

func (s *server) recordAgentRound(id, workspaceID uuid.UUID, round int, usage plannerUsage, steps []planStep, note string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var threadID, modelID uuid.UUID
	var currentSteps, currentRound int
	err = tx.QueryRow(ctx, `SELECT thread_id,model_id,agent_round,(SELECT count(*) FROM operation_steps WHERE operation_id=operations.id) FROM operations WHERE id=$1 AND workspace_id=$2 AND status='running' FOR UPDATE`, id, workspaceID).Scan(&threadID, &modelID, &currentRound, &currentSteps)
	if err != nil || round != currentRound+1 || round > maxAgentRounds || currentSteps+len(steps) > maxOperationSteps {
		if err != nil {
			return err
		}
		return errors.New("agent operation limit exceeded")
	}
	priorRows, err := tx.Query(ctx, `SELECT executable,args FROM operation_steps WHERE operation_id=$1 ORDER BY position`, id)
	if err != nil {
		return err
	}
	var prior []planStep
	for priorRows.Next() {
		var step planStep
		if err = priorRows.Scan(&step.Executable, &step.Args); err != nil {
			priorRows.Close()
			return err
		}
		prior = append(prior, step)
	}
	err = priorRows.Err()
	priorRows.Close()
	if err != nil || hasDuplicateCommands(steps, prior) {
		if err != nil {
			return err
		}
		return errors.New("duplicate agent command")
	}
	for _, step := range steps {
		var policy string
		if err = tx.QueryRow(ctx, `SELECT policy FROM operations WHERE id=$1`, id).Scan(&policy); err != nil {
			return err
		}
		if strings.TrimSpace(step.Description) == "" || validateCommandForPolicy(policy, step.Executable, step.Args) != nil {
			return errors.New("unsafe agent command")
		}
	}
	_, err = tx.Exec(ctx, `UPDATE operations SET agent_round=$3,error=CASE WHEN $4='' THEN error ELSE $4 END,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status='running'`, id, workspaceID, round, note)
	if err != nil {
		return err
	}
	if validUsage(usage) {
		_, err = tx.Exec(ctx, `INSERT INTO token_usage(id,workspace_id,thread_id,operation_id,phase,round,model_id,input_tokens,output_tokens,total_tokens,period_start) VALUES($1,$2,$3,$4,'agent',$5,$6,$7::bigint,$8::bigint,$7::bigint+$8::bigint,date_trunc('month',now())::date)`, uuid.New(), workspaceID, threadID, id, round, modelID, usage.InputTokens, usage.OutputTokens)
		if err != nil {
			return err
		}
	}
	positions := nextStepPositions(currentSteps, len(steps))
	descriptions := make([]string, len(steps))
	for i, step := range steps {
		args, _ := json.Marshal(step.Args)
		_, err = tx.Exec(ctx, `INSERT INTO operation_steps(id,operation_id,position,description,executable,args,status) VALUES($1,$2,$3,$4,$5,$6,'pending')`, uuid.New(), id, positions[i], step.Description, step.Executable, args)
		if err != nil {
			return err
		}
		descriptions[i] = step.Description
	}
	if len(steps) > 0 {
		err = insertOperationEvent(ctx, tx, id, "flow.updated", uuid.Nil, map[string]any{"round": round, "total": currentSteps + len(steps), "new_steps": descriptions})
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *server) setAgentSummaryNote(id uuid.UUID, note string) {
	_, _ = s.db.Exec(context.Background(), `UPDATE operations SET error=$2,updated_at=now() WHERE id=$1 AND status='running'`, id, note)
}

func (s *server) beginSummarizing(ctx context.Context, id uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE operations SET status='summarizing',updated_at=now() WHERE id=$1 AND status='running'`, id)
	if err != nil || tag.RowsAffected() != 1 {
		if err != nil {
			return err
		}
		return errors.New("operation is no longer running")
	}
	if err = insertOperationEvent(ctx, tx, id, "summary.started", uuid.Nil, map[string]any{"status": "summarizing"}); err == nil {
		err = insertOperationEvent(ctx, tx, id, "summarizing", uuid.Nil, map[string]any{"status": "summarizing"})
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type summaryOperationInput struct {
	Request string                 `json:"request"`
	Server  map[string]any         `json:"server"`
	Title   string                 `json:"plan_title"`
	Plan    string                 `json:"plan_summary"`
	Steps   []summaryOperationStep `json:"completed_steps"`
	Note    string                 `json:"investigation_note,omitempty"`
}

type summaryOperationStep struct {
	Description string `json:"description"`
	ExitCode    int    `json:"exit_code"`
	Stdout      string `json:"stdout"`
	Stderr      string `json:"stderr"`
}

func boundSummaryInput(input summaryOperationInput) summaryOperationInput {
	input.Request = boundedRedacted(input.Request, 4096)
	input.Title = boundedRedacted(input.Title, 1024)
	input.Plan = boundedRedacted(input.Plan, 4096)
	input.Note = boundedRedacted(input.Note, 2048)
	for i := range input.Steps {
		input.Steps[i].Description = boundedRedacted(input.Steps[i].Description, 1024)
		input.Steps[i].Stdout = boundedRedacted(input.Steps[i].Stdout, 8192)
		input.Steps[i].Stderr = boundedRedacted(input.Steps[i].Stderr, 8192)
	}
	for {
		raw, _ := json.Marshal(input)
		if len(raw) <= maxSummaryInput {
			return input
		}
		if len(input.Steps) == 0 {
			if _, ok := input.Server["health"]; ok {
				delete(input.Server, "health")
				continue
			}
			input.Server = map[string]any{"context_truncated": true}
			continue
		}
		last := &input.Steps[len(input.Steps)-1]
		if len(last.Stdout) > 1024 {
			last.Stdout = last.Stdout[:len(last.Stdout)/2]
		} else if len(last.Stderr) > 1024 {
			last.Stderr = last.Stderr[:len(last.Stderr)/2]
		} else {
			input.Steps = input.Steps[:len(input.Steps)-1]
		}
	}
}

func boundedRedacted(value string, limit int) string {
	value = redactSummaryOutput(strings.ToValidUTF8(value, ""))
	if len(value) > limit {
		value = value[:limit] + "\n[TRUNCATED]"
	}
	return value
}

func (s *server) summarizeOperation(ctx context.Context, id, workspaceID uuid.UUID) {
	var input summaryOperationInput
	var threadID, modelID uuid.UUID
	var model plannerModel
	var ciphertext []byte
	var languageCode string
	err := s.db.QueryRow(ctx, `SELECT o.thread_id,o.model_id,m.base_url,m.external_model_id,m.api_key_ciphertext,o.response_language,o.title,o.summary,o.error,
		COALESCE((SELECT cm.content FROM operation_events e JOIN chat_messages cm ON cm.id=(e.payload->>'message_id')::uuid WHERE e.operation_id=o.id AND e.event_type='planning' ORDER BY e.id LIMIT 1),''),
		jsonb_build_object('name',s.name,'environment',s.environment,'region',s.region,'operating_system',s.operating_system,'status',s.status,'last_checked_at',s.last_checked_at,
		'health',COALESCE((SELECT jsonb_build_object('status',h.status,'cpu_percent',h.cpu_percent,'memory_percent',h.memory_percent,'disk_percent',h.disk_percent,'services',h.services,'checked_at',h.checked_at) FROM server_health_snapshots h WHERE h.server_id=s.id ORDER BY h.checked_at DESC LIMIT 1),'{}'::jsonb))
		FROM operations o JOIN ai_models m ON m.id=o.model_id JOIN servers s ON s.id=o.server_id WHERE o.id=$1 AND o.workspace_id=$2 AND o.status='summarizing'`, id, workspaceID).Scan(&threadID, &modelID, &model.BaseURL, &model.ExternalID, &ciphertext, &languageCode, &input.Title, &input.Plan, &input.Note, &input.Request, &input.Server)
	if err == nil && len(ciphertext) > 0 {
		model.APIKey, err = decryptModelAPIKey(s.cfg.modelKeyEncryptionKey, ciphertext)
	}
	if err == nil {
		rows, queryErr := s.db.Query(ctx, `SELECT description,COALESCE(exit_code,0),stdout,stderr FROM operation_steps WHERE operation_id=$1 AND status IN ('succeeded','failed') ORDER BY position`, id)
		if queryErr != nil {
			err = queryErr
		} else {
			for rows.Next() {
				var step summaryOperationStep
				if scanErr := rows.Scan(&step.Description, &step.ExitCode, &step.Stdout, &step.Stderr); scanErr != nil {
					err = scanErr
					break
				}
				input.Steps = append(input.Steps, step)
			}
			if err == nil {
				err = rows.Err()
			}
			rows.Close()
		}
	}
	input = boundSummaryInput(input)
	var pending strings.Builder
	flush := func() {
		if pending.Len() == 0 {
			return
		}
		chunk := redactSummaryOutput(pending.String())
		pending.Reset()
		if strings.TrimSpace(chunk) != "" {
			dbCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = insertOperationEvent(dbCtx, s.db, id, "assistant.delta", uuid.Nil, map[string]any{"chunk": chunk})
			cancel()
		}
	}
	onDelta := func(chunk string) {
		pending.WriteString(chunk)
		if pending.Len() >= 256 {
			flush()
		}
	}
	var content string
	var usage plannerUsage
	if err == nil {
		err = s.requireWorkspaceTokenQuota(ctx, workspaceID)
	}
	if err == nil {
		requestCtx, cancel := context.WithTimeout(ctx, s.cfg.modelRequestTimeout)
		content, usage, err = requestOpenAISummary(requestCtx, &http.Client{Timeout: s.cfg.modelRequestTimeout}, model, s.cfg.modelAllowedOrigins, languageCode, input, onDelta)
		cancel()
	}
	if ctx.Err() != nil {
		return
	}
	if err != nil {
		pending.Reset()
		content = summaryFallback(languageCode)
		onDelta(content)
		flush()
		s.persistOperationSummary(id, workspaceID, threadID, modelID, content, plannerUsage{}, true)
		return
	}
	flush()
	s.persistOperationSummary(id, workspaceID, threadID, modelID, redactSummaryOutput(content), usage, false)
}

func summaryFallback(languageCode string) string {
	if languageCode == "id" {
		return "Pemeriksaan teknis selesai, tetapi ringkasan AI tidak tersedia. Tinjau output terminal untuk melihat hasil setiap langkah."
	}
	return "Technical checks completed, but the AI summary is unavailable. Review terminal output for each step's results."
}

func (s *server) persistOperationSummary(id, workspaceID, threadID, modelID uuid.UUID, content string, usage plannerUsage, failed bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	messageID := uuid.New()
	var replyToMessageID uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM chat_messages WHERE operation_id=$1 AND role='user' ORDER BY sequence LIMIT 1`, id).Scan(&replyToMessageID)
	if err != nil {
		return
	}
	tag, err := tx.Exec(ctx, `UPDATE operations SET status='succeeded',error='',finished_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status='summarizing'`, id, workspaceID)
	if err != nil || tag.RowsAffected() != 1 {
		return
	}
	var messageSequence int64
	err = tx.QueryRow(ctx, `INSERT INTO chat_messages(id,thread_id,operation_id,reply_to_message_id,role,kind,sequence,content,model_id,input_tokens,output_tokens) VALUES($1,$2,$3,$4,'assistant','result',nextval('chat_message_global_sequence'),$5,$6,$7,$8) RETURNING sequence`, messageID, threadID, id, replyToMessageID, content, modelID, usage.InputTokens, usage.OutputTokens).Scan(&messageSequence)
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO token_usage(id,workspace_id,thread_id,operation_id,message_id,phase,model_id,input_tokens,output_tokens,total_tokens,period_start) VALUES($1,$2,$3,$4,$5,'summary',$6,$7::bigint,$8::bigint,$7::bigint+$8::bigint,date_trunc('month',now())::date)`, uuid.New(), workspaceID, threadID, id, messageID, modelID, usage.InputTokens, usage.OutputTokens)
	}
	if err == nil {
		event := "summary.completed"
		payload := map[string]any{"message_id": messageID, "input_tokens": usage.InputTokens, "output_tokens": usage.OutputTokens}
		if failed {
			event = "summary.failed"
			payload = map[string]any{"message_id": messageID}
		}
		err = insertOperationEvent(ctx, tx, id, event, uuid.Nil, payload)
	}
	if err == nil {
		err = insertOperationEvent(ctx, tx, id, "completed", uuid.Nil, map[string]any{"status": "succeeded"})
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE chat_threads SET updated_at=now() WHERE id=$1`, threadID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		log.Printf("operation %s summary persistence failed: %v", id, err)
		_, _ = s.db.Exec(context.Background(), `UPDATE operations SET status='succeeded',error='AI summary persistence failed',finished_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status='summarizing'`, id, workspaceID)
		_ = insertOperationEvent(context.Background(), s.db, id, "summary.failed", uuid.Nil, map[string]any{"chunk": summaryFallback("en")})
		_ = insertOperationEvent(context.Background(), s.db, id, "completed", uuid.Nil, map[string]any{"status": "succeeded"})
	}
}

func (s *server) runOperationStep(parent context.Context, client *ssh.Client, opID uuid.UUID, step operationStepResponse, total int) error {
	var policy string
	if err := s.db.QueryRow(parent, `SELECT policy FROM operations WHERE id=$1`, opID).Scan(&policy); err != nil {
		return err
	}
	command, err := serializeOperationCommand(policy, step.Executable, step.Args)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(parent, `UPDATE operation_steps SET status='running',started_at=now(),updated_at=now() WHERE id=$1 AND status='pending'`, step.ID)
	if err != nil {
		return err
	}
	_ = insertOperationEvent(parent, s.db, opID, "step.started", step.ID, map[string]any{"position": step.Position, "total": total, "description": step.Description})
	timeout := 20 * time.Second
	if policy == "autonomous_full_access" {
		timeout = 5 * time.Minute
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	session, err := client.NewSession()
	if err != nil {
		s.failRunningStep(step.ID, "SSH session unavailable")
		return err
	}
	defer session.Close()
	stdout := newEventBuffer(s, opID, step.ID, "stdout")
	stderr := newEventBuffer(s, opID, step.ID, "stderr")
	session.Stdout = stdout
	session.Stderr = stderr
	done := make(chan error, 1)
	go func() { done <- session.Run(command) }()
	err = waitSSHCommand(ctx, session, done)
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
		s.failRunningStep(step.ID, "step result could not be stored")
		return dbErr
	}
	_ = insertOperationEvent(context.Background(), s.db, opID, "step.completed", step.ID, map[string]any{"position": step.Position, "total": total, "status": status, "exit_code": exitCode, "output_truncated": stdout.Truncated() || stderr.Truncated()})
	return err
}

func (s *server) failRunningStep(id uuid.UUID, message string) {
	_, _ = s.db.Exec(context.Background(), `UPDATE operation_steps SET status='failed',exit_code=-1,stderr=$2,finished_at=now(),updated_at=now() WHERE id=$1 AND status='running'`, id, message)
}

func serializeOperationCommand(policy, executable string, args []string) (string, error) {
	if policy == "unrestricted_approval" || policy == "autonomous_full_access" {
		if executable != "sh" || len(args) != 2 || args[0] != "-lc" || strings.TrimSpace(args[1]) == "" || len(args[1]) > 4000 || strings.ContainsRune(args[1], 0) {
			return "", errors.New("invalid unrestricted command")
		}
		return "'sh' '-lc' " + shellQuote(args[1]), nil
	}
	return shellQuoteCommand(executable, args)
}

func waitSSHCommand(ctx context.Context, session *ssh.Session, done <-chan error) error {
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		_ = session.Close()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
		return ctx.Err()
	}
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
			raw, _ := json.Marshal(e.envelope())
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
	ID        int64
	Type      string
	StepID    *uuid.UUID
	CreatedAt time.Time
	Payload   json.RawMessage
}

func (e operationEventDTO) envelope() map[string]any {
	out := map[string]any{}
	_ = json.Unmarshal(e.Payload, &out)
	out["id"] = e.ID
	out["event_type"] = e.Type
	out["created_at"] = e.CreatedAt
	if e.StepID != nil {
		out["step_id"] = *e.StepID
	} else {
		out["step_id"] = nil
	}
	return out
}

func (s *server) loadEvents(ctx context.Context, opID, workspaceID uuid.UUID, last int64) ([]operationEventDTO, bool, bool, error) {
	rows, err := s.db.Query(ctx, `SELECT e.id,e.event_type,e.step_id,e.created_at,e.payload FROM operation_events e JOIN operations o ON o.id=e.operation_id WHERE e.operation_id=$1 AND o.workspace_id=$2 AND e.id>$3 ORDER BY e.id LIMIT 201`, opID, workspaceID, last)
	if err != nil {
		return nil, false, false, err
	}
	defer rows.Close()
	out := []operationEventDTO{}
	for rows.Next() {
		var e operationEventDTO
		if rows.Scan(&e.ID, &e.Type, &e.StepID, &e.CreatedAt, &e.Payload) != nil {
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
