package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type planResponse struct {
	ID               uuid.UUID   `json:"id"`
	RevisionID       uuid.UUID   `json:"revision_id"`
	Revision         int         `json:"revision"`
	Name             string      `json:"name"`
	Slug             string      `json:"slug"`
	Description      string      `json:"description"`
	PriceCents       int         `json:"price_cents"`
	AnnualPriceCents int         `json:"annual_price_cents"`
	Status           string      `json:"status"`
	MaxWorkspaces    int         `json:"max_workspaces"`
	MaxServers       int         `json:"max_servers"`
	MonthlyTokens    int64       `json:"monthly_tokens"`
	InputTokens      int         `json:"input_tokens"`
	OutputTokens     int         `json:"output_tokens"`
	OverLimit        string      `json:"over_limit"`
	DefaultModelID   uuid.UUID   `json:"default_model_id"`
	FallbackModelID  uuid.UUID   `json:"fallback_model_id"`
	AllowedModelIDs  []uuid.UUID `json:"allowed_model_ids"`
	Features         []string    `json:"features"`
	Visibility       string      `json:"visibility"`
	Subscribers      int         `json:"subscribers"`
}

const planSelect = `SELECT p.plan_id,p.id,p.revision,p.name,p.slug,p.description,p.price_cents,p.annual_price_cents,p.status,p.max_workspaces,p.max_servers,p.monthly_tokens,p.input_tokens,p.output_tokens,p.over_limit,p.default_model_id,p.fallback_model_id,COALESCE((SELECT array_agg(model_id ORDER BY model_id) FROM plan_allowed_models WHERE revision_id=p.id),'{}'),p.features,p.visibility,p.subscribers FROM subscription_plan_revisions p`

func scanPlan(row pgx.Row) (planResponse, error) {
	var p planResponse
	var features []byte
	err := row.Scan(&p.ID, &p.RevisionID, &p.Revision, &p.Name, &p.Slug, &p.Description, &p.PriceCents, &p.AnnualPriceCents, &p.Status, &p.MaxWorkspaces, &p.MaxServers, &p.MonthlyTokens, &p.InputTokens, &p.OutputTokens, &p.OverLimit, &p.DefaultModelID, &p.FallbackModelID, &p.AllowedModelIDs, &features, &p.Visibility, &p.Subscribers)
	if err == nil {
		err = json.Unmarshal(features, &p.Features)
	}
	return p, err
}
func (s *server) listPlans(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), planSelect+` JOIN (SELECT DISTINCT ON (plan_id) id FROM subscription_plan_revisions WHERE status IN ('draft','published') ORDER BY plan_id,(status='draft') DESC) effective ON effective.id=p.id ORDER BY p.created_at`)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer rows.Close()
	out := []planResponse{}
	for rows.Next() {
		p, e := scanPlan(rows)
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, map[string]any{"plans": out})
}
func (s *server) getPlan(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	p, err := scanPlan(s.db.QueryRow(r.Context(), planSelect+` WHERE p.plan_id=$1 AND p.status IN ('draft','published') ORDER BY (p.status='draft') DESC LIMIT 1`, id))
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, p)
}
func (s *server) previewPlan(w http.ResponseWriter, r *http.Request) { s.getPlan(w, r) }
func (s *server) createPlan(w http.ResponseWriter, r *http.Request) {
	var in planRevisionInput
	if decodeJSON(r, &in) != nil || validatePlanInput(in) != nil {
		s.writeError(w, r, 400, "invalid plan fields")
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	if err = validateActiveModels(r.Context(), tx, in.AllowedModelIDs); err != nil {
		s.writeError(w, r, 400, err.Error())
		return
	}
	planID, revisionID := uuid.New(), uuid.New()
	_, err = tx.Exec(r.Context(), `INSERT INTO subscription_plans(id,slug) VALUES($1,$2)`, planID, in.Slug)
	if err == nil {
		err = insertRevision(r.Context(), tx, revisionID, planID, 1, "draft", in)
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "plans", "Plan created", planID, in.Name, nil)
	}
	var p planResponse
	if err == nil {
		p, err = scanPlan(tx.QueryRow(r.Context(), planSelect+` WHERE p.id=$1`, revisionID))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 201, p)
}
func (s *server) createPlanDraft(w http.ResponseWriter, r *http.Request) {
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
	var revID uuid.UUID
	var revision int
	var name string
	err = tx.QueryRow(r.Context(), `SELECT id,revision+1,name FROM subscription_plan_revisions WHERE plan_id=$1 AND status='published' FOR UPDATE`, id).Scan(&revID, &revision, &name)
	if err == nil {
		newID := uuid.New()
		err = tx.QueryRow(r.Context(), `INSERT INTO subscription_plan_revisions(id,plan_id,revision,name,slug,description,price_cents,annual_price_cents,status,max_workspaces,max_servers,monthly_tokens,input_tokens,output_tokens,over_limit,default_model_id,fallback_model_id,features,visibility,subscribers) SELECT $1,plan_id,$2,name,slug,description,price_cents,annual_price_cents,'draft',max_workspaces,max_servers,monthly_tokens,input_tokens,output_tokens,over_limit,default_model_id,fallback_model_id,features,visibility,subscribers FROM subscription_plan_revisions WHERE id=$3 RETURNING name`, newID, revision, revID).Scan(&name)
		if err == nil {
			_, err = tx.Exec(r.Context(), `INSERT INTO plan_allowed_models(revision_id,model_id) SELECT $1,model_id FROM plan_allowed_models WHERE revision_id=$2`, newID, revID)
		}
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "plans", "Draft created", id, name, nil)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.getPlan(w, r)
}
func (s *server) updatePlanDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	var in planRevisionInput
	if decodeJSON(r, &in) != nil || validatePlanInput(in) != nil {
		s.writeError(w, r, 400, "invalid plan fields")
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	if err = validateActiveModels(r.Context(), tx, in.AllowedModelIDs); err != nil {
		s.writeError(w, r, 400, err.Error())
		return
	}
	features, _ := json.Marshal(in.Features)
	var revID uuid.UUID
	var slug string
	if err = tx.QueryRow(r.Context(), `SELECT slug FROM subscription_plans WHERE id=$1 FOR UPDATE`, id).Scan(&slug); err == nil && !strings.EqualFold(slug, in.Slug) {
		s.writeError(w, r, http.StatusConflict, "plan slug cannot change")
		return
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	err = tx.QueryRow(r.Context(), `UPDATE subscription_plan_revisions SET name=$2,slug=$3,description=$4,price_cents=$5,annual_price_cents=$6,max_workspaces=$7,max_servers=$8,monthly_tokens=$9,input_tokens=$10,output_tokens=$11,over_limit=$12,default_model_id=$13,fallback_model_id=$14,features=$15,visibility=$16,updated_at=now() WHERE plan_id=$1 AND status='draft' RETURNING id`, id, in.Name, in.Slug, in.Description, in.PriceCents, in.AnnualPriceCents, in.MaxWorkspaces, in.MaxServers, in.MonthlyTokens, in.InputTokens, in.OutputTokens, in.OverLimit, in.DefaultModelID, in.FallbackModelID, features, in.Visibility).Scan(&revID)
	if err == nil {
		_, err = tx.Exec(r.Context(), `DELETE FROM plan_allowed_models WHERE revision_id=$1`, revID)
	}
	if err == nil {
		err = insertAllowed(r.Context(), tx, revID, in.AllowedModelIDs)
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "plans", "Draft updated", id, in.Name, nil)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.getPlan(w, r)
}
func (s *server) publishPlan(w http.ResponseWriter, r *http.Request) {
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
	var revID uuid.UUID
	var name string
	err = tx.QueryRow(r.Context(), `SELECT id,name FROM subscription_plan_revisions WHERE plan_id=$1 AND status='draft' FOR UPDATE`, id).Scan(&revID, &name)
	if err == nil {
		err = validateRevisionActiveModels(r.Context(), tx, revID)
		if errors.Is(err, errInactiveModels) {
			s.writeError(w, r, http.StatusBadRequest, "all allowed models must be active")
			return
		}
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE subscription_plan_revisions SET status='archived',updated_at=now() WHERE plan_id=$1 AND status='published'`, id)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE subscription_plan_revisions SET status='published',updated_at=now() WHERE id=$1`, revID)
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "plans", "Plan published", id, name, nil)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, map[string]string{"status": "published"})
}
func (s *server) archivePlan(w http.ResponseWriter, r *http.Request) {
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
	err = tx.QueryRow(r.Context(), `WITH changed AS (UPDATE subscription_plan_revisions SET status='archived',updated_at=now() WHERE plan_id=$1 AND status IN ('draft','published') RETURNING name,status) SELECT name FROM changed ORDER BY (status='published') DESC LIMIT 1`, id).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		s.writeError(w, r, 404, "not found")
		return
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "plans", "Plan archived", id, name, nil)
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
func (s *server) duplicatePlan(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	source, err := scanPlan(s.db.QueryRow(r.Context(), planSelect+` WHERE p.plan_id=$1 AND p.status IN ('draft','published') ORDER BY (p.status='draft') DESC LIMIT 1`, id))
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	in := planRevisionInput{Name: source.Name + " Copy", Slug: fmt.Sprintf("%s-copy-%s", source.Slug, strings.ToLower(uuid.NewString()[:6])), Description: source.Description, PriceCents: source.PriceCents, AnnualPriceCents: source.AnnualPriceCents, MaxWorkspaces: source.MaxWorkspaces, MaxServers: source.MaxServers, MonthlyTokens: source.MonthlyTokens, InputTokens: source.InputTokens, OutputTokens: source.OutputTokens, OverLimit: source.OverLimit, DefaultModelID: source.DefaultModelID, FallbackModelID: source.FallbackModelID, AllowedModelIDs: source.AllowedModelIDs, Features: source.Features, Visibility: source.Visibility}
	newPlan, newRev := uuid.New(), uuid.New()
	tx, err := s.db.Begin(r.Context())
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO subscription_plans(id,slug) VALUES($1,$2)`, newPlan, in.Slug)
	}
	if err == nil {
		err = insertRevision(r.Context(), tx, newRev, newPlan, 1, "draft", in)
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "plans", "Draft duplicated", newPlan, in.Name, map[string]any{"source_plan_id": id})
	}
	var p planResponse
	if err == nil {
		p, err = scanPlan(tx.QueryRow(r.Context(), planSelect+` WHERE p.id=$1`, newRev))
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
	s.writeJSON(w, 201, p)
}
func (s *server) listPublicPlans(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), planSelect+` WHERE p.status='published' AND p.visibility='public' ORDER BY p.price_cents`)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer rows.Close()
	out := []planResponse{}
	for rows.Next() {
		p, e := scanPlan(rows)
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, map[string]any{"plans": out})
}

func insertRevision(ctx context.Context, tx pgx.Tx, revisionID, planID uuid.UUID, revision int, status string, in planRevisionInput) error {
	features, _ := json.Marshal(in.Features)
	_, err := tx.Exec(ctx, `INSERT INTO subscription_plan_revisions(id,plan_id,revision,name,slug,description,price_cents,annual_price_cents,status,max_workspaces,max_servers,monthly_tokens,input_tokens,output_tokens,over_limit,default_model_id,fallback_model_id,features,visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`, revisionID, planID, revision, in.Name, in.Slug, in.Description, in.PriceCents, in.AnnualPriceCents, status, in.MaxWorkspaces, in.MaxServers, in.MonthlyTokens, in.InputTokens, in.OutputTokens, in.OverLimit, in.DefaultModelID, in.FallbackModelID, features, in.Visibility)
	if err == nil {
		err = insertAllowed(ctx, tx, revisionID, in.AllowedModelIDs)
	}
	return err
}
func insertAllowed(ctx context.Context, tx pgx.Tx, revisionID uuid.UUID, ids []uuid.UUID) error {
	for _, id := range ids {
		if _, err := tx.Exec(ctx, `INSERT INTO plan_allowed_models(revision_id,model_id) VALUES($1,$2)`, revisionID, id); err != nil {
			return err
		}
	}
	return nil
}
func validateActiveModels(ctx context.Context, tx pgx.Tx, ids []uuid.UUID) error {
	rows, err := tx.Query(ctx, `SELECT id FROM ai_models WHERE id=ANY($1) AND status='active' FOR SHARE`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		count++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if count != len(ids) {
		return fmt.Errorf("all allowed models must exist and be active")
	}
	return nil
}

var errInactiveModels = errors.New("inactive models")

func validateRevisionActiveModels(ctx context.Context, tx pgx.Tx, revisionID uuid.UUID) error {
	rows, err := tx.Query(ctx, `SELECT m.status FROM plan_allowed_models pam JOIN ai_models m ON m.id=pam.model_id WHERE pam.revision_id=$1 FOR SHARE OF m`, revisionID)
	if err != nil {
		return err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var status string
		if err := rows.Scan(&status); err != nil {
			return err
		}
		count++
		if status != "active" {
			return errInactiveModels
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if count == 0 {
		return errInactiveModels
	}
	return nil
}

func (s *server) history(w http.ResponseWriter, r *http.Request) {
	args := []any{}
	where := []string{"true"}
	if v := strings.TrimSpace(r.URL.Query().Get("type")); v != "" {
		args = append(args, strings.ToLower(v))
		where = append(where, fmt.Sprintf("event_type=$%d", len(args)))
	}
	if v := strings.TrimSpace(r.URL.Query().Get("query")); v != "" {
		args = append(args, "%"+v+"%")
		where = append(where, fmt.Sprintf("(action ILIKE $%d OR target_name ILIKE $%d)", len(args), len(args)))
	}
	rows, err := s.db.Query(r.Context(), `SELECT a.id,a.event_type,a.action,a.target_id,a.target_name,COALESCE(u.full_name,'System'),a.metadata,a.created_at FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id WHERE `+strings.Join(where, " AND ")+` ORDER BY a.created_at DESC LIMIT 200`, args...)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id uuid.UUID
		var typ, action, target, actor string
		var targetID *uuid.UUID
		var metadata json.RawMessage
		var created any
		if err := rows.Scan(&id, &typ, &action, &targetID, &target, &actor, &metadata, &created); err != nil {
			s.dbError(w, r, err)
			return
		}
		out = append(out, map[string]any{"id": id, "type": typ, "action": action, "target_id": targetID, "target_name": target, "actor": actor, "metadata": metadata, "created_at": created})
	}
	if err := rows.Err(); err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, map[string]any{"events": out})
}
