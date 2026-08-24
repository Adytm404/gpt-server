package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestAdminAnalyticsRoutesRequireAdmin(t *testing.T) {
	s := &server{
		cfg: config{frontendOrigin: "https://app.example.com"},
		resolveSession: func(ctx context.Context, token string) (sessionAuth, error) {
			return sessionAuth{UserID: uuid.New(), PlatformRole: "user", WorkspaceID: uuid.New(), WorkspaceRole: "owner"}, nil
		},
	}
	handler := s.routes()

	reqUsers := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users", nil)
	reqUsers.AddCookie(&http.Cookie{Name: sessionCookie, Value: "user-token"})
	recUsers := httptest.NewRecorder()
	handler.ServeHTTP(recUsers, reqUsers)
	if recUsers.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin on /admin/users, got %d", recUsers.Code)
	}

	reqTx := httptest.NewRequest(http.MethodGet, "/api/v1/admin/transactions", nil)
	reqTx.AddCookie(&http.Cookie{Name: sessionCookie, Value: "user-token"})
	recTx := httptest.NewRecorder()
	handler.ServeHTTP(recTx, reqTx)
	if recTx.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin on /admin/transactions, got %d", recTx.Code)
	}
}
