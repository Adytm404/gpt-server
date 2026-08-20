package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type modelResponse struct {
	ID                   uuid.UUID `json:"id"`
	ModelID              string    `json:"model_id"`
	Name                 string    `json:"name"`
	Provider             string    `json:"provider"`
	BaseURL              string    `json:"base_url"`
	ContextWindow        int       `json:"context_window"`
	Status               string    `json:"status"`
	Fallback             bool      `json:"fallback"`
	CredentialConfigured bool      `json:"credential_configured"`
	CredentialRef        *string   `json:"credential_ref,omitempty"`
}

const modelColumns = `id,external_model_id,name,provider,base_url,context_window,status,is_fallback,credential_configured,credential_ref`

func (s *server) adminRoutes(r chi.Router) {
	r.Get("/models", s.listModels)
	r.With(s.requireMutation).Post("/models", s.createModel)
	r.Get("/models/{id}", s.getModel)
	r.With(s.requireMutation).Patch("/models/{id}", s.updateModel)
	r.With(s.requireMutation).Delete("/models/{id}", s.deleteModel)
	r.With(s.requireMutation).Post("/models/{id}/fallback", s.fallbackModel)
	r.With(s.requireMutation).Post("/models/{id}/enable", s.setModelEnabled(true))
	r.With(s.requireMutation).Post("/models/{id}/disable", s.setModelEnabled(false))
	r.Get("/plans", s.listPlans)
	r.With(s.requireMutation).Post("/plans", s.createPlan)
	r.Get("/plans/{id}", s.getPlan)
	r.With(s.requireMutation).Post("/plans/{id}/draft", s.createPlanDraft)
	r.With(s.requireMutation).Patch("/plans/{id}/draft", s.updatePlanDraft)
	r.With(s.requireMutation).Post("/plans/{id}/publish", s.publishPlan)
	r.With(s.requireMutation).Post("/plans/{id}/archive", s.archivePlan)
	r.With(s.requireMutation).Post("/plans/{id}/duplicate", s.duplicatePlan)
	r.Get("/plans/{id}/preview", s.previewPlan)
	r.Get("/history", s.history)
}

func scanModel(row pgx.Row) (modelResponse, error) {
	var m modelResponse
	err := row.Scan(&m.ID, &m.ModelID, &m.Name, &m.Provider, &m.BaseURL, &m.ContextWindow, &m.Status, &m.Fallback, &m.CredentialConfigured, &m.CredentialRef)
	return m, err
}
func (s *server) listModels(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT `+modelColumns+` FROM ai_models ORDER BY created_at`)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer rows.Close()
	out := []modelResponse{}
	for rows.Next() {
		m, e := scanModel(rows)
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"models": out})
}
func (s *server) getModel(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	m, err := scanModel(s.db.QueryRow(r.Context(), `SELECT `+modelColumns+` FROM ai_models WHERE id=$1`, id))
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, m)
}
func (s *server) createModel(w http.ResponseWriter, r *http.Request) {
	var in modelInput
	if decodeJSON(r, &in) != nil || validateModelInput(in) != nil {
		s.writeError(w, r, 400, "invalid model fields")
		return
	}
	configured := strings.TrimSpace(in.CredentialRef) != ""
	ref := strings.TrimSpace(in.CredentialRef)
	id := uuid.New()
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	m, err := scanModel(tx.QueryRow(r.Context(), `INSERT INTO ai_models(id,external_model_id,name,provider,base_url,context_window,credential_configured,credential_ref) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')) RETURNING `+modelColumns, id, in.ModelID, strings.TrimSpace(in.Name), strings.TrimSpace(in.Provider), strings.TrimSpace(in.BaseURL), in.ContextWindow, configured, ref))
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "models", "Model created", id, m.Name, nil)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 201, m)
}
func (s *server) updateModel(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	var in modelInput
	if decodeJSON(r, &in) != nil || validateModelInput(in) != nil {
		s.writeError(w, r, 400, "invalid model fields")
		return
	}
	configured := strings.TrimSpace(in.CredentialRef) != ""
	ref := strings.TrimSpace(in.CredentialRef)
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	m, err := scanModel(tx.QueryRow(r.Context(), `UPDATE ai_models SET external_model_id=$2,name=$3,provider=$4,base_url=$5,context_window=$6,credential_configured=CASE WHEN $7 THEN true ELSE credential_configured END,credential_ref=CASE WHEN $7 THEN NULLIF($8,'') ELSE credential_ref END,updated_at=now() WHERE id=$1 RETURNING `+modelColumns, id, in.ModelID, strings.TrimSpace(in.Name), strings.TrimSpace(in.Provider), strings.TrimSpace(in.BaseURL), in.ContextWindow, configured, ref))
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "models", "Model updated", id, m.Name, nil)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, m)
}
func (s *server) deleteModel(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	var name string
	err = tx.QueryRow(r.Context(), `DELETE FROM ai_models WHERE id=$1 AND NOT is_fallback RETURNING name`, id).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		var fallback bool
		if e := tx.QueryRow(r.Context(), `SELECT is_fallback FROM ai_models WHERE id=$1`, id).Scan(&fallback); e == nil && fallback {
			s.writeError(w, r, http.StatusConflict, "assign another fallback before deleting this model")
			return
		}
		s.writeError(w, r, 404, "not found")
		return
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "models", "Model deleted", id, name, nil)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	w.WriteHeader(204)
}
func (s *server) fallbackModel(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	var name string
	if err = tx.QueryRow(r.Context(), `SELECT name FROM ai_models WHERE id=$1 AND status='active' FOR UPDATE`, id).Scan(&name); err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE ai_models SET is_fallback=(id=$1),updated_at=now() WHERE is_fallback OR id=$1`, id)
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "models", "Fallback changed", id, name, nil)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	w.WriteHeader(204)
}
func (s *server) setModelEnabled(enabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := s.pathUUID(w, r)
		if !ok {
			return
		}
		status, action := "disabled", "Model disabled"
		if enabled {
			status, action = "active", "Model enabled"
		}
		tx, err := s.db.Begin(r.Context())
		if err != nil {
			s.dbError(w, r, err)
			return
		}
		defer tx.Rollback(r.Context())
		var name string
		var fallback bool
		err = tx.QueryRow(r.Context(), `SELECT name,is_fallback FROM ai_models WHERE id=$1 FOR UPDATE`, id).Scan(&name, &fallback)
		if err == nil && !enabled && fallback {
			s.writeError(w, r, http.StatusConflict, "assign another fallback before disabling this model")
			return
		}
		if err == nil && !enabled {
			var used bool
			err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM subscription_plan_revisions p LEFT JOIN plan_allowed_models pam ON pam.revision_id=p.id WHERE p.status='published' AND (p.default_model_id=$1 OR p.fallback_model_id=$1 OR pam.model_id=$1))`, id).Scan(&used)
			if err == nil && used {
				s.writeError(w, r, http.StatusConflict, "model is referenced by a published plan")
				return
			}
		}
		if err == nil {
			_, err = tx.Exec(r.Context(), `UPDATE ai_models SET status=$2,updated_at=now() WHERE id=$1`, id, status)
		}
		if err == nil {
			err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "models", action, id, name, nil)
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			s.dbError(w, r, err)
			return
		}
		w.WriteHeader(204)
	}
}

func (s *server) pathUUID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		s.writeError(w, r, 400, "invalid id")
		return uuid.Nil, false
	}
	return id, true
}
func (s *server) dbError(w http.ResponseWriter, r *http.Request, err error) {
	log.Printf("database error: %v", err)
	status := databaseErrorStatus(err)
	message := "database error"
	if status == http.StatusNotFound {
		message = "not found"
	} else if status == http.StatusConflict {
		message = "resource conflict"
	}
	s.writeError(w, r, status, message)
}

func databaseErrorStatus(err error) int {
	if errors.Is(err, pgx.ErrNoRows) {
		return http.StatusNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && (pgErr.Code == "23503" || pgErr.Code == "23505") {
		return http.StatusConflict
	}
	return http.StatusInternalServerError
}

type auditExecer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func insertAudit(ctx context.Context, db auditExecer, actorID uuid.UUID, eventType, action string, targetID uuid.UUID, targetName string, metadata any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	_, err := db.Exec(ctx, `INSERT INTO audit_events(id,actor_user_id,event_type,action,target_id,target_name,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)`, uuid.New(), actorID, eventType, action, targetID, targetName, metadata)
	return err
}
