package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

type failingAuditExecer struct{ err error }

func (f failingAuditExecer) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, f.err
}

func TestValidateServerInput(t *testing.T) {
	valid := serverInput{Name: "Production API", Host: "api.example.com", Port: 22, SSHUser: "deploy", Environment: "production", Region: "us-east-1", HostFingerprint: "SHA256:abcdefghijklmnop"}
	if err := validateServerInput(valid); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}
	cases := []serverInput{
		{Name: "x", Host: "https://example.com", Port: 22, SSHUser: "deploy", Environment: "production"},
		{Name: "x", Host: "example.com", Port: 0, SSHUser: "deploy", Environment: "production"},
		{Name: "x", Host: "example.com", Port: 22, SSHUser: "root;rm", Environment: "production"},
		{Name: "x", Host: "example.com", Port: 22, SSHUser: "deploy", Environment: "prod"},
		{Name: "x", Host: "example.com", Port: 22, SSHUser: "deploy", Environment: "production", HostFingerprint: "md5:bad"},
	}
	for _, in := range cases {
		if err := validateServerInput(in); err == nil {
			t.Errorf("invalid input accepted: %+v", in)
		}
	}
}

func TestValidateModelInput(t *testing.T) {
	valid := modelInput{Name: "GPT", Provider: "OpenAI", ModelID: "gpt-5", ContextWindow: 128000}
	for _, baseURL := range []string{"https://api.openai.com/v1", "http://localhost:11434/v1"} {
		valid.BaseURL = baseURL
		if err := validateModelInput(valid); err != nil {
			t.Errorf("valid base_url %q rejected: %v", baseURL, err)
		}
	}
	for _, baseURL := range []string{
		"javascript:alert(1)",
		"/v1",
		"https://user:password@example.com/v1",
		"https://example.com/v1?api=1",
		"https://example.com/v1#models",
		"",
		"   ",
	} {
		valid.BaseURL = baseURL
		if err := validateModelInput(valid); err == nil {
			t.Errorf("invalid base_url %q accepted", baseURL)
		}
	}
	if err := validateModelInput(modelInput{Name: "", Provider: "OpenAI", ModelID: "gpt-5", BaseURL: "https://api.openai.com/v1", ContextWindow: 1}); err == nil {
		t.Fatal("empty name accepted")
	}
	if err := validateModelInput(modelInput{Name: "GPT", Provider: "OpenAI", ModelID: "bad model", BaseURL: "https://api.openai.com/v1", ContextWindow: 1}); err == nil {
		t.Fatal("invalid external model ID accepted")
	}
	if err := validateModelInput(modelInput{Name: "GPT", Provider: "OpenAI", ModelID: "gpt-5", BaseURL: "https://api.openai.com/v1", ContextWindow: 1, APIKey: "secret"}); err == nil {
		t.Fatal("api_key accepted without secure storage")
	}
	if err := validateModelInput(modelInput{Name: "GPT", Provider: "OpenAI", ModelID: "gpt-5", BaseURL: "https://api.openai.com/v1", ContextWindow: 1, CredentialRef: "vault://models/gpt"}); err != nil {
		t.Fatalf("credential_ref rejected: %v", err)
	}
}

func TestModelCreatePayloadNeedsOnlyEditableFields(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/models", strings.NewReader(`{
		"name":"GPT 5 mini","provider":"OpenAI","model_id":"gpt-5-mini","base_url":"https://api.openai.com/v1","context_window":128000
	}`))
	var in modelInput
	if err := decodeJSON(req, &in); err != nil {
		t.Fatal(err)
	}
	if err := validateModelInput(in); err != nil {
		t.Fatal(err)
	}
	if in.Name != "GPT 5 mini" || in.BaseURL != "https://api.openai.com/v1" || in.APIKey != "" || in.CredentialRef != "" {
		t.Fatalf("decoded payload = %+v", in)
	}
}

func TestModelResponseIncludesBaseURL(t *testing.T) {
	encoded, err := json.Marshal(modelResponse{BaseURL: "http://localhost:11434/v1"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"base_url":"http://localhost:11434/v1"`) {
		t.Fatalf("response missing base_url: %s", encoded)
	}
}

func TestLegacySyntheticFieldsAreNotSerialized(t *testing.T) {
	modelJSON, err := json.Marshal(modelResponse{})
	if err != nil {
		t.Fatal(err)
	}
	planJSON, err := json.Marshal(planResponse{})
	if err != nil {
		t.Fatal(err)
	}
	for field, encoded := range map[string][]byte{
		"last_test_latency_ms": modelJSON,
		"subscribers":          planJSON,
	} {
		if strings.Contains(string(encoded), field) {
			t.Errorf("response exposes legacy field %q: %s", field, encoded)
		}
	}
}

func TestModelTestRouteIsUnavailable(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}, resolveSession: func(context.Context, string) (sessionAuth, error) {
		return sessionAuth{UserID: uuid.New(), WorkspaceID: uuid.New(), PlatformRole: "admin", WorkspaceRole: "owner"}, nil
	}}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/models/10000000-0000-4000-8000-000000000001/test", nil)
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("X-CSRF-Token", "token")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: "opaque"})
	req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "token"})
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("model test route status = %d, want 404 or 405; body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"stub"`) {
		t.Fatalf("model test response retains stub field: %s", rec.Body.String())
	}
}

func TestValidatePlanInput(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	valid := planRevisionInput{Name: "Control", Slug: "control", PriceCents: 5900, AnnualPriceCents: 4700, MaxWorkspaces: 3, MaxServers: 15, MonthlyTokens: 1000, InputTokens: 100, OutputTokens: 50, OverLimit: "allow_with_warning", Visibility: "public", AllowedModelIDs: []uuid.UUID{a, b}, DefaultModelID: a, FallbackModelID: b}
	if err := validatePlanInput(valid); err != nil {
		t.Fatal(err)
	}
	valid.PriceCents = -1
	if err := validatePlanInput(valid); err == nil {
		t.Fatal("negative cents accepted")
	}
	valid.PriceCents = 1
	valid.DefaultModelID = uuid.New()
	if err := validatePlanInput(valid); err == nil {
		t.Fatal("default model outside allowlist accepted")
	}
}

func TestEncryptPrivateKey(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	encoded := base64.StdEncoding.EncodeToString(key)
	ciphertext, err := encryptPrivateKey(encoded, "private key")
	if err != nil || len(ciphertext) <= len("private key") {
		t.Fatalf("encryption failed: len=%d err=%v", len(ciphertext), err)
	}
	if _, err := encryptPrivateKey("bad", "private key"); err == nil {
		t.Fatal("invalid encryption key accepted")
	}
}

func TestServerResponseNeverSerializesPrivateKey(t *testing.T) {
	encoded, err := json.Marshal(serverResponse{ID: uuid.New(), Name: "API", CredentialConfigured: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"private_key", "ciphertext", "encrypted_private_key"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("response leaks %q: %s", forbidden, encoded)
		}
	}
}

func TestServerSummaryUsesBackendStatuses(t *testing.T) {
	got := summarizeServers([]serverResponse{{Status: "online"}, {Status: "offline"}, {Status: "unknown"}, {Status: "online"}})
	want := map[string]int{"total": 4, "online": 2, "offline": 1, "unknown": 1}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("summary = %#v, want %#v", got, want)
	}
}

func TestLatestSnapshotResponseContract(t *testing.T) {
	captured := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)
	encoded, err := json.Marshal(serverResponse{LatestSnapshot: &healthSnapshotResponse{Status: "online", LatencyMS: 12, CPUPercent: 0, MemoryPercent: 0, DiskPercent: 0, CapturedAt: captured}})
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"latest_snapshot"`, `"disk_percent":0`, `"captured_at":"2026-08-20T12:00:00Z"`} {
		if !strings.Contains(string(encoded), field) {
			t.Fatalf("snapshot response missing %s: %s", field, encoded)
		}
	}
}

func TestDatabaseErrorStatus(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want int
	}{
		{&pgconn.PgError{Code: "23503"}, http.StatusConflict},
		{&pgconn.PgError{Code: "23505"}, http.StatusConflict},
		{errors.New("boom"), http.StatusInternalServerError},
	} {
		if got := databaseErrorStatus(tc.err); got != tc.want {
			t.Errorf("databaseErrorStatus(%v) = %d, want %d", tc.err, got, tc.want)
		}
	}
}

func TestInsertAuditPropagatesFailure(t *testing.T) {
	want := errors.New("audit insert failed")
	err := insertAudit(context.Background(), failingAuditExecer{err: want}, uuid.New(), "plans", "Plan published", uuid.New(), "Control", nil)
	if !errors.Is(err, want) {
		t.Fatalf("insertAudit error = %v, want %v", err, want)
	}
}

func TestRolePermissions(t *testing.T) {
	for _, tc := range []struct {
		role, action string
		want         bool
	}{{"owner", "delete", true}, {"operator", "update", true}, {"operator", "delete", false}, {"viewer", "read", true}, {"viewer", "test", false}, {"unknown", "read", false}} {
		if got := workspaceCan(tc.role, tc.action); got != tc.want {
			t.Errorf("workspaceCan(%q, %q) = %v, want %v", tc.role, tc.action, got, tc.want)
		}
	}
}

func TestProtectedRouteAuthenticationAndAuthorization(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}}
	h := s.routes()

	unauthorized := httptest.NewRecorder()
	h.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/api/v1/servers", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", unauthorized.Code)
	}

	s.resolveSession = func(context.Context, string) (sessionAuth, error) {
		return sessionAuth{UserID: uuid.New(), WorkspaceID: uuid.New(), PlatformRole: "user", WorkspaceRole: "owner"}, nil
	}
	forbidden := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/models", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: "opaque"})
	s.routes().ServeHTTP(forbidden, req)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("non-admin status = %d body=%s", forbidden.Code, forbidden.Body.String())
	}
}

func TestMutationRequiresOriginAndDoubleSubmitCSRF(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}, resolveSession: func(context.Context, string) (sessionAuth, error) {
		return sessionAuth{UserID: uuid.New(), WorkspaceID: uuid.New(), PlatformRole: "user", WorkspaceRole: "owner"}, nil
	}}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers", strings.NewReader(`{}`))
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: "opaque"})
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing origin status = %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/servers", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("X-CSRF-Token", "different")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: "opaque"})
	req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "token"})
	rec = httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("mismatched csrf status = %d", rec.Code)
	}
}
