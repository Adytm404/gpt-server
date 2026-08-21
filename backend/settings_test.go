package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestSettingsRoutesAuth(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}}

	unauthenticated := httptest.NewRecorder()
	s.routes().ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodGet, "/api/v1/settings/workspace", nil))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", unauthenticated.Code)
	}

	unauthenticatedProfile := httptest.NewRecorder()
	s.routes().ServeHTTP(unauthenticatedProfile, httptest.NewRequest(http.MethodGet, "/api/v1/settings/profile", nil))
	if unauthenticatedProfile.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated profile status = %d", unauthenticatedProfile.Code)
	}
}

func TestSettingsChangePasswordValidation(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}}
	s.resolveSession = func(context.Context, string) (sessionAuth, error) {
		return sessionAuth{UserID: uuid.New(), WorkspaceID: uuid.New(), PlatformRole: "user", WorkspaceRole: "owner"}, nil
	}

	payload := `{"current_password":"old","new_password":"short"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/settings/change-password", strings.NewReader(payload))
	req.Header.Set("Origin", "https://app.example.com")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: "opaque"})
	req.Header.Set("X-CSRF-Token", "fake")
	req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "fake"})
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("short password status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
