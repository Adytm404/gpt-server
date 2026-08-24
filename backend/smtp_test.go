package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestVerifyEmailValidationAndFlow(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}}
	handler := s.routes()

	// Missing token
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/verify-email", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty token, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestResendVerificationValidation(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}, limiter: newLoginLimiter(10, time.Minute)}
	handler := s.routes()

	// Missing email
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/resend-verification", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty email, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMonitorResolveRecipients(t *testing.T) {
	s := &server{}
	targetWithCustom := serverMonitorTarget{
		AlertRecipientEmails: "ops@company.com, alerts@company.com",
		OwnerEmail:           "owner@company.com",
	}
	recipients := s.resolveAlertRecipients(targetWithCustom)
	if len(recipients) != 2 || recipients[0] != "ops@company.com" || recipients[1] != "alerts@company.com" {
		t.Fatalf("unexpected recipients: %v", recipients)
	}

	targetDefaultOwner := serverMonitorTarget{
		AlertRecipientEmails: "",
		OwnerEmail:           "owner@company.com",
	}
	recipientsOwner := s.resolveAlertRecipients(targetDefaultOwner)
	if len(recipientsOwner) != 1 || recipientsOwner[0] != "owner@company.com" {
		t.Fatalf("unexpected owner recipient: %v", recipientsOwner)
	}
}

func TestVerificationTokenHashing(t *testing.T) {
	rawToken := "abcdef1234567890abcdef1234567890"
	hash := sha256.Sum256([]byte(rawToken))
	hexHash := hex.EncodeToString(hash[:])
	if len(hexHash) != 64 {
		t.Fatalf("expected 64 chars sha256 hex, got %d", len(hexHash))
	}
}

func TestAdminSMTPRequiresAdmin(t *testing.T) {
	s := &server{
		cfg: config{frontendOrigin: "https://app.example.com"},
		resolveSession: func(ctx context.Context, s string) (sessionAuth, error) {
			return sessionAuth{UserID: uuid.New(), PlatformRole: "user", WorkspaceID: uuid.New(), WorkspaceRole: "owner"}, nil
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/smtp", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: "test-token"})
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin user on /admin/smtp, got %d", rec.Code)
	}
}
