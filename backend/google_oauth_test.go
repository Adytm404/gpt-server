package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestGoogleOAuthPublicEndpoints(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}}

	providersReq := httptest.NewRequest(http.MethodGet, "/api/v1/auth/providers", nil)
	providersRec := httptest.NewRecorder()
	s.routes().ServeHTTP(providersRec, providersReq)
	if providersRec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", providersRec.Code)
	}

	authURLReq := httptest.NewRequest(http.MethodGet, "/api/v1/auth/google/url", nil)
	authURLRec := httptest.NewRecorder()
	s.routes().ServeHTTP(authURLRec, authURLReq)
	if authURLRec.Code != http.StatusNotFound && authURLRec.Code != http.StatusOK {
		t.Fatalf("auth url status = %d", authURLRec.Code)
	}
}

func TestAdminGoogleOAuthAuthCheck(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}}

	unauthenticated := httptest.NewRecorder()
	s.routes().ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodGet, "/api/v1/admin/auth-settings/google", nil))
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", unauthenticated.Code)
	}

	s.resolveSession = func(context.Context, string) (sessionAuth, error) {
		return sessionAuth{UserID: uuid.New(), WorkspaceID: uuid.New(), PlatformRole: "user", WorkspaceRole: "owner"}, nil
	}
	forbidden := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/auth-settings/google", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: "opaque"})
	s.routes().ServeHTTP(forbidden, req)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("forbidden status = %d", forbidden.Code)
	}
}
