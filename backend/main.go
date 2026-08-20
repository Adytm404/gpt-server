package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/argon2"
)

const (
	sessionCookie            = "opsai_session"
	csrfCookie               = "opsai_csrf"
	platformRoleUser         = "user"
	maxBodyBytes             = 1 << 20
	maxSessionTTL            = 30 * 24 * time.Hour
	defaultSSHConnectTimeout = 45 * time.Second
)

type config struct {
	addr, frontendOrigin                              string
	dbHost, dbPort, dbUser, dbName, dbPassword, dbSSL string
	serverKeyEncryptionKey                            string
	modelKeyEncryptionKey                             string
	sessionTTL, sshConnectTimeout                     time.Duration
	cookieSecure                                      bool
}

type server struct {
	db             *pgxpool.Pool
	cfg            config
	limiter        *loginLimiter
	resolveSession func(context.Context, string) (sessionAuth, error)
}

type loginLimiter struct {
	mu      sync.Mutex
	clients map[string]*loginWindow
	limit   int
	window  time.Duration
}

type loginWindow struct {
	started time.Time
	count   int
}

type errorBody struct {
	Error     string `json:"error"`
	RequestID string `json:"request_id"`
}

type authInput struct {
	FullName      string `json:"full_name"`
	WorkspaceName string `json:"workspace_name"`
	Email         string `json:"email"`
	Password      string `json:"password"`
}

type meResponse struct {
	User      userResponse      `json:"user"`
	Workspace workspaceResponse `json:"workspace"`
}

type userResponse struct {
	ID           string `json:"id"`
	FullName     string `json:"full_name"`
	Email        string `json:"email"`
	PlatformRole string `json:"platform_role"`
}

type workspaceResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

func main() {
	if err := godotenv.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Fatalf("load .env: %v", err)
	}
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}

	dbConfig, err := pgxpool.ParseConfig(databaseURL(cfg))
	if err != nil {
		log.Fatalf("parse database config: %v", err)
	}
	dbConfig.ConnConfig.ConnectTimeout = 10 * time.Second
	db, err := pgxpool.NewWithConfig(context.Background(), dbConfig)
	if err != nil {
		log.Fatalf("create database pool: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := db.Ping(ctx); err != nil {
		log.Fatalf("connect database: %v", err)
	}
	if err := migrate(ctx, db); err != nil {
		log.Fatalf("migrate database: %v", err)
	}

	s := &server{db: db, cfg: cfg, limiter: newLoginLimiter(10, time.Minute)}
	httpServer := &http.Server{
		Addr:              cfg.addr,
		Handler:           s.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      cfg.sshConnectTimeout + 10*time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("auth server listening on %s", cfg.addr)
	log.Fatal(httpServer.ListenAndServe())
}

func loadConfig() (config, error) {
	cfg := config{
		addr:                   env("APP_ADDR", ":8080"),
		frontendOrigin:         strings.TrimRight(env("APP_FRONTEND_ORIGIN", "http://localhost:5173"), "/"),
		dbHost:                 env("DB_HOST", "sagara.zenhosta.com"),
		dbPort:                 env("DB_PORT", "5432"),
		dbUser:                 env("DB_USER", "sagara123_gpt_server_user"),
		dbName:                 env("DB_NAME", "sagara123_gpt_server"),
		dbPassword:             os.Getenv("DB_PASSWORD"),
		dbSSL:                  env("DB_SSLMODE", "disable"),
		serverKeyEncryptionKey: os.Getenv("SERVER_KEY_ENCRYPTION_KEY"),
		modelKeyEncryptionKey:  os.Getenv("MODEL_KEY_ENCRYPTION_KEY"),
	}
	var err error
	cfg.sessionTTL, err = time.ParseDuration(env("SESSION_TTL", "720h"))
	if err != nil || cfg.sessionTTL <= 0 {
		return config{}, errors.New("SESSION_TTL must be a positive Go duration")
	}
	if cfg.sessionTTL > maxSessionTTL {
		cfg.sessionTTL = maxSessionTTL
	}
	cfg.sshConnectTimeout, err = time.ParseDuration(env("SSH_CONNECT_TIMEOUT", defaultSSHConnectTimeout.String()))
	if err != nil || cfg.sshConnectTimeout < 5*time.Second || cfg.sshConnectTimeout > 2*time.Minute {
		return config{}, errors.New("SSH_CONNECT_TIMEOUT must be between 5s and 2m")
	}
	cfg.cookieSecure, err = strconv.ParseBool(env("COOKIE_SECURE", "false"))
	if err != nil {
		return config{}, errors.New("COOKIE_SECURE must be true or false")
	}
	if cfg.modelKeyEncryptionKey != "" {
		key, decodeErr := base64.StdEncoding.DecodeString(cfg.modelKeyEncryptionKey)
		if decodeErr != nil || len(key) != 32 {
			return config{}, errors.New("MODEL_KEY_ENCRYPTION_KEY must be base64-encoded 32 bytes when set")
		}
	}
	origin, err := url.Parse(cfg.frontendOrigin)
	if err != nil || origin.Scheme == "" || origin.Host == "" || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || origin.User != nil {
		return config{}, errors.New("APP_FRONTEND_ORIGIN must be an origin without a path")
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func databaseURL(cfg config) string {
	u := &url.URL{Scheme: "postgres", Host: net.JoinHostPort(cfg.dbHost, cfg.dbPort), Path: cfg.dbName}
	u.User = url.UserPassword(cfg.dbUser, cfg.dbPassword)
	q := u.Query()
	q.Set("sslmode", cfg.dbSSL)
	u.RawQuery = q.Encode()
	return u.String()
}

func (s *server) routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(s.secureHeaders)
	r.Use(s.cors)
	r.Use(s.limitBody)
	r.Use(s.recoverer)
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		s.writeError(w, r, http.StatusNotFound, "not found")
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		s.writeError(w, r, http.StatusMethodNotAllowed, "method not allowed")
	})
	r.Get("/health/live", s.live)
	r.Get("/health/ready", s.ready)
	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/register", s.requireOrigin(s.register))
		r.Post("/auth/login", s.requireOrigin(s.login))
		r.Post("/auth/logout", s.requireOrigin(s.logout))
		r.Get("/me", s.me)
		r.Get("/public/plans", s.listPublicPlans)
		r.Group(func(r chi.Router) {
			r.Use(s.authenticate)
			r.Route("/servers", s.serverRoutes)
			r.Route("/admin", func(r chi.Router) {
				r.Use(s.requireAdmin)
				s.adminRoutes(r)
			})
		})
	})
	return r
}

func (s *server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				log.Printf("panic request_id=%s: %v", middleware.GetReqID(r.Context()), recovered)
				s.writeError(w, r, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *server) secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func (s *server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == s.cfg.frontendOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if origin != s.cfg.frontendOrigin {
				s.writeError(w, r, http.StatusForbidden, "origin not allowed")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		next.ServeHTTP(w, r)
	})
}

func (s *server) requireOrigin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != s.cfg.frontendOrigin {
			s.writeError(w, r, http.StatusForbidden, "origin not allowed")
			return
		}
		next(w, r)
	}
}

func (s *server) live(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		s.writeError(w, r, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) register(w http.ResponseWriter, r *http.Request) {
	var in authInput
	if err := decodeJSON(r, &in); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid request")
		return
	}
	in.FullName = strings.TrimSpace(in.FullName)
	in.WorkspaceName = strings.TrimSpace(in.WorkspaceName)
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	if in.FullName == "" || len(in.FullName) > 200 || in.WorkspaceName == "" || len(in.WorkspaceName) > 200 || !validEmail(in.Email) || len(in.Password) < 12 || len(in.Password) > 1024 {
		s.writeError(w, r, http.StatusBadRequest, "invalid registration fields")
		return
	}
	passwordHash, err := hashPassword(in.Password)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "internal error")
		return
	}

	tx, err := s.db.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	defer tx.Rollback(r.Context())
	userID, workspaceID := uuid.New(), uuid.New()
	if _, err = tx.Exec(r.Context(), `INSERT INTO users (id, full_name, display_name, email, password_hash) VALUES ($1, $2, $2, $3, $4)`, userID, in.FullName, in.Email, passwordHash); err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO workspaces (id, name) VALUES ($1, $2)`, workspaceID, in.WorkspaceName)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, userID)
	}
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			s.writeError(w, r, http.StatusConflict, "email already registered")
			return
		}
		s.writeError(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	if err := s.startSession(w, r, userID); err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	s.writeJSON(w, http.StatusCreated, meResponse{
		User:      userResponse{ID: userID.String(), FullName: in.FullName, Email: in.Email, PlatformRole: platformRoleUser},
		Workspace: workspaceResponse{ID: workspaceID.String(), Name: in.WorkspaceName, Role: "owner"},
	})
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientIP(r), time.Now()) {
		s.writeError(w, r, http.StatusTooManyRequests, "too many login attempts")
		return
	}
	var in authInput
	if err := decodeJSON(r, &in); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid request")
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	var userID uuid.UUID
	var passwordHash string
	err := s.db.QueryRow(r.Context(), `SELECT id, password_hash FROM users WHERE lower(email) = $1`, email).Scan(&userID, &passwordHash)
	if err != nil || !verifyPassword(in.Password, passwordHash) {
		s.writeError(w, r, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if err := s.startSession(w, r, userID); err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	me, err := s.lookupMe(r.Context(), userID)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	s.writeJSON(w, http.StatusOK, me)
}

func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	csrf, err := r.Cookie(csrfCookie)
	provided := r.Header.Get("X-CSRF-Token")
	if err != nil || provided == "" || subtle.ConstantTimeCompare([]byte(csrf.Value), []byte(provided)) != 1 {
		s.writeError(w, r, http.StatusForbidden, "invalid csrf token")
		return
	}
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		hash := hashSessionToken(cookie.Value)
		_, _ = s.db.Exec(r.Context(), `DELETE FROM sessions WHERE token_hash = $1`, hash[:])
	}
	s.clearCookie(w, sessionCookie, true)
	s.clearCookie(w, csrfCookie, false)
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) me(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		s.writeError(w, r, http.StatusUnauthorized, "authentication required")
		return
	}
	hash := hashSessionToken(cookie.Value)
	var userID uuid.UUID
	err = s.db.QueryRow(r.Context(), `SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()`, hash[:]).Scan(&userID)
	if err != nil {
		s.writeError(w, r, http.StatusUnauthorized, "authentication required")
		return
	}
	me, err := s.lookupMe(r.Context(), userID)
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	s.writeJSON(w, http.StatusOK, me)
}

func (s *server) lookupMe(ctx context.Context, userID uuid.UUID) (meResponse, error) {
	var out meResponse
	err := s.db.QueryRow(ctx, `
SELECT u.id, u.full_name, u.email, u.platform_role, w.id, w.name, wm.role
FROM users u
JOIN workspace_memberships wm ON wm.user_id = u.id
JOIN workspaces w ON w.id = wm.workspace_id
WHERE u.id = $1
ORDER BY wm.created_at
LIMIT 1`, userID).Scan(&out.User.ID, &out.User.FullName, &out.User.Email, &out.User.PlatformRole, &out.Workspace.ID, &out.Workspace.Name, &out.Workspace.Role)
	return out, err
}

func (s *server) startSession(w http.ResponseWriter, r *http.Request, userID uuid.UUID) error {
	token, err := randomToken(32)
	if err != nil {
		return err
	}
	csrf, err := randomToken(32)
	if err != nil {
		return err
	}
	hash := hashSessionToken(token)
	expires := time.Now().Add(s.cfg.sessionTTL)
	if _, err = s.db.Exec(r.Context(), `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`, uuid.New(), userID, hash[:], expires); err != nil {
		return err
	}
	maxAge := int(time.Until(expires).Seconds())
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: s.cfg.cookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge, Expires: expires})
	http.SetCookie(w, &http.Cookie{Name: csrfCookie, Value: csrf, Path: "/", HttpOnly: false, Secure: s.cfg.cookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge, Expires: expires})
	return nil
}

func (s *server) clearCookie(w http.ResponseWriter, name string, httpOnly bool) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", HttpOnly: httpOnly, Secure: s.cfg.cookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)})
}

func decodeJSON(r *http.Request, dst any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) == nil {
		return errors.New("multiple JSON values")
	}
	return nil
}

func (s *server) writeError(w http.ResponseWriter, r *http.Request, status int, message string) {
	s.writeJSON(w, status, errorBody{Error: message, RequestID: middleware.GetReqID(r.Context())})
}

func (s *server) writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func validEmail(email string) bool {
	if len(email) > 254 {
		return false
	}
	address, err := mail.ParseAddress(email)
	return err == nil && address.Address == email && strings.Contains(email, "@")
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=2$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(hash)), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var memory uint32
	var iterations, parallelism uint32
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil || memory < 8 || memory > 256*1024 || iterations < 1 || iterations > 10 || parallelism < 1 || parallelism > 16 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 8 || len(salt) > 64 {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) < 16 || len(want) > 64 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, uint8(parallelism), uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

func randomToken(size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func hashSessionToken(token string) [32]byte {
	return sha256.Sum256([]byte(token))
}

func newLoginLimiter(limit int, window time.Duration) *loginLimiter {
	return &loginLimiter{clients: make(map[string]*loginWindow), limit: limit, window: window}
}

func (l *loginLimiter) allow(ip string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.clients[ip]
	if entry == nil || now.Sub(entry.started) >= l.window {
		l.clients[ip] = &loginWindow{started: now, count: 1}
		return true
	}
	entry.count++
	return entry.count <= l.limit
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
