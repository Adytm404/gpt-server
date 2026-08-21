package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type googleOAuthAdminResponse struct {
	Provider        string `json:"provider"`
	ClientID        string `json:"client_id"`
	RedirectURI     string `json:"redirect_uri"`
	Enabled         bool   `json:"enabled"`
	HasClientSecret bool   `json:"has_client_secret"`
	UpdatedAt       string `json:"updated_at,omitempty"`
}

type updateGoogleOAuthInput struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	RedirectURI  string `json:"redirect_uri"`
	Enabled      bool   `json:"enabled"`
}

type authProvidersResponse struct {
	Google struct {
		Enabled  bool   `json:"enabled"`
		ClientID string `json:"client_id,omitempty"`
	} `json:"google"`
}

type googleUserInfo struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

type googleTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
	IDToken     string `json:"id_token"`
}

func (s *server) getAdminGoogleOAuth(w http.ResponseWriter, r *http.Request) {
	var out googleOAuthAdminResponse
	out.Provider = "google"
	var ciphertext []byte
	var updated time.Time
	err := s.db.QueryRow(r.Context(), `
SELECT client_id, client_secret_ciphertext, redirect_uri, enabled, updated_at
FROM platform_oauth_settings
WHERE provider = 'google'`).Scan(&out.ClientID, &ciphertext, &out.RedirectURI, &out.Enabled, &updated)

	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.dbError(w, r, err)
		return
	}

	if out.RedirectURI == "" {
		out.RedirectURI = s.cfg.frontendOrigin + "/auth/google/callback"
	}
	out.HasClientSecret = len(ciphertext) > 0
	if !updated.IsZero() {
		out.UpdatedAt = updated.Format(time.RFC3339)
	}

	s.writeJSON(w, http.StatusOK, out)
}

func (s *server) setAdminGoogleOAuth(w http.ResponseWriter, r *http.Request) {
	var in updateGoogleOAuthInput
	if err := decodeJSON(r, &in); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid request payload")
		return
	}

	in.ClientID = strings.TrimSpace(in.ClientID)
	in.ClientSecret = strings.TrimSpace(in.ClientSecret)
	in.RedirectURI = strings.TrimSpace(in.RedirectURI)
	if in.RedirectURI == "" {
		in.RedirectURI = s.cfg.frontendOrigin + "/auth/google/callback"
	}

	var ciphertext []byte
	if in.ClientSecret != "" {
		var err error
		ciphertext, err = encryptServerCredential(s.cfg.serverKeyEncryptionKey, in.ClientSecret)
		if err != nil {
			s.writeError(w, r, http.StatusInternalServerError, "encryption not configured")
			return
		}
	}

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())

	if len(ciphertext) > 0 {
		_, err = tx.Exec(r.Context(), `
INSERT INTO platform_oauth_settings (provider, client_id, client_secret_ciphertext, redirect_uri, enabled, updated_at)
VALUES ('google', $1, $2, $3, $4, now())
ON CONFLICT (provider) DO UPDATE SET
  client_id = EXCLUDED.client_id,
  client_secret_ciphertext = EXCLUDED.client_secret_ciphertext,
  redirect_uri = EXCLUDED.redirect_uri,
  enabled = EXCLUDED.enabled,
  updated_at = now()`, in.ClientID, ciphertext, in.RedirectURI, in.Enabled)
	} else {
		_, err = tx.Exec(r.Context(), `
INSERT INTO platform_oauth_settings (provider, client_id, redirect_uri, enabled, updated_at)
VALUES ('google', $1, $2, $3, now())
ON CONFLICT (provider) DO UPDATE SET
  client_id = EXCLUDED.client_id,
  redirect_uri = EXCLUDED.redirect_uri,
  enabled = EXCLUDED.enabled,
  updated_at = now()`, in.ClientID, in.RedirectURI, in.Enabled)
	}

	if err != nil {
		s.dbError(w, r, err)
		return
	}

	_ = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "auth", "Updated Google OAuth configuration", uuid.Nil, "google", nil)

	if err = tx.Commit(r.Context()); err != nil {
		s.dbError(w, r, err)
		return
	}

	s.getAdminGoogleOAuth(w, r)
}

func (s *server) getPublicAuthProviders(w http.ResponseWriter, r *http.Request) {
	var out authProvidersResponse
	if s.db != nil {
		var clientID string
		var enabled bool
		err := s.db.QueryRow(r.Context(), `SELECT client_id, enabled FROM platform_oauth_settings WHERE provider = 'google'`).Scan(&clientID, &enabled)
		if err == nil && enabled && clientID != "" {
			out.Google.Enabled = true
			out.Google.ClientID = clientID
		}
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *server) getGoogleAuthURL(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		s.writeError(w, r, http.StatusNotFound, "Google authentication is not configured or disabled")
		return
	}
	var clientID, redirectURI string
	var enabled bool
	err := s.db.QueryRow(r.Context(), `SELECT client_id, redirect_uri, enabled FROM platform_oauth_settings WHERE provider = 'google'`).Scan(&clientID, &redirectURI, &enabled)
	if err != nil || !enabled || clientID == "" {
		s.writeError(w, r, http.StatusNotFound, "Google authentication is not configured or disabled")
		return
	}
	if redirectURI == "" {
		redirectURI = s.cfg.frontendOrigin + "/auth/google/callback"
	}

	stateSecret := s.cfg.serverKeyEncryptionKey
	if stateSecret == "" {
		stateSecret = "fallback-oauth-state-secret"
	}
	nonce, _ := randomToken(16)
	ts := fmt.Sprintf("%d", time.Now().Unix())
	mac := hmac.New(sha256.New, []byte(stateSecret))
	mac.Write([]byte(nonce + ":" + ts))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	state := fmt.Sprintf("%s:%s:%s", nonce, ts, sig)

	authURL := fmt.Sprintf(
		"https://accounts.google.com/o/oauth2/v2/auth?client_id=%s&redirect_uri=%s&response_type=code&scope=%s&state=%s&access_type=offline&prompt=select_account",
		url.QueryEscape(clientID),
		url.QueryEscape(redirectURI),
		url.QueryEscape("openid email profile"),
		url.QueryEscape(state),
	)

	s.writeJSON(w, http.StatusOK, map[string]string{"url": authURL, "state": state})
}

func (s *server) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code  string `json:"code"`
		State string `json:"state"`
	}
	if err := decodeJSON(r, &in); err != nil || in.Code == "" || in.State == "" {
		s.writeError(w, r, http.StatusBadRequest, "invalid callback payload")
		return
	}

	parts := strings.Split(in.State, ":")
	if len(parts) != 3 {
		s.writeError(w, r, http.StatusForbidden, "invalid oauth state")
		return
	}
	nonce, tsStr, sig := parts[0], parts[1], parts[2]
	var ts int64
	fmt.Sscanf(tsStr, "%d", &ts)
	if time.Since(time.Unix(ts, 0)) > 15*time.Minute {
		s.writeError(w, r, http.StatusForbidden, "oauth state expired")
		return
	}

	stateSecret := s.cfg.serverKeyEncryptionKey
	if stateSecret == "" {
		stateSecret = "fallback-oauth-state-secret"
	}
	mac := hmac.New(sha256.New, []byte(stateSecret))
	mac.Write([]byte(nonce + ":" + tsStr))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if sig != expectedSig {
		s.writeError(w, r, http.StatusForbidden, "tampered oauth state")
		return
	}

	var clientID, redirectURI string
	var ciphertext []byte
	var enabled bool
	err := s.db.QueryRow(r.Context(), `
SELECT client_id, client_secret_ciphertext, redirect_uri, enabled
FROM platform_oauth_settings
WHERE provider = 'google'`).Scan(&clientID, &ciphertext, &redirectURI, &enabled)
	if err != nil || !enabled || clientID == "" {
		s.writeError(w, r, http.StatusNotFound, "Google authentication disabled")
		return
	}
	if redirectURI == "" {
		redirectURI = s.cfg.frontendOrigin + "/auth/google/callback"
	}

	clientSecret, err := decryptServerCredential(s.cfg.serverKeyEncryptionKey, ciphertext)
	if err != nil || clientSecret == "" {
		s.writeError(w, r, http.StatusInternalServerError, "cannot decrypt google client secret")
		return
	}

	tokenResp, err := exchangeGoogleCode(r.Context(), clientID, clientSecret, redirectURI, in.Code)
	if err != nil {
		s.writeError(w, r, http.StatusBadGateway, "failed to exchange code with Google: "+err.Error())
		return
	}

	userInfo, err := fetchGoogleUserInfo(r.Context(), tokenResp.AccessToken)
	if err != nil || userInfo.Email == "" {
		s.writeError(w, r, http.StatusBadGateway, "failed to fetch user info from Google")
		return
	}

	email := strings.ToLower(strings.TrimSpace(userInfo.Email))
	fullName := strings.TrimSpace(userInfo.Name)
	if fullName == "" {
		fullName = strings.Split(email, "@")[0]
	}

	var userID uuid.UUID
	err = s.db.QueryRow(r.Context(), `SELECT id FROM users WHERE lower(email) = $1`, email).Scan(&userID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.dbError(w, r, err)
		return
	}

	if errors.Is(err, pgx.ErrNoRows) {
		// New registration via Google
		userID = uuid.New()
		workspaceID := uuid.New()
		workspaceName := fullName + "'s Workspace"

		tx, txErr := s.db.Begin(r.Context())
		if txErr != nil {
			s.dbError(w, r, txErr)
			return
		}
		defer tx.Rollback(r.Context())

		randomPass, _ := randomToken(32)
		pHash, _ := hashPassword(randomPass)

		_, txErr = tx.Exec(r.Context(), `
INSERT INTO users (id, full_name, display_name, email, password_hash, google_id)
VALUES ($1, $2, $2, $3, $4, $5)`, userID, fullName, email, pHash, userInfo.Sub)
		if txErr != nil {
			s.dbError(w, r, txErr)
			return
		}

		_, txErr = tx.Exec(r.Context(), `INSERT INTO workspaces (id, name) VALUES ($1, $2)`, workspaceID, workspaceName)
		if txErr != nil {
			s.dbError(w, r, txErr)
			return
		}

		_, txErr = tx.Exec(r.Context(), `
INSERT INTO workspace_memberships (workspace_id, user_id, role)
VALUES ($1, $2, 'owner')`, workspaceID, userID)
		if txErr != nil {
			s.dbError(w, r, txErr)
			return
		}

		if txErr = tx.Commit(r.Context()); txErr != nil {
			s.dbError(w, r, txErr)
			return
		}
	} else {
		// Existing user: update google_id if unset
		_, _ = s.db.Exec(r.Context(), `UPDATE users SET google_id = $2 WHERE id = $1 AND google_id IS NULL`, userID, userInfo.Sub)
	}

	if err = s.startSession(w, r, userID); err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "failed to create session")
		return
	}

	me, err := s.lookupMe(r.Context(), userID)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "internal error")
		return
	}

	s.writeJSON(w, http.StatusOK, me)
}

func exchangeGoogleCode(ctx context.Context, clientID, clientSecret, redirectURI, code string) (googleTokenResponse, error) {
	data := url.Values{}
	data.Set("code", code)
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)
	data.Set("redirect_uri", redirectURI)
	data.Set("grant_type", "authorization_code")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth2.googleapis.com/token", strings.NewReader(data.Encode()))
	if err != nil {
		return googleTokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return googleTokenResponse{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return googleTokenResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return googleTokenResponse{}, fmt.Errorf("google token endpoint status %d: %s", resp.StatusCode, string(body))
	}

	var out googleTokenResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return googleTokenResponse{}, err
	}
	return out, nil
}

func fetchGoogleUserInfo(ctx context.Context, accessToken string) (googleUserInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.googleapis.com/oauth2/v3/userinfo", nil)
	if err != nil {
		return googleUserInfo{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return googleUserInfo{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return googleUserInfo{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return googleUserInfo{}, fmt.Errorf("google userinfo status %d: %s", resp.StatusCode, string(body))
	}

	var out googleUserInfo
	if err := json.Unmarshal(body, &out); err != nil {
		return googleUserInfo{}, err
	}
	return out, nil
}
