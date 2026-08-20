package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestModelAPIKeyEncryptionRoundTrip(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	encoded := base64.StdEncoding.EncodeToString(key)
	ciphertext, err := encryptModelAPIKey(encoded, "sk-secret")
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := decryptModelAPIKey(encoded, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != "sk-secret" {
		t.Fatalf("decrypted API key = %q", plaintext)
	}
	if _, err := encryptModelAPIKey("", "sk-secret"); err == nil || !strings.Contains(err.Error(), "MODEL_KEY_ENCRYPTION_KEY") {
		t.Fatalf("missing key error = %v", err)
	}
}

func TestModelResponseOmitsSecrets(t *testing.T) {
	encoded, err := json.Marshal(modelResponse{CredentialConfigured: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"api_key", "ciphertext", "sk-secret"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("model response leaks %q: %s", forbidden, encoded)
		}
	}
}

func TestOpenAIConnectionNoKeySuccess(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("Authorization = %q", got)
		}
		var body struct {
			Model    string `json:"model"`
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
			MaxTokens int `json:"max_tokens"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != "local-model" || len(body.Messages) != 1 || body.Messages[0].Content != "Reply with OK" || body.MaxTokens != 1 {
			t.Errorf("request body = %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"}}]}`))
	}))
	defer provider.Close()

	result, err := testOpenAIConnection(context.Background(), provider.Client(), modelInput{ModelID: "local-model", BaseURL: provider.URL + "/v1"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "ok" || result.Model != "local-model" || result.Endpoint != provider.URL+"/v1/chat/completions" || result.LatencyMS < 0 {
		t.Fatalf("result = %+v", result)
	}
}

func TestOpenAIConnectionBearerKeySuccess(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer sk-secret" {
			t.Errorf("Authorization = %q", got)
		}
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer provider.Close()

	_, err := testOpenAIConnection(context.Background(), provider.Client(), modelInput{ModelID: "model", BaseURL: provider.URL, APIKey: "sk-secret"})
	if err != nil {
		t.Fatal(err)
	}
}

func TestOpenAIConnectionProviderFailures(t *testing.T) {
	tests := []struct {
		name        string
		handler     http.HandlerFunc
		wantStatus  int
		wantMessage string
	}{
		{"provider error", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"invalid credential"}}`))
		}, http.StatusUnauthorized, "invalid credential"},
		{"invalid json", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`not json`)) }, http.StatusOK, "invalid JSON"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			provider := httptest.NewServer(tc.handler)
			defer provider.Close()
			_, err := testOpenAIConnection(context.Background(), provider.Client(), modelInput{ModelID: "model", BaseURL: provider.URL, APIKey: "secret-not-in-error"})
			var providerErr *modelProviderError
			if err == nil || !errors.As(err, &providerErr) {
				t.Fatalf("error = %T %v", err, err)
			}
			if providerErr.ProviderStatus != tc.wantStatus || !strings.Contains(providerErr.Message, tc.wantMessage) || strings.Contains(providerErr.Message, "secret-not-in-error") {
				t.Fatalf("provider error = %+v", providerErr)
			}
		})
	}
}

func TestOpenAIConnectionTimeout(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(100 * time.Millisecond)
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer provider.Close()
	client := provider.Client()
	client.Timeout = 10 * time.Millisecond
	_, err := testOpenAIConnection(context.Background(), client, modelInput{ModelID: "model", BaseURL: provider.URL})
	if err == nil {
		t.Fatal("timeout accepted")
	}
}

func TestDraftModelTestRouteAuthAndCSRF(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer provider.Close()
	payload := `{"name":"Local","provider":"OpenAI","model_id":"local","base_url":"` + provider.URL + `","context_window":4096}`

	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}}
	unauthenticated := httptest.NewRecorder()
	s.routes().ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodPost, "/api/v1/admin/models/test", strings.NewReader(payload)))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", unauthenticated.Code)
	}

	s.resolveSession = func(context.Context, string) (sessionAuth, error) {
		return sessionAuth{UserID: uuid.New(), WorkspaceID: uuid.New(), PlatformRole: "user", WorkspaceRole: "owner"}, nil
	}
	nonAdminReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/models/test", strings.NewReader(payload))
	nonAdminReq.AddCookie(&http.Cookie{Name: sessionCookie, Value: "opaque"})
	nonAdmin := httptest.NewRecorder()
	s.routes().ServeHTTP(nonAdmin, nonAdminReq)
	if nonAdmin.Code != http.StatusForbidden {
		t.Fatalf("non-admin status = %d", nonAdmin.Code)
	}

	s.resolveSession = func(context.Context, string) (sessionAuth, error) {
		return sessionAuth{UserID: uuid.New(), WorkspaceID: uuid.New(), PlatformRole: "admin", WorkspaceRole: "owner"}, nil
	}
	missingCSRFReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/models/test", strings.NewReader(payload))
	missingCSRFReq.AddCookie(&http.Cookie{Name: sessionCookie, Value: "opaque"})
	missingCSRF := httptest.NewRecorder()
	s.routes().ServeHTTP(missingCSRF, missingCSRFReq)
	if missingCSRF.Code != http.StatusForbidden {
		t.Fatalf("missing CSRF status = %d", missingCSRF.Code)
	}

	validReq := httptest.NewRequest(http.MethodPost, "/api/v1/admin/models/test", strings.NewReader(payload))
	validReq.Header.Set("Origin", "https://app.example.com")
	validReq.Header.Set("X-CSRF-Token", "token")
	validReq.AddCookie(&http.Cookie{Name: sessionCookie, Value: "opaque"})
	validReq.AddCookie(&http.Cookie{Name: csrfCookie, Value: "token"})
	valid := httptest.NewRecorder()
	s.routes().ServeHTTP(valid, validReq)
	if valid.Code != http.StatusOK || !strings.Contains(valid.Body.String(), `"status":"ok"`) {
		t.Fatalf("valid route response = %d %s", valid.Code, valid.Body.String())
	}
}
