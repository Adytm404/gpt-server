package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestUserResponseIncludesPlatformRole(t *testing.T) {
	response := meResponse{User: userResponse{PlatformRole: platformRoleUser}}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"platform_role":"user"`) {
		t.Fatalf("response missing platform role: %s", encoded)
	}
}

func TestPasswordHash(t *testing.T) {
	hash, err := hashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !verifyPassword("correct horse battery staple", hash) {
		t.Fatal("correct password rejected")
	}
	if verifyPassword("wrong password", hash) {
		t.Fatal("wrong password accepted")
	}
	if verifyPassword("password", "invalid") {
		t.Fatal("malformed hash accepted")
	}
}

func TestSessionToken(t *testing.T) {
	token, err := randomToken(32)
	if err != nil {
		t.Fatal(err)
	}
	if len(token) < 40 {
		t.Fatalf("token too short: %d", len(token))
	}
	if hashSessionToken(token) == hashSessionToken(token+"x") {
		t.Fatal("different tokens produced same hash")
	}
}

func TestLoginLimiter(t *testing.T) {
	limiter := newLoginLimiter(2, time.Minute)
	now := time.Now()
	if !limiter.allow("127.0.0.1", now) || !limiter.allow("127.0.0.1", now) {
		t.Fatal("allowed requests rejected")
	}
	if limiter.allow("127.0.0.1", now) {
		t.Fatal("excess request allowed")
	}
	if !limiter.allow("127.0.0.1", now.Add(time.Minute)) {
		t.Fatal("window did not reset")
	}
}

func TestOriginAndLiveFlow(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}}
	handler := s.routes()

	live := httptest.NewRecorder()
	handler.ServeHTTP(live, httptest.NewRequest(http.MethodGet, "/health/live", nil))
	if live.Code != http.StatusOK || !strings.Contains(live.Body.String(), `"status":"ok"`) {
		t.Fatalf("live response: %d %s", live.Code, live.Body.String())
	}

	register := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{}`))
	handler.ServeHTTP(register, req)
	if register.Code != http.StatusForbidden || !strings.Contains(register.Body.String(), `"request_id":`) {
		t.Fatalf("origin response: %d %s", register.Code, register.Body.String())
	}
}

func TestLogoutRejectsMissingCSRF(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	s.routes().ServeHTTP(recorder, req)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}
