package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
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
	r.Get("/workspaces", s.listAdminWorkspaces)
	r.Get("/workspaces/{workspaceID}/ai-config", s.getWorkspaceAIConfig)
	r.With(s.requireMutation).Post("/workspaces/{workspaceID}/ai-config", s.setWorkspaceAIConfig)
	r.With(s.requireMutation).Patch("/workspaces/{workspaceID}/ai-config", s.setWorkspaceAIConfig)
	r.Get("/models", s.listModels)
	r.With(s.requireMutation).Post("/models", s.createModel)
	r.With(s.requireMutation).Post("/models/test", s.testDraftModel)
	r.Get("/models/{id}", s.getModel)
	r.With(s.requireMutation).Patch("/models/{id}", s.updateModel)
	r.With(s.requireMutation).Delete("/models/{id}", s.deleteModel)
	r.With(s.requireMutation).Post("/models/{id}/test", s.testSavedModel)
	r.With(s.requireMutation).Post("/models/{id}/fallback", s.fallbackModel)
	r.With(s.requireMutation).Post("/models/{id}/enable", s.setModelEnabled(true))
	r.With(s.requireMutation).Post("/models/{id}/disable", s.setModelEnabled(false))
	r.Get("/auth-settings/google", s.getAdminGoogleOAuth)
	r.With(s.requireMutation).Post("/auth-settings/google", s.setAdminGoogleOAuth)
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
	var encrypted []byte
	var err error
	if strings.TrimSpace(in.APIKey) != "" {
		encrypted, err = encryptModelAPIKey(s.cfg.modelKeyEncryptionKey, in.APIKey)
		if err != nil {
			s.writeError(w, r, http.StatusInternalServerError, "MODEL_KEY_ENCRYPTION_KEY must be configured as base64-encoded 32 bytes to save api_key")
			return
		}
	}
	configured := len(encrypted) != 0 || strings.TrimSpace(in.CredentialRef) != ""
	ref := strings.TrimSpace(in.CredentialRef)
	id := uuid.New()
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	m, err := scanModel(tx.QueryRow(r.Context(), `INSERT INTO ai_models(id,external_model_id,name,provider,base_url,context_window,credential_configured,credential_ref,api_key_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),$9) RETURNING `+modelColumns, id, in.ModelID, strings.TrimSpace(in.Name), strings.TrimSpace(in.Provider), strings.TrimSpace(in.BaseURL), in.ContextWindow, configured, ref, encrypted))
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
	var encrypted []byte
	keyProvided := strings.TrimSpace(in.APIKey) != ""
	if keyProvided {
		var err error
		encrypted, err = encryptModelAPIKey(s.cfg.modelKeyEncryptionKey, in.APIKey)
		if err != nil {
			s.writeError(w, r, http.StatusInternalServerError, "MODEL_KEY_ENCRYPTION_KEY must be configured as base64-encoded 32 bytes to save api_key")
			return
		}
	}
	ref := strings.TrimSpace(in.CredentialRef)
	refProvided := ref != ""
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	var currentBaseURL string
	if err = tx.QueryRow(r.Context(), `SELECT base_url FROM ai_models WHERE id=$1 FOR UPDATE`, id).Scan(&currentBaseURL); err != nil {
		s.dbError(w, r, err)
		return
	}
	originChanged := modelOriginChanged(currentBaseURL, in.BaseURL)
	m, err := scanModel(tx.QueryRow(r.Context(), `UPDATE ai_models SET external_model_id=$2,name=$3,provider=$4,base_url=$5,context_window=$6,api_key_ciphertext=CASE WHEN $7 THEN $8 WHEN $11 THEN NULL ELSE api_key_ciphertext END,credential_ref=CASE WHEN $9 THEN NULLIF($10,'') WHEN $11 THEN NULL ELSE credential_ref END,credential_configured=(CASE WHEN $7 THEN $8 WHEN $11 THEN NULL ELSE api_key_ciphertext END IS NOT NULL OR CASE WHEN $9 THEN NULLIF($10,'') WHEN $11 THEN NULL ELSE credential_ref END IS NOT NULL),updated_at=now() WHERE id=$1 RETURNING `+modelColumns, id, in.ModelID, strings.TrimSpace(in.Name), strings.TrimSpace(in.Provider), strings.TrimSpace(in.BaseURL), in.ContextWindow, keyProvided, encrypted, refProvided, ref, originChanged))
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

func modelOriginChanged(oldURL, newURL string) bool {
	oldOrigin, oldErr := normalizedURLOrigin(oldURL)
	newOrigin, newErr := normalizedURLOrigin(newURL)
	return oldErr != nil || newErr != nil || oldOrigin != newOrigin
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

type modelTestResponse struct {
	Status    string `json:"status"`
	LatencyMS int64  `json:"latency_ms"`
	Model     string `json:"model"`
	Endpoint  string `json:"endpoint"`
}

type modelProviderError struct {
	ProviderStatus int
	Message        string
}

func (e *modelProviderError) Error() string { return e.Message }

func (s *server) testDraftModel(w http.ResponseWriter, r *http.Request) {
	var in modelInput
	if decodeJSON(r, &in) != nil || validateModelInput(in) != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid model fields")
		return
	}
	s.runModelTest(w, r, in)
}

func (s *server) testSavedModel(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	var in modelInput
	var ciphertext []byte
	err := s.db.QueryRow(r.Context(), `SELECT name,provider,external_model_id,base_url,context_window,api_key_ciphertext,COALESCE(credential_ref,'') FROM ai_models WHERE id=$1`, id).Scan(&in.Name, &in.Provider, &in.ModelID, &in.BaseURL, &in.ContextWindow, &ciphertext, &in.CredentialRef)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	if len(ciphertext) != 0 {
		in.APIKey, err = decryptModelAPIKey(s.cfg.modelKeyEncryptionKey, ciphertext)
		if err != nil {
			s.writeError(w, r, http.StatusInternalServerError, "model API key cannot be decrypted; check MODEL_KEY_ENCRYPTION_KEY")
			return
		}
	}
	s.runModelTest(w, r, in)
}

func (s *server) runModelTest(w http.ResponseWriter, r *http.Request, in modelInput) {
	client := &http.Client{Timeout: 15 * time.Second}
	result, err := testOpenAIConnection(r.Context(), client, in)
	if err == nil {
		s.writeJSON(w, http.StatusOK, result)
		return
	}
	providerStatus := 0
	message := "provider connection failed"
	var providerErr *modelProviderError
	if errors.As(err, &providerErr) {
		providerStatus = providerErr.ProviderStatus
		message = providerErr.Message
	}
	s.writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": message, "provider_status": providerStatus, "request_id": middleware.GetReqID(r.Context())})
}

func testOpenAIConnection(ctx context.Context, client *http.Client, in modelInput) (modelTestResponse, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(in.BaseURL), "/") + "/chat/completions"
	payload := map[string]any{"model": in.ModelID, "messages": []map[string]string{{"role": "user", "content": "Reply with OK"}}, "max_tokens": 1, "stream": false}
	body, err := json.Marshal(payload)
	if err != nil {
		return modelTestResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(body)))
	if err != nil {
		return modelTestResponse{}, &modelProviderError{Message: "invalid provider endpoint"}
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(in.APIKey) != "" {
		req.Header.Set("Authorization", "Bearer "+in.APIKey)
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	started := time.Now()
	resp, err := clientCopy.Do(req)
	latency := time.Since(started).Milliseconds()
	if err != nil {
		return modelTestResponse{}, &modelProviderError{Message: "provider request failed"}
	}
	defer resp.Body.Close()
	limited, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes+1))
	if err != nil {
		return modelTestResponse{}, &modelProviderError{ProviderStatus: resp.StatusCode, Message: "provider response could not be read"}
	}
	if len(limited) > maxBodyBytes {
		return modelTestResponse{}, &modelProviderError{ProviderStatus: resp.StatusCode, Message: "provider response exceeded 1MB"}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return modelTestResponse{}, &modelProviderError{ProviderStatus: resp.StatusCode, Message: sanitizeProviderError(limited, in.APIKey, resp.Status)}
	}
	var parsed struct {
		Choices []json.RawMessage `json:"choices"`
	}
	if err := json.Unmarshal(limited, &parsed); err != nil {
		return modelTestResponse{}, &modelProviderError{ProviderStatus: resp.StatusCode, Message: "provider returned invalid JSON"}
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(limited, &object) != nil || object["choices"] == nil || parsed.Choices == nil {
		return modelTestResponse{}, &modelProviderError{ProviderStatus: resp.StatusCode, Message: "provider response missing choices array"}
	}
	return modelTestResponse{Status: "ok", LatencyMS: latency, Model: in.ModelID, Endpoint: endpoint}, nil
}

func sanitizeProviderError(body []byte, apiKey, fallback string) string {
	message := ""
	var parsed struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
	}
	if json.Unmarshal(body, &parsed) == nil {
		message = parsed.Message
		if len(parsed.Error) != 0 {
			var nested struct {
				Message string `json:"message"`
			}
			if json.Unmarshal(parsed.Error, &nested) == nil && nested.Message != "" {
				message = nested.Message
			}
		}
	}
	if message == "" {
		message = fallback
	}
	message = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, message)
	if apiKey != "" {
		message = strings.ReplaceAll(message, apiKey, "[REDACTED]")
	}
	if len(message) > 500 {
		message = message[:500]
	}
	return message
}

func encryptModelAPIKey(encodedKey, plaintext string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil || len(key) != 32 {
		return nil, errors.New("MODEL_KEY_ENCRYPTION_KEY must be base64-encoded 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

func decryptModelAPIKey(encodedKey string, ciphertext []byte) (string, error) {
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil || len(key) != 32 {
		return "", errors.New("MODEL_KEY_ENCRYPTION_KEY must be base64-encoded 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(ciphertext) < gcm.NonceSize() {
		return "", errors.New("invalid model API key ciphertext")
	}
	plaintext, err := gcm.Open(nil, ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("invalid model API key ciphertext")
	}
	return string(plaintext), nil
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
