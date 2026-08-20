package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type serverResponse struct {
	ID                   uuid.UUID               `json:"id"`
	Name                 string                  `json:"name"`
	Host                 string                  `json:"host"`
	Port                 int                     `json:"port"`
	SSHUser              string                  `json:"ssh_user"`
	Environment          string                  `json:"environment"`
	Region               string                  `json:"region"`
	HostFingerprint      string                  `json:"host_fingerprint"`
	CredentialConfigured bool                    `json:"credential_configured"`
	Status               string                  `json:"status"`
	LastError            string                  `json:"last_error,omitempty"`
	LastCheckedAt        *time.Time              `json:"last_checked_at,omitempty"`
	CreatedAt            time.Time               `json:"created_at"`
	UpdatedAt            time.Time               `json:"updated_at"`
	LatestSnapshot       *healthSnapshotResponse `json:"latest_snapshot,omitempty"`
}

type healthSnapshotResponse struct {
	Status        string    `json:"status"`
	LatencyMS     int       `json:"latency_ms"`
	CPUPercent    float64   `json:"cpu_percent"`
	MemoryPercent float64   `json:"memory_percent"`
	DiskPercent   float64   `json:"disk_percent"`
	Error         string    `json:"error,omitempty"`
	CapturedAt    time.Time `json:"captured_at"`
}

const serverColumns = `id,name,host,port,ssh_user,environment,region,host_fingerprint,(private_key_ciphertext IS NOT NULL),status,last_error,last_checked_at,created_at,updated_at`

func scanServer(row pgx.Row) (serverResponse, error) {
	var out serverResponse
	err := row.Scan(&out.ID, &out.Name, &out.Host, &out.Port, &out.SSHUser, &out.Environment, &out.Region, &out.HostFingerprint, &out.CredentialConfigured, &out.Status, &out.LastError, &out.LastCheckedAt, &out.CreatedAt, &out.UpdatedAt)
	return out, err
}

func (s *server) serverRoutes(r chi.Router) {
	r.Get("/", s.requireWorkspaceAction("read", s.listServers))
	r.With(s.requireMutation).Post("/", s.requireWorkspaceAction("create", s.createServer))
	r.Get("/{id}", s.requireWorkspaceAction("read", s.getServer))
	r.With(s.requireMutation).Patch("/{id}", s.requireWorkspaceAction("update", s.updateServer))
	r.With(s.requireMutation).Delete("/{id}", s.requireWorkspaceAction("delete", s.deleteServer))
	r.With(s.requireMutation).Post("/{id}/test", s.requireWorkspaceAction("test", s.testServer))
	r.With(s.requireMutation).Post("/{id}/health-check", s.requireWorkspaceAction("health", s.healthServer))
}
func (s *server) listServers(w http.ResponseWriter, r *http.Request) {
	auth := authFrom(r.Context())
	args := []any{auth.WorkspaceID}
	where := []string{"workspace_id=$1", "deleted_at IS NULL"}
	for _, f := range []string{"status", "environment"} {
		if v := strings.TrimSpace(r.URL.Query().Get(f)); v != "" {
			args = append(args, v)
			where = append(where, fmt.Sprintf("%s=$%d", f, len(args)))
		}
	}
	if q := strings.TrimSpace(r.URL.Query().Get("query")); q != "" {
		args = append(args, "%"+q+"%")
		where = append(where, fmt.Sprintf("(name ILIKE $%d OR host ILIKE $%d)", len(args), len(args)))
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+serverColumns+` FROM servers WHERE `+strings.Join(where, " AND ")+` ORDER BY created_at`, args...)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer rows.Close()
	out := []serverResponse{}
	for rows.Next() {
		item, e := scanServer(rows)
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		item.LatestSnapshot, e = s.latestSnapshot(r.Context(), item.ID)
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, map[string]any{"servers": out, "summary": summarizeServers(out)})
}
func (s *server) getServer(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	out, err := scanServer(s.db.QueryRow(r.Context(), `SELECT `+serverColumns+` FROM servers WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, id, authFrom(r.Context()).WorkspaceID))
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	out.LatestSnapshot, err = s.latestSnapshot(r.Context(), out.ID)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, out)
}
func (s *server) createServer(w http.ResponseWriter, r *http.Request) {
	var in serverInput
	if decodeJSON(r, &in) != nil || validateServerInput(in) != nil {
		s.writeError(w, r, 400, "invalid server fields")
		return
	}
	var encrypted []byte
	var err error
	if in.PrivateKey != "" {
		encrypted, err = encryptPrivateKey(s.cfg.serverKeyEncryptionKey, in.PrivateKey)
		if err != nil {
			s.writeError(w, r, 500, "server key encryption is not configured")
			return
		}
	}
	id := uuid.New()
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	out, err := scanServer(tx.QueryRow(r.Context(), `INSERT INTO servers(id,workspace_id,name,host,port,ssh_user,environment,region,host_fingerprint,private_key_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING `+serverColumns, id, authFrom(r.Context()).WorkspaceID, strings.TrimSpace(in.Name), in.Host, in.Port, in.SSHUser, in.Environment, in.Region, in.HostFingerprint, encrypted))
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "servers", "Server created", id, out.Name, nil)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 201, out)
}
func (s *server) updateServer(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	var in serverInput
	if decodeJSON(r, &in) != nil || validateServerInput(in) != nil {
		s.writeError(w, r, 400, "invalid server fields")
		return
	}
	var encrypted []byte
	configured := false
	if in.PrivateKey != "" {
		var err error
		encrypted, err = encryptPrivateKey(s.cfg.serverKeyEncryptionKey, in.PrivateKey)
		if err != nil {
			s.writeError(w, r, 500, "server key encryption is not configured")
			return
		}
		configured = true
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	out, err := scanServer(tx.QueryRow(r.Context(), `UPDATE servers SET name=$3,host=$4,port=$5,ssh_user=$6,environment=$7,region=$8,host_fingerprint=$9,private_key_ciphertext=CASE WHEN $10 THEN $11 ELSE private_key_ciphertext END,status=CASE WHEN host<>$4 OR port<>$5 THEN 'unknown' ELSE status END,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL RETURNING `+serverColumns, id, authFrom(r.Context()).WorkspaceID, strings.TrimSpace(in.Name), in.Host, in.Port, in.SSHUser, in.Environment, in.Region, in.HostFingerprint, configured, encrypted))
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "servers", "Server updated", id, out.Name, nil)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, 200, out)
}
func (s *server) deleteServer(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	var name string
	err = tx.QueryRow(r.Context(), `UPDATE servers SET deleted_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL RETURNING name`, id, authFrom(r.Context()).WorkspaceID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		s.writeError(w, r, 404, "not found")
		return
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "servers", "Server deleted", id, name, nil)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	w.WriteHeader(204)
}
func (s *server) testServer(w http.ResponseWriter, r *http.Request)   { s.checkServer(w, r, false) }
func (s *server) healthServer(w http.ResponseWriter, r *http.Request) { s.checkServer(w, r, true) }
func (s *server) checkServer(w http.ResponseWriter, r *http.Request, health bool) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	var host string
	var port int
	err := s.db.QueryRow(r.Context(), `SELECT host,port FROM servers WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, id, authFrom(r.Context()).WorkspaceID).Scan(&host, &port)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	started := time.Now()
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	dialer := net.Dialer{}
	conn, dialErr := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, fmt.Sprint(port)))
	if dialErr == nil {
		_ = conn.Close()
	}
	latency := int(time.Since(started).Milliseconds())
	status, lastError := "online", ""
	if dialErr != nil {
		status, lastError = "offline", dialErr.Error()
	}
	tx, err := s.db.Begin(r.Context())
	var snapshot *healthSnapshotResponse
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE servers SET status=$3,last_error=$4,last_checked_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$2`, id, authFrom(r.Context()).WorkspaceID, status, lastError)
	}
	if err == nil && health {
		snapshot = &healthSnapshotResponse{Status: status, LatencyMS: latency, Error: lastError}
		err = tx.QueryRow(r.Context(), `INSERT INTO server_health_snapshots(id,server_id,status,latency_ms,cpu_percent,memory_percent,disk_percent,error) VALUES($1,$2,$3,$4,0,0,0,$5) RETURNING checked_at`, uuid.New(), id, status, latency, lastError).Scan(&snapshot.CapturedAt)
	}
	action := "Server connection tested"
	if health {
		action = "Server health checked"
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "servers", action, id, host, map[string]any{"status": status, "latency_ms": latency})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	} else if tx != nil {
		_ = tx.Rollback(r.Context())
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	if health {
		s.writeJSON(w, 200, map[string]any{"snapshot": snapshot, "tcp_only": true})
		return
	}
	s.writeJSON(w, 200, map[string]any{"status": status, "latency_ms": latency, "error": lastError, "tcp_only": true})
}

func summarizeServers(servers []serverResponse) map[string]int {
	summary := map[string]int{"total": 0, "online": 0, "offline": 0, "unknown": 0}
	for _, item := range servers {
		summary["total"]++
		if _, known := summary[item.Status]; known {
			summary[item.Status]++
		} else {
			summary["unknown"]++
		}
	}
	return summary
}

func (s *server) latestSnapshot(ctx context.Context, serverID uuid.UUID) (*healthSnapshotResponse, error) {
	var snapshot healthSnapshotResponse
	err := s.db.QueryRow(ctx, `SELECT status,latency_ms,cpu_percent,memory_percent,disk_percent,error,checked_at FROM server_health_snapshots WHERE server_id=$1 ORDER BY checked_at DESC LIMIT 1`, serverID).Scan(&snapshot.Status, &snapshot.LatencyMS, &snapshot.CPUPercent, &snapshot.MemoryPercent, &snapshot.DiskPercent, &snapshot.Error, &snapshot.CapturedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &snapshot, nil
}

func encryptPrivateKey(encodedKey, plaintext string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil || len(key) != 32 {
		return nil, errors.New("SERVER_KEY_ENCRYPTION_KEY must be base64-encoded 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
}
