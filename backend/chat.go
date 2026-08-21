package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type chatThreadResponse struct {
	ID         uuid.UUID `json:"id"`
	ServerID   uuid.UUID `json:"server_id"`
	ServerName string    `json:"server_name"`
	CreatedBy  uuid.UUID `json:"created_by"`
	Title      string    `json:"title"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type chatMessageResponse struct {
	ID               uuid.UUID  `json:"id"`
	ThreadID         uuid.UUID  `json:"thread_id"`
	Role             string     `json:"role"`
	Kind             string     `json:"kind"`
	OperationID      *uuid.UUID `json:"operation_id,omitempty"`
	ReplyToMessageID *uuid.UUID `json:"reply_to_message_id,omitempty"`
	Sequence         int64      `json:"sequence"`
	Content          string     `json:"content"`
	ModelID          *uuid.UUID `json:"model_id,omitempty"`
	InputTokens      int64      `json:"input_tokens"`
	OutputTokens     int64      `json:"output_tokens"`
	CreatedAt        time.Time  `json:"created_at"`
}

type operationResponse struct {
	ID, ThreadID, ServerID, CreatedBy, ModelID    uuid.UUID
	Status, Policy, Risk, Title, Summary, Error   string
	ApprovedBy, RejectedBy                        *uuid.UUID
	ApprovedAt, RejectedAt, StartedAt, FinishedAt *time.Time
	CreatedAt, UpdatedAt                          time.Time
	AgentRound                                    int
	Steps                                         []operationStepResponse
}

func (o operationResponse) MarshalJSON() ([]byte, error) {
	type dto struct {
		ID         uuid.UUID               `json:"id"`
		ThreadID   uuid.UUID               `json:"thread_id"`
		ServerID   uuid.UUID               `json:"server_id"`
		CreatedBy  uuid.UUID               `json:"created_by"`
		ModelID    uuid.UUID               `json:"model_id"`
		Status     string                  `json:"status"`
		Policy     string                  `json:"policy"`
		Risk       string                  `json:"risk"`
		Title      string                  `json:"title"`
		Summary    string                  `json:"summary"`
		Error      string                  `json:"error,omitempty"`
		ApprovedBy *uuid.UUID              `json:"approved_by,omitempty"`
		RejectedBy *uuid.UUID              `json:"rejected_by,omitempty"`
		ApprovedAt *time.Time              `json:"approved_at,omitempty"`
		RejectedAt *time.Time              `json:"rejected_at,omitempty"`
		StartedAt  *time.Time              `json:"started_at,omitempty"`
		FinishedAt *time.Time              `json:"finished_at,omitempty"`
		CreatedAt  time.Time               `json:"created_at"`
		UpdatedAt  time.Time               `json:"updated_at"`
		AgentRound int                     `json:"agent_round"`
		Steps      []operationStepResponse `json:"steps"`
	}
	return json.Marshal(dto{ID: o.ID, ThreadID: o.ThreadID, ServerID: o.ServerID, CreatedBy: o.CreatedBy, ModelID: o.ModelID, Status: o.Status, Policy: o.Policy, Risk: o.Risk, Title: o.Title, Summary: o.Summary, Error: o.Error, ApprovedBy: o.ApprovedBy, RejectedBy: o.RejectedBy, ApprovedAt: o.ApprovedAt, RejectedAt: o.RejectedAt, StartedAt: o.StartedAt, FinishedAt: o.FinishedAt, CreatedAt: o.CreatedAt, UpdatedAt: o.UpdatedAt, AgentRound: o.AgentRound, Steps: o.Steps})
}

type operationStepResponse struct {
	ID          uuid.UUID  `json:"id"`
	Position    int        `json:"position"`
	Description string     `json:"description"`
	Executable  string     `json:"executable"`
	Args        []string   `json:"args"`
	Status      string     `json:"status"`
	ExitCode    *int       `json:"exit_code,omitempty"`
	Stdout      string     `json:"stdout"`
	Stderr      string     `json:"stderr"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	FinishedAt  *time.Time `json:"finished_at,omitempty"`
}

type workspaceAIConfig struct {
	WorkspaceID       uuid.UUID  `json:"workspace_id"`
	PlanRevisionID    *uuid.UUID `json:"plan_revision_id,omitempty"`
	DefaultModelID    *uuid.UUID `json:"default_model_id,omitempty"`
	MonthlyTokenLimit int64      `json:"monthly_token_limit"`
	ModelStatus       *string    `json:"model_status,omitempty"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

func (s *server) chatRoutes(r chi.Router) {
	r.Get("/config", s.getChatConfig)
	r.Get("/threads", s.listChatThreads)
	r.With(s.requireMutation).Post("/threads", s.requireWorkspaceAction("operate", s.createChatThread))
	r.Get("/threads/{id}", s.getChatThread)
	r.With(s.requireMutation).Patch("/threads/{id}", s.requireWorkspaceAction("operate", s.updateChatThread))
	r.With(s.requireMutation).Delete("/threads/{id}", s.requireWorkspaceAction("operate", s.deleteChatThread))
	r.Get("/threads/{id}/messages", s.listChatMessages)
	r.With(s.requireMutation).Post("/threads/{id}/messages", s.requireWorkspaceAction("operate", s.createChatMessage))
}

func scanThread(row pgx.Row) (chatThreadResponse, error) {
	var x chatThreadResponse
	err := row.Scan(&x.ID, &x.ServerID, &x.ServerName, &x.CreatedBy, &x.Title, &x.Status, &x.CreatedAt, &x.UpdatedAt)
	return x, err
}

func (s *server) listChatThreads(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT t.id,t.server_id,s.name,t.created_by,t.title,t.status,t.created_at,t.updated_at FROM chat_threads t JOIN servers s ON s.id=t.server_id WHERE t.workspace_id=$1 ORDER BY t.updated_at DESC`, authFrom(r.Context()).WorkspaceID)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer rows.Close()
	out := []chatThreadResponse{}
	for rows.Next() {
		x, e := scanThread(rows)
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		out = append(out, x)
	}
	if err := rows.Err(); err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, map[string]any{"threads": out})
}

func (s *server) createChatThread(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ServerID uuid.UUID `json:"server_id"`
		Title    string    `json:"title"`
	}
	if decodeJSON(r, &in) != nil || in.ServerID == uuid.Nil || len(in.Title) > 200 {
		s.writeError(w, r, 400, "invalid thread fields")
		return
	}
	a := authFrom(r.Context())
	id := uuid.New()
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	x, err := scanThread(tx.QueryRow(r.Context(), `WITH inserted AS (INSERT INTO chat_threads(id,workspace_id,server_id,created_by,title) SELECT $1,$2,id,$3,$4 FROM servers WHERE id=$5 AND workspace_id=$2 AND deleted_at IS NULL RETURNING *) SELECT t.id,t.server_id,s.name,t.created_by,t.title,t.status,t.created_at,t.updated_at FROM inserted t JOIN servers s ON s.id=t.server_id`, id, a.WorkspaceID, a.UserID, strings.TrimSpace(in.Title), in.ServerID))
	if err == nil {
		err = insertAudit(r.Context(), tx, a.UserID, "chat", "Chat thread created", id, x.Title, map[string]any{"server_id": in.ServerID})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 201, x)
}

func (s *server) getChatThread(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	x, err := scanThread(s.db.QueryRow(r.Context(), `SELECT t.id,t.server_id,s.name,t.created_by,t.title,t.status,t.created_at,t.updated_at FROM chat_threads t JOIN servers s ON s.id=t.server_id WHERE t.id=$1 AND t.workspace_id=$2`, id, authFrom(r.Context()).WorkspaceID))
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, x)
}

func (s *server) updateChatThread(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	var in chatThreadPatch
	if decodeJSON(r, &in) != nil || validateChatThreadPatch(in) != nil {
		s.writeError(w, r, 400, "invalid thread fields")
		return
	}
	a := authFrom(r.Context())
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	var title any
	if in.Title != nil {
		title = strings.TrimSpace(*in.Title)
	}
	status := patchThreadStatus(in)
	x, err := scanThread(tx.QueryRow(r.Context(), `WITH changed AS (UPDATE chat_threads SET title=COALESCE($3,title),status=COALESCE($4,status),updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING *) SELECT t.id,t.server_id,s.name,t.created_by,t.title,t.status,t.created_at,t.updated_at FROM changed t JOIN servers s ON s.id=t.server_id`, id, a.WorkspaceID, title, status))
	if err == nil {
		err = insertAudit(r.Context(), tx, a.UserID, "chat", "Chat thread updated", id, x.Title, map[string]any{"status": x.Status})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, x)
}

type chatThreadPatch struct {
	Title    *string `json:"title"`
	Status   *string `json:"status"`
	Archived *bool   `json:"archived"`
}

func validateChatThreadPatch(in chatThreadPatch) error {
	if in.Title == nil && in.Status == nil && in.Archived == nil {
		return errors.New("empty patch")
	}
	if in.Title != nil && len(*in.Title) > 200 {
		return errors.New("title too long")
	}
	if in.Status != nil && *in.Status != "active" && *in.Status != "archived" {
		return errors.New("invalid status")
	}
	if in.Status != nil && in.Archived != nil && (*in.Status == "archived") != *in.Archived {
		return errors.New("conflicting status")
	}
	return nil
}

func patchThreadStatus(in chatThreadPatch) any {
	if in.Status != nil {
		return *in.Status
	}
	if in.Archived != nil && *in.Archived {
		return "archived"
	}
	if in.Archived != nil {
		return "active"
	}
	return nil
}

func (s *server) deleteChatThread(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM chat_threads t WHERE t.id=$1 AND t.workspace_id=$2 AND NOT EXISTS (SELECT 1 FROM operations o WHERE o.thread_id=t.id AND o.status IN ('planning','pending_approval','approved','running','summarizing'))`, id, authFrom(r.Context()).WorkspaceID)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		_ = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM chat_threads WHERE id=$1 AND workspace_id=$2)`, id, authFrom(r.Context()).WorkspaceID).Scan(&exists)
		if exists {
			s.writeError(w, r, http.StatusConflict, "thread has an active operation")
			return
		}
		s.writeError(w, r, http.StatusNotFound, "not found")
		return
	}
	w.WriteHeader(204)
}

func (s *server) listChatMessages(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT m.id,m.thread_id,m.role,m.kind,m.operation_id,m.reply_to_message_id,m.sequence,m.content,m.model_id,m.input_tokens,m.output_tokens,m.created_at FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id WHERE m.thread_id=$1 AND t.workspace_id=$2 ORDER BY m.sequence`, id, authFrom(r.Context()).WorkspaceID)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer rows.Close()
	out := []chatMessageResponse{}
	for rows.Next() {
		var x chatMessageResponse
		if err := rows.Scan(&x.ID, &x.ThreadID, &x.Role, &x.Kind, &x.OperationID, &x.ReplyToMessageID, &x.Sequence, &x.Content, &x.ModelID, &x.InputTokens, &x.OutputTokens, &x.CreatedAt); err != nil {
			s.dbError(w, r, err)
			return
		}
		out = append(out, x)
	}
	if err := rows.Err(); err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, map[string]any{"messages": out})
}

type resolvedPlanner struct {
	ID   uuid.UUID
	Name string
	plannerModel
	MonthlyLimit, Used int64
}

type plannerQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *server) resolvePlanner(ctx context.Context, workspaceID uuid.UUID) (resolvedPlanner, error) {
	return s.resolvePlannerWith(ctx, s.db, workspaceID)
}

func (s *server) resolvePlannerWith(ctx context.Context, db plannerQuerier, workspaceID uuid.UUID) (resolvedPlanner, error) {
	var x resolvedPlanner
	var ciphertext []byte
	err := db.QueryRow(ctx, `SELECT m.id,m.name,m.base_url,m.external_model_id,m.api_key_ciphertext,ws.monthly_token_limit,COALESCE((SELECT sum(total_tokens) FROM token_usage WHERE workspace_id=ws.workspace_id AND period_start=date_trunc('month',now())::date),0) FROM workspace_subscriptions ws JOIN ai_models m ON m.id=COALESCE(ws.default_model_id,(SELECT default_model_id FROM subscription_plan_revisions WHERE id=ws.plan_revision_id AND status='published')) WHERE ws.workspace_id=$1 AND m.status='active'`, workspaceID).Scan(&x.ID, &x.Name, &x.BaseURL, &x.ExternalID, &ciphertext, &x.MonthlyLimit, &x.Used)
	if err != nil {
		return x, err
	}
	if x.MonthlyLimit <= 0 {
		return x, errNoEntitlement
	}
	if x.Used >= x.MonthlyLimit {
		return x, errQuotaExceeded
	}
	if len(ciphertext) > 0 {
		x.APIKey, err = decryptModelAPIKey(s.cfg.modelKeyEncryptionKey, ciphertext)
	}
	return x, err
}

var errNoEntitlement = errors.New("workspace AI is not configured")
var errQuotaExceeded = errors.New("monthly token quota exceeded")

type chatConfigResponse struct {
	Configured        bool       `json:"configured"`
	ModelID           *uuid.UUID `json:"model_id,omitempty"`
	ModelName         string     `json:"model_name,omitempty"`
	MonthlyTokenLimit int64      `json:"monthly_token_limit"`
	UsedTokens        int64      `json:"used_tokens"`
}

func (s *server) getChatConfig(w http.ResponseWriter, r *http.Request) {
	model, err := s.resolvePlanner(r.Context(), authFrom(r.Context()).WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, errNoEntitlement) {
		s.writeJSON(w, http.StatusOK, chatConfigResponse{})
		return
	}
	if err != nil && !errors.Is(err, errQuotaExceeded) {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, chatConfigResponse{Configured: true, ModelID: &model.ID, ModelName: model.Name, MonthlyTokenLimit: model.MonthlyLimit, UsedTokens: model.Used})
}

func (s *server) createChatMessage(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Content string `json:"content"`
		Policy  string `json:"policy"`
	}
	if decodeJSON(r, &in) != nil || validateChatContent(in.Content) != nil || !validChatPolicy(in.Policy) {
		s.writeError(w, r, 422, "request is outside permitted server management scope")
		return
	}
	a := authFrom(r.Context())
	threadID, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	if !s.planningLimiter.allow(planningRateKey(a.UserID, a.WorkspaceID), time.Now()) {
		s.writeError(w, r, 429, "too many planning requests")
		return
	}
	var serverID uuid.UUID
	var serverUpdatedAt time.Time
	var serverContext map[string]any
	err := s.db.QueryRow(r.Context(), `SELECT t.server_id,s.updated_at,jsonb_build_object('name',s.name,'environment',s.environment,'region',s.region,'operating_system',s.operating_system,'uptime_seconds',s.uptime_seconds,'status',s.status,'last_checked_at',s.last_checked_at,'health',COALESCE((SELECT jsonb_build_object('status',h.status,'cpu_percent',h.cpu_percent,'memory_percent',h.memory_percent,'disk_percent',h.disk_percent,'services',h.services,'checked_at',h.checked_at) FROM server_health_snapshots h WHERE h.server_id=s.id ORDER BY h.checked_at DESC LIMIT 1),'{}'::jsonb)) FROM chat_threads t JOIN servers s ON s.id=t.server_id WHERE t.id=$1 AND t.workspace_id=$2 AND t.status='active' AND s.deleted_at IS NULL`, threadID, a.WorkspaceID).Scan(&serverID, &serverUpdatedAt, &serverContext)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	active, err := s.hasActiveOperation(r.Context(), threadID, a.WorkspaceID)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	localUnlock := s.lockPlanningWorkspace(a.WorkspaceID)
	defer localUnlock()
	conn, err := s.db.Acquire(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	if _, err = conn.Exec(r.Context(), `SELECT pg_advisory_lock(hashtextextended($1, 0))`, "chat-planning:"+a.WorkspaceID.String()); err != nil {
		conn.Release()
		s.dbError(w, r, err)
		return
	}
	connActive := true
	cleanupConn := func() {
		if !connActive {
			return
		}
		connActive = false
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, unlockErr := conn.Exec(ctx, `SELECT pg_advisory_unlock(hashtextextended($1, 0))`, "chat-planning:"+a.WorkspaceID.String()); unlockErr != nil {
			_ = conn.Conn().Close(context.Background())
		}
		conn.Release()
	}
	defer cleanupConn()
	model, err := s.resolvePlannerWith(r.Context(), conn, a.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, errNoEntitlement) {
		s.writeError(w, r, 409, "workspace AI is not configured")
		return
	}
	if errors.Is(err, errQuotaExceeded) {
		s.writeError(w, r, 429, err.Error())
		return
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	var history []chatHistoryMessage
	hRows, hErr := conn.Query(r.Context(), `SELECT role, content FROM (SELECT role, content, sequence FROM chat_messages WHERE thread_id=$1 ORDER BY sequence DESC LIMIT 10) sub ORDER BY sequence ASC`, threadID)
	if hErr == nil {
		defer hRows.Close()
		for hRows.Next() {
			var hRole, hContent string
			if hRows.Scan(&hRole, &hContent) == nil {
				history = append(history, chatHistoryMessage{Role: hRole, Content: hContent})
			}
		}
	}
	routeCtx, routeCancel := context.WithTimeout(r.Context(), s.cfg.modelRequestTimeout)
	route, routeUsage, routeErr := requestOpenAIIntent(routeCtx, &http.Client{Timeout: s.cfg.modelRequestTimeout}, model.plannerModel, in.Content, serverContext, history...)
	routeCancel()
	if routeErr != nil {
		log.Printf("chat intent routing failed request_id=%s: %v", middleware.GetReqID(r.Context()), routeErr)
		s.writeError(w, r, 502, "model could not route the request")
		return
	}
	intent := effectiveIntent(in.Policy, route.Intent)
	if intent == "reject" {
		s.writeError(w, r, 422, "request is outside permitted server management scope")
		return
	}
	if intent == "conversation" || (intent == "server_explanation" && route.Intent == "server_explanation") {
		s.persistRoutedResponse(w, r, conn, threadID, a.WorkspaceID, model, in.Content, route.Response, routeUsage)
		return
	}
	if intent == "server_explanation" {
		s.createExplanation(w, r, conn, threadID, a, model, in.Content, route.LanguageCode, serverContext, routeUsage, history)
		return
	}
	effectivePolicy := effectiveOperationPolicy(in.Policy, route.Intent)
	if active {
		s.writeError(w, r, http.StatusConflict, "thread already has an active operation")
		return
	}
	opID, msgID := uuid.New(), uuid.New()
	var msgSequence int64
	tx, err := conn.Begin(r.Context())
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO operations(id,thread_id,workspace_id,server_id,server_updated_at,created_by,model_id,status,policy,response_language) VALUES($1,$2,$3,$4,$5,$6,$7,'planning',$8,$9)`, opID, threadID, a.WorkspaceID, serverID, serverUpdatedAt, a.UserID, model.ID, effectivePolicy, route.LanguageCode)
	}
	if err == nil {
		err = tx.QueryRow(r.Context(), `INSERT INTO chat_messages(id,thread_id,operation_id,role,kind,sequence,content) VALUES($1,$2,$3,'user','chat',nextval('chat_message_global_sequence'),$4) RETURNING sequence`, msgID, threadID, opID, in.Content).Scan(&msgSequence)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO token_usage(id,workspace_id,thread_id,operation_id,message_id,phase,model_id,input_tokens,output_tokens,total_tokens,period_start) VALUES($1,$2,$3,$4,$5,'routing',$6,$7::bigint,$8::bigint,$7::bigint+$8::bigint,date_trunc('month',now())::date)`, uuid.New(), a.WorkspaceID, threadID, opID, msgID, model.ID, routeUsage.InputTokens, routeUsage.OutputTokens)
	}
	if err == nil {
		err = insertOperationEvent(r.Context(), tx, opID, "planning", uuid.Nil, map[string]any{"message_id": msgID})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	} else if tx != nil {
		_ = tx.Rollback(r.Context())
	}
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "operations_one_active_per_thread_idx" {
			s.writeError(w, r, http.StatusConflict, "thread already has an active operation")
			return
		}
		s.dbError(w, r, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.modelRequestTimeout)
	s.cancelMu.Lock()
	if s.operationCancels == nil {
		s.operationCancels = make(map[uuid.UUID]context.CancelFunc)
	}
	s.operationCancels[opID] = cancel
	s.cancelMu.Unlock()
	var plan operationPlan
	var usage plannerUsage
	var planErr error
	var totalPlanUsage plannerUsage
	for attempt := 0; attempt < 3; attempt++ {
		plan, usage, planErr = requestOpenAIPlan(ctx, &http.Client{Timeout: s.cfg.modelRequestTimeout}, model.plannerModel, route.LanguageCode, in.Content, serverContext, effectivePolicy, history)
		totalPlanUsage.InputTokens += usage.InputTokens
		totalPlanUsage.OutputTokens += usage.OutputTokens
		if planErr == nil || ctx.Err() != nil {
			break
		}
	}
	usage = totalPlanUsage
	cancel()
	s.cancelMu.Lock()
	delete(s.operationCancels, opID)
	s.cancelMu.Unlock()
	if planErr != nil {
		cleanupConn()
		s.failPlanning(opID, planErr.Error(), usage)
		s.writeError(w, r, 502, "model could not produce a safe operation plan")
		return
	}
	tx, err = conn.Begin(r.Context())
	assistantID := uuid.New()
	var assistantSequence int64
	plan.Title = redactOperationalOutput(plan.Title)
	plan.Summary = redactOperationalOutput(plan.Summary)
	for i := range plan.Steps {
		plan.Steps[i].Description = redactOperationalOutput(plan.Steps[i].Description)
	}
	assistantContent := plan.Summary
	initialStatus := "pending_approval"
	if effectivePolicy == "autonomous_full_access" {
		initialStatus = "approved"
	}
	if err == nil {
		var tag pgconn.CommandTag
		tag, err = tx.Exec(r.Context(), `UPDATE operations SET status=$2,title=$3,summary=$4,risk=$5,approved_by=CASE WHEN $2='approved' THEN created_by ELSE approved_by END,approved_at=CASE WHEN $2='approved' THEN now() ELSE approved_at END,updated_at=now() WHERE id=$1 AND workspace_id=$6 AND status='planning'`, opID, initialStatus, plan.Title, plan.Summary, plan.Risk, a.WorkspaceID)
		if err == nil && tag.RowsAffected() != 1 {
			err = errors.New("planning operation is no longer active")
		}
	}
	if err == nil {
		err = tx.QueryRow(r.Context(), `INSERT INTO chat_messages(id,thread_id,operation_id,reply_to_message_id,role,kind,sequence,content,model_id,input_tokens,output_tokens) VALUES($1,$2,$3,$4,'assistant','plan',nextval('chat_message_global_sequence'),$5,$6,$7,$8) RETURNING sequence`, assistantID, threadID, opID, msgID, assistantContent, model.ID, usage.InputTokens, usage.OutputTokens).Scan(&assistantSequence)
	}
	for i, step := range plan.Steps {
		if err != nil {
			break
		}
		args, _ := json.Marshal(step.Args)
		_, err = tx.Exec(r.Context(), `INSERT INTO operation_steps(id,operation_id,position,description,executable,args) VALUES($1,$2,$3,$4,$5,$6)`, uuid.New(), opID, i+1, step.Description, step.Executable, args)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO token_usage(id,workspace_id,thread_id,operation_id,message_id,phase,model_id,input_tokens,output_tokens,total_tokens,period_start) VALUES($1,$2,$3,$4,$5,'planning',$6,$7::bigint,$8::bigint,$7::bigint+$8::bigint,date_trunc('month',now())::date)`, uuid.New(), a.WorkspaceID, threadID, opID, assistantID, model.ID, usage.InputTokens, usage.OutputTokens)
	}
	if err == nil {
		err = insertOperationEvent(r.Context(), tx, opID, "plan_ready", uuid.Nil, map[string]any{"steps": len(plan.Steps), "input_tokens": usage.InputTokens, "output_tokens": usage.OutputTokens})
	}
	if err == nil && initialStatus == "approved" {
		err = insertOperationEvent(r.Context(), tx, opID, "approved", uuid.Nil, map[string]any{"mode": "autonomous_full_access"})
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE chat_threads SET updated_at=now() WHERE id=$1`, threadID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	} else if tx != nil {
		_ = tx.Rollback(r.Context())
	}
	if err != nil {
		cleanupConn()
		s.failPlanning(opID, "operation plan could not be stored")
		s.dbError(w, r, err)
		return
	}
	cleanupConn()
	if initialStatus == "approved" {
		go s.runOperation(opID, a.WorkspaceID)
	}
	op, err := s.loadOperation(r.Context(), opID, a.WorkspaceID)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 201, map[string]any{"message": chatMessageResponse{ID: assistantID, ThreadID: threadID, Role: "assistant", Kind: "plan", OperationID: &opID, ReplyToMessageID: &msgID, Sequence: assistantSequence, Content: assistantContent, ModelID: &model.ID, InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens}, "operation": op})
}

func validChatPolicy(policy string) bool {
	return policy == "approval_required" || policy == "explain_only" || policy == "unrestricted_approval" || policy == "autonomous_full_access"
}

func effectiveIntent(policy, routeIntent string) string {
	if policy == "approval_required" && routeIntent == "server_explanation" {
		return "server_operation"
	}
	if policy == "explain_only" && routeIntent == "server_operation" {
		return "server_explanation"
	}
	if policy == "explain_only" && routeIntent == "server_mutation" {
		return "server_explanation"
	}
	return routeIntent
}

func effectiveOperationPolicy(policy, routeIntent string) string {
	if policy == "autonomous_full_access" {
		return policy
	}
	if routeIntent == "server_mutation" && policy != "explain_only" {
		return "unrestricted_approval"
	}
	return policy
}

func (s *server) createExplanation(w http.ResponseWriter, r *http.Request, conn *pgxpool.Conn, threadID uuid.UUID, a sessionAuth, model resolvedPlanner, content, languageCode string, serverContext map[string]any, routeUsage plannerUsage, history []chatHistoryMessage) {
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.modelRequestTimeout)
	response, usage, err := requestOpenAIExplanation(ctx, &http.Client{Timeout: s.cfg.modelRequestTimeout}, model.plannerModel, languageCode, content, serverContext, history...)
	cancel()
	if err != nil {
		s.writeError(w, r, 502, "model could not explain the server snapshot")
		return
	}
	response = redactSummaryOutput(response)
	userID, assistantID := uuid.New(), uuid.New()
	var userSequence, assistantSequence int64
	tx, err := conn.Begin(r.Context())
	if err == nil {
		err = tx.QueryRow(r.Context(), `INSERT INTO chat_messages(id,thread_id,operation_id,role,kind,sequence,content) VALUES($1,$2,NULL,'user','chat',nextval('chat_message_global_sequence'),$3) RETURNING sequence`, userID, threadID, content).Scan(&userSequence)
	}
	if err == nil {
		err = tx.QueryRow(r.Context(), `INSERT INTO chat_messages(id,thread_id,operation_id,reply_to_message_id,role,kind,sequence,content,model_id,input_tokens,output_tokens) VALUES($1,$2,NULL,$3,'assistant','chat',nextval('chat_message_global_sequence'),$4,$5,$6,$7) RETURNING sequence`, assistantID, threadID, userID, response, model.ID, usage.InputTokens, usage.OutputTokens).Scan(&assistantSequence)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO token_usage(id,workspace_id,thread_id,operation_id,message_id,phase,model_id,input_tokens,output_tokens,total_tokens,period_start) VALUES($1,$2,$3,NULL,$4,'routing',$5,$6::bigint,$7::bigint,$6::bigint+$7::bigint,date_trunc('month',now())::date)`, uuid.New(), a.WorkspaceID, threadID, userID, model.ID, routeUsage.InputTokens, routeUsage.OutputTokens)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO token_usage(id,workspace_id,thread_id,operation_id,message_id,phase,model_id,input_tokens,output_tokens,total_tokens,period_start) VALUES($1,$2,$3,NULL,$4,'explain',$5,$6::bigint,$7::bigint,$6::bigint+$7::bigint,date_trunc('month',now())::date)`, uuid.New(), a.WorkspaceID, threadID, assistantID, model.ID, usage.InputTokens, usage.OutputTokens)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE chat_threads SET updated_at=now() WHERE id=$1 AND workspace_id=$2`, threadID, a.WorkspaceID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	} else if tx != nil {
		_ = tx.Rollback(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusCreated, map[string]any{"message": chatMessageResponse{ID: assistantID, ThreadID: threadID, Role: "assistant", Kind: "chat", ReplyToMessageID: &userID, Sequence: assistantSequence, Content: response, ModelID: &model.ID, InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens}, "operation": nil})
}

func (s *server) persistRoutedResponse(w http.ResponseWriter, r *http.Request, conn *pgxpool.Conn, threadID, workspaceID uuid.UUID, model resolvedPlanner, content, response string, usage plannerUsage) {
	userID, assistantID := uuid.New(), uuid.New()
	var userSequence, assistantSequence int64
	tx, err := conn.Begin(r.Context())
	if err == nil {
		var exists bool
		err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM chat_threads WHERE id=$1 AND workspace_id=$2 AND status='active')`, threadID, workspaceID).Scan(&exists)
		if err == nil && !exists {
			err = pgx.ErrNoRows
		}
	}
	if err == nil {
		err = tx.QueryRow(r.Context(), `INSERT INTO chat_messages(id,thread_id,operation_id,role,kind,sequence,content) VALUES($1,$2,NULL,'user','chat',nextval('chat_message_global_sequence'),$3) RETURNING sequence`, userID, threadID, content).Scan(&userSequence)
	}
	if err == nil {
		err = tx.QueryRow(r.Context(), `INSERT INTO chat_messages(id,thread_id,operation_id,reply_to_message_id,role,kind,sequence,content,model_id,input_tokens,output_tokens) VALUES($1,$2,NULL,$3,'assistant','chat',nextval('chat_message_global_sequence'),$4,$5,$6,$7) RETURNING sequence`, assistantID, threadID, userID, response, model.ID, usage.InputTokens, usage.OutputTokens).Scan(&assistantSequence)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO token_usage(id,workspace_id,thread_id,operation_id,message_id,phase,model_id,input_tokens,output_tokens,total_tokens,period_start) VALUES($1,$2,$3,NULL,$4,'routing',$5,$6::bigint,$7::bigint,$6::bigint+$7::bigint,date_trunc('month',now())::date)`, uuid.New(), workspaceID, threadID, assistantID, model.ID, usage.InputTokens, usage.OutputTokens)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE chat_threads SET updated_at=now() WHERE id=$1 AND workspace_id=$2`, threadID, workspaceID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	} else if tx != nil {
		_ = tx.Rollback(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusCreated, map[string]any{"message": chatMessageResponse{ID: assistantID, ThreadID: threadID, Role: "assistant", Kind: "chat", ReplyToMessageID: &userID, Sequence: assistantSequence, Content: response, ModelID: &model.ID, InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens}, "operation": nil})
}

func (s *server) failPlanning(id uuid.UUID, message string, usages ...plannerUsage) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	var workspaceID, threadID, modelID uuid.UUID
	if err = tx.QueryRow(ctx, `SELECT workspace_id,thread_id,model_id FROM operations WHERE id=$1 AND status='planning' FOR UPDATE`, id).Scan(&workspaceID, &threadID, &modelID); err != nil {
		return
	}
	if len(usages) > 0 && validUsage(usages[0]) {
		_, err = tx.Exec(ctx, `INSERT INTO token_usage(id,workspace_id,thread_id,operation_id,phase,model_id,input_tokens,output_tokens,total_tokens,period_start) VALUES($1,$2,$3,$4,'planning',$5,$6::bigint,$7::bigint,$6::bigint+$7::bigint,date_trunc('month',now())::date) ON CONFLICT DO NOTHING`, uuid.New(), workspaceID, threadID, id, modelID, usages[0].InputTokens, usages[0].OutputTokens)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE operations SET status='failed',error=$2,finished_at=now(),updated_at=now() WHERE id=$1 AND status='planning'`, id, message)
	}
	if err == nil {
		err = insertOperationEvent(ctx, tx, id, "failed", uuid.Nil, map[string]any{"error": "planning failed"})
	}
	if err == nil {
		_ = tx.Commit(ctx)
	}
}

func (s *server) hasActiveOperation(ctx context.Context, threadID, workspaceID uuid.UUID) (bool, error) {
	var active bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM operations WHERE thread_id=$1 AND workspace_id=$2 AND status IN ('planning','pending_approval','approved','running','summarizing'))`, threadID, workspaceID).Scan(&active)
	return active, err
}

func (s *server) lockPlanningWorkspace(workspaceID uuid.UUID) func() {
	s.planningMu.Lock()
	if s.planningLocks == nil {
		s.planningLocks = make(map[uuid.UUID]*sync.Mutex)
	}
	lock := s.planningLocks[workspaceID]
	if lock == nil {
		lock = &sync.Mutex{}
		s.planningLocks[workspaceID] = lock
	}
	s.planningMu.Unlock()
	lock.Lock()
	return lock.Unlock
}

func (s *server) listAdminWorkspaces(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT id,name,created_at FROM workspaces ORDER BY created_at`)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id uuid.UUID
		var name string
		var created time.Time
		if err := rows.Scan(&id, &name, &created); err != nil {
			s.dbError(w, r, err)
			return
		}
		out = append(out, map[string]any{"id": id, "name": name, "created_at": created})
	}
	if err := rows.Err(); err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, map[string]any{"workspaces": out})
}
func workspaceIDParam(r *http.Request) (uuid.UUID, error) {
	return uuid.Parse(chi.URLParam(r, "workspaceID"))
}
func (s *server) getWorkspaceAIConfig(w http.ResponseWriter, r *http.Request) {
	id, err := workspaceIDParam(r)
	if err != nil {
		s.writeError(w, r, 400, "invalid workspace id")
		return
	}
	var x workspaceAIConfig
	err = s.db.QueryRow(r.Context(), `SELECT ws.workspace_id,ws.plan_revision_id,ws.default_model_id,ws.monthly_token_limit,m.status,ws.updated_at FROM workspace_subscriptions ws LEFT JOIN ai_models m ON m.id=ws.default_model_id WHERE ws.workspace_id=$1`, id).Scan(&x.WorkspaceID, &x.PlanRevisionID, &x.DefaultModelID, &x.MonthlyTokenLimit, &x.ModelStatus, &x.UpdatedAt)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, x)
}
func (s *server) setWorkspaceAIConfig(w http.ResponseWriter, r *http.Request) {
	id, err := workspaceIDParam(r)
	if err != nil {
		s.writeError(w, r, 400, "invalid workspace id")
		return
	}
	var in struct {
		DefaultModelID    *uuid.UUID `json:"default_model_id"`
		MonthlyTokenLimit int64      `json:"monthly_token_limit"`
	}
	if decodeJSON(r, &in) != nil || in.DefaultModelID == nil || *in.DefaultModelID == uuid.Nil || in.MonthlyTokenLimit < 0 {
		s.writeError(w, r, 400, "invalid AI config")
		return
	}
	var x workspaceAIConfig
	err = s.db.QueryRow(r.Context(), `INSERT INTO workspace_subscriptions(workspace_id,default_model_id,monthly_token_limit) SELECT $1,m.id,$3 FROM ai_models m WHERE m.id=$2 AND m.status='active' ON CONFLICT(workspace_id) DO UPDATE SET default_model_id=EXCLUDED.default_model_id,monthly_token_limit=EXCLUDED.monthly_token_limit,updated_at=now() RETURNING workspace_id,plan_revision_id,default_model_id,monthly_token_limit,(SELECT status FROM ai_models WHERE id=default_model_id),updated_at`, id, *in.DefaultModelID, in.MonthlyTokenLimit).Scan(&x.WorkspaceID, &x.PlanRevisionID, &x.DefaultModelID, &x.MonthlyTokenLimit, &x.ModelStatus, &x.UpdatedAt)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, x)
}

type operationEventExecer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func insertOperationEvent(ctx context.Context, db operationEventExecer, opID uuid.UUID, event string, stepID uuid.UUID, payload any) error {
	raw, _ := json.Marshal(payload)
	var step any
	if stepID != uuid.Nil {
		step = stepID
	}
	_, err := db.Exec(ctx, `INSERT INTO operation_events(operation_id,event_type,step_id,payload) VALUES($1,$2,$3,$4)`, opID, event, step, string(raw))
	return err
}
