package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

type sessionAuth struct {
	UserID, WorkspaceID         uuid.UUID
	PlatformRole, WorkspaceRole string
}

type authContextKey struct{}

func (s *server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil {
			s.writeError(w, r, http.StatusUnauthorized, "authentication required")
			return
		}
		resolve := s.resolveSession
		if resolve == nil {
			resolve = s.lookupSession
		}
		auth, err := resolve(r.Context(), cookie.Value)
		if err != nil {
			if strings.HasPrefix(err.Error(), "account_suspended:") {
				s.writeError(w, r, http.StatusForbidden, strings.TrimSpace(strings.TrimPrefix(err.Error(), "account_suspended:")))
				return
			}
			s.writeError(w, r, http.StatusUnauthorized, "authentication required")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authContextKey{}, auth)))
	})
}

func (s *server) lookupSession(ctx context.Context, token string) (sessionAuth, error) {
	if s.db == nil {
		return sessionAuth{}, errors.New("database unavailable")
	}
	hash := hashSessionToken(token)
	var out sessionAuth
	var isSuspended bool
	var suspensionNote string
	err := s.db.QueryRow(ctx, `
SELECT u.id, u.platform_role, wm.workspace_id, wm.role, COALESCE(u.is_suspended, false), COALESCE(u.suspension_note, '')
FROM sessions s JOIN users u ON u.id=s.user_id
JOIN workspace_memberships wm ON wm.user_id=u.id
WHERE s.token_hash=$1 AND s.expires_at>now()
ORDER BY wm.created_at LIMIT 1`, hash[:]).Scan(&out.UserID, &out.PlatformRole, &out.WorkspaceID, &out.WorkspaceRole, &isSuspended, &suspensionNote)
	if err != nil {
		return out, err
	}
	if isSuspended {
		msg := "Your account has been suspended by the administrator."
		if suspensionNote != "" {
			msg = "Account suspended: " + suspensionNote
		}
		return out, errors.New("account_suspended: " + msg)
	}
	return out, nil
}

func authFrom(ctx context.Context) sessionAuth {
	auth, _ := ctx.Value(authContextKey{}).(sessionAuth)
	return auth
}

func (s *server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if authFrom(r.Context()).PlatformRole != "admin" {
			s.writeError(w, r, http.StatusForbidden, "admin access required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) requireMutation(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.originAllowed(r.Header.Get("Origin")) {
			s.writeError(w, r, http.StatusForbidden, "origin not allowed")
			return
		}
		cookie, err := r.Cookie(csrfCookie)
		provided := r.Header.Get("X-CSRF-Token")
		if err != nil || provided == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(provided)) != 1 {
			s.writeError(w, r, http.StatusForbidden, "invalid csrf token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func workspaceCan(role, action string) bool {
	switch role {
	case "owner":
		return true
	case "operator":
		return action == "read" || action == "test" || action == "health" || action == "operate" || action == "settings"
	case "viewer":
		return action == "read"
	default:
		return false
	}
}

func (s *server) requireWorkspaceAction(action string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !workspaceCan(authFrom(r.Context()).WorkspaceRole, action) {
			s.writeError(w, r, http.StatusForbidden, "workspace role does not permit this action")
			return
		}
		next(w, r)
	}
}
