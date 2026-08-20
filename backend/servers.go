package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/ssh"
)

type serverResponse struct {
	ID                   uuid.UUID               `json:"id"`
	Name                 string                  `json:"name"`
	Host                 string                  `json:"host"`
	Port                 int                     `json:"port"`
	SSHUser              string                  `json:"ssh_user"`
	Environment          string                  `json:"environment"`
	Region               string                  `json:"region"`
	OperatingSystem      string                  `json:"operating_system"`
	UptimeSeconds        *int64                  `json:"uptime_seconds"`
	HostFingerprint      string                  `json:"host_fingerprint"`
	AuthMethod           string                  `json:"auth_method"`
	CredentialConfigured bool                    `json:"credential_configured"`
	Status               string                  `json:"status"`
	LastError            string                  `json:"last_error,omitempty"`
	LastCheckedAt        *time.Time              `json:"last_checked_at,omitempty"`
	CreatedAt            time.Time               `json:"created_at"`
	UpdatedAt            time.Time               `json:"updated_at"`
	LatestSnapshot       *healthSnapshotResponse `json:"latest_snapshot,omitempty"`
}

type healthSnapshotResponse struct {
	Status        string                  `json:"status"`
	LatencyMS     int                     `json:"latency_ms"`
	CPUPercent    float64                 `json:"cpu_percent"`
	MemoryPercent float64                 `json:"memory_percent"`
	DiskPercent   float64                 `json:"disk_percent"`
	Services      []serviceHealthResponse `json:"services"`
	Details       map[string]any          `json:"details"`
	Error         string                  `json:"error,omitempty"`
	CapturedAt    time.Time               `json:"captured_at"`
}

type serviceHealthResponse struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

const serverColumns = `id,name,host,port,ssh_user,environment,region,operating_system,uptime_seconds,host_fingerprint,auth_method,CASE WHEN auth_method='password' THEN password_ciphertext IS NOT NULL ELSE private_key_ciphertext IS NOT NULL END,status,last_error,last_checked_at,created_at,updated_at`

func scanServer(row pgx.Row) (serverResponse, error) {
	var out serverResponse
	err := row.Scan(&out.ID, &out.Name, &out.Host, &out.Port, &out.SSHUser, &out.Environment, &out.Region, &out.OperatingSystem, &out.UptimeSeconds, &out.HostFingerprint, &out.AuthMethod, &out.CredentialConfigured, &out.Status, &out.LastError, &out.LastCheckedAt, &out.CreatedAt, &out.UpdatedAt)
	return out, err
}

func (s *server) serverRoutes(r chi.Router) {
	r.Get("/", s.requireWorkspaceAction("read", s.listServers))
	r.With(s.requireMutation).Post("/", s.requireWorkspaceAction("create", s.createServer))
	r.With(s.requireMutation).Post("/test-draft", s.requireWorkspaceAction("draft-test", s.testDraftServer))
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
	if decodeJSON(r, &in) != nil || validateServerCreateInput(in) != nil {
		s.writeError(w, r, 400, "invalid server fields")
		return
	}
	method := normalizedAuthMethod(in.AuthMethod)
	secret := in.PrivateKey
	if method == authMethodPassword {
		secret = in.Password
	}
	encrypted, err := encryptServerCredential(s.cfg.serverKeyEncryptionKey, secret)
	if err != nil {
		s.writeError(w, r, 500, "server credential encryption is not configured")
		return
	}
	var privateKeyCiphertext, passwordCiphertext []byte
	if method == authMethodSSHKey {
		privateKeyCiphertext = encrypted
	} else {
		passwordCiphertext = encrypted
	}
	id := uuid.New()
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	out, err := scanServer(tx.QueryRow(r.Context(), `INSERT INTO servers(id,workspace_id,name,host,port,ssh_user,environment,region,host_fingerprint,auth_method,private_key_ciphertext,password_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING `+serverColumns, id, authFrom(r.Context()).WorkspaceID, strings.TrimSpace(in.Name), in.Host, in.Port, in.SSHUser, in.Environment, in.Region, in.HostFingerprint, method, privateKeyCiphertext, passwordCiphertext))
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
	if decodeJSON(r, &in) != nil {
		s.writeError(w, r, 400, "invalid server fields")
		return
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	var currentMethod string
	var hasPrivateKey, hasPassword bool
	err = tx.QueryRow(r.Context(), `SELECT auth_method,private_key_ciphertext IS NOT NULL,password_ciphertext IS NOT NULL FROM servers WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE`, id, authFrom(r.Context()).WorkspaceID).Scan(&currentMethod, &hasPrivateKey, &hasPassword)
	if errors.Is(err, pgx.ErrNoRows) {
		s.writeError(w, r, 404, "not found")
		return
	}
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	if err := validateServerUpdateInput(in, currentMethod, hasPrivateKey, hasPassword); err != nil {
		s.writeError(w, r, 400, "invalid server fields")
		return
	}
	method := normalizedAuthMethod(in.AuthMethod)
	var encrypted []byte
	credentialChanged := strings.TrimSpace(in.PrivateKey) != "" || strings.TrimSpace(in.Password) != ""
	if credentialChanged {
		secret := in.PrivateKey
		if method == authMethodPassword {
			secret = in.Password
		}
		encrypted, err = encryptServerCredential(s.cfg.serverKeyEncryptionKey, secret)
		if err != nil {
			s.writeError(w, r, 500, "server credential encryption is not configured")
			return
		}
	}
	out, err := scanServer(tx.QueryRow(r.Context(), `UPDATE servers SET name=$3,host=$4,port=$5,ssh_user=$6,environment=$7,region=$8,host_fingerprint=$9,auth_method=$10,private_key_ciphertext=CASE WHEN $10='password' THEN NULL WHEN $11 THEN $12 ELSE private_key_ciphertext END,password_ciphertext=CASE WHEN $10='ssh_key' THEN NULL WHEN $11 THEN $12 ELSE password_ciphertext END,status=CASE WHEN host<>$4 OR port<>$5 OR ssh_user<>$6 OR auth_method<>$10 OR $11 THEN 'unknown' ELSE status END,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL RETURNING `+serverColumns, id, authFrom(r.Context()).WorkspaceID, strings.TrimSpace(in.Name), in.Host, in.Port, in.SSHUser, in.Environment, in.Region, in.HostFingerprint, method, credentialChanged, encrypted))
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
func (s *server) testServer(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	var target sshConnectionTarget
	var ciphertext []byte
	err := s.db.QueryRow(r.Context(), `SELECT host,port,ssh_user,auth_method,host_fingerprint,CASE WHEN auth_method='password' THEN password_ciphertext ELSE private_key_ciphertext END FROM servers WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, id, authFrom(r.Context()).WorkspaceID).Scan(&target.Host, &target.Port, &target.SSHUser, &target.AuthMethod, &target.HostFingerprint, &ciphertext)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	if target.HostFingerprint == "" {
		s.writeError(w, r, http.StatusConflict, "server host fingerprint is required")
		return
	}
	secret, decryptErr := decryptServerCredential(s.cfg.serverKeyEncryptionKey, ciphertext)
	var result sshConnectionResult
	if decryptErr != nil {
		result = offlineSSHResult(target, "server credential unavailable")
	} else {
		ctx, cancel := context.WithTimeout(r.Context(), normalizedSSHTimeout(s.cfg.sshConnectTimeout))
		result = testSSHConnection(ctx, target, secret)
		cancel()
	}
	tx, err := s.db.Begin(r.Context())
	if err == nil {
		fingerprint := target.HostFingerprint
		if result.Status == "online" && fingerprint == "" {
			fingerprint = result.HostFingerprint
		}
		_, err = tx.Exec(r.Context(), `UPDATE servers SET status=$3,last_error=$4,last_checked_at=now(),host_fingerprint=$5,updated_at=now() WHERE id=$1 AND workspace_id=$2`, id, authFrom(r.Context()).WorkspaceID, result.Status, result.Error, fingerprint)
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "servers", "Server connection tested", id, target.Host, map[string]any{"status": result.Status, "latency_ms": result.LatencyMS, "auth_method": result.AuthMethod, "fingerprint_verified": result.FingerprintVerified})
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
	s.writeJSON(w, 200, result)
}

func (s *server) testDraftServer(w http.ResponseWriter, r *http.Request) {
	var in serverInput
	if decodeJSON(r, &in) != nil || validateServerCreateInput(in) != nil {
		s.writeError(w, r, 400, "invalid server fields")
		return
	}
	method := normalizedAuthMethod(in.AuthMethod)
	secret := in.PrivateKey
	if method == authMethodPassword {
		secret = in.Password
	}
	ctx, cancel := context.WithTimeout(r.Context(), normalizedSSHTimeout(s.cfg.sshConnectTimeout))
	defer cancel()
	s.writeJSON(w, 200, testSSHConnection(ctx, sshConnectionTarget{Host: in.Host, Port: in.Port, SSHUser: in.SSHUser, AuthMethod: method, HostFingerprint: in.HostFingerprint}, secret))
}

func (s *server) healthServer(w http.ResponseWriter, r *http.Request) {
	id, ok := s.pathUUID(w, r)
	if !ok {
		return
	}
	var target sshConnectionTarget
	var ciphertext []byte
	err := s.db.QueryRow(r.Context(), `SELECT host,port,ssh_user,auth_method,host_fingerprint,CASE WHEN auth_method='password' THEN password_ciphertext ELSE private_key_ciphertext END FROM servers WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`, id, authFrom(r.Context()).WorkspaceID).Scan(&target.Host, &target.Port, &target.SSHUser, &target.AuthMethod, &target.HostFingerprint, &ciphertext)
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	if target.HostFingerprint == "" {
		s.writeError(w, r, http.StatusConflict, "server host fingerprint is required")
		return
	}
	status, lastError := "offline", "server credential unavailable"
	result := offlineSSHResult(target, lastError)
	var inventory healthInventory
	if secret, decryptErr := decryptServerCredential(s.cfg.serverKeyEncryptionKey, ciphertext); decryptErr == nil {
		ctx, cancel := context.WithTimeout(r.Context(), normalizedSSHTimeout(s.cfg.sshConnectTimeout))
		client, connectionResult, connectErr := dialAuthenticatedSSH(ctx, target, secret)
		result = connectionResult
		if connectErr == nil {
			inventory, err = collectHealthInventory(ctx, client)
			_ = client.Close()
			if err == nil {
				status, lastError = "online", ""
			} else {
				lastError = sanitizeSSHError(err.Error())
			}
		} else {
			lastError = result.Error
		}
		cancel()
	}
	lastError = sanitizeSSHError(lastError)
	services := inventory.Services
	if services == nil {
		services = []serviceHealthResponse{}
	}
	details := healthInventoryDetails(status, lastError, inventory)
	servicesJSON, _ := json.Marshal(services)
	detailsJSON, _ := json.Marshal(details)
	tx, err := s.db.Begin(r.Context())
	var out serverResponse
	if err == nil {
		fingerprint := target.HostFingerprint
		if status == "online" && fingerprint == "" {
			fingerprint = result.HostFingerprint
		}
		out, err = scanServer(tx.QueryRow(r.Context(), `UPDATE servers SET status=$3,last_error=$4,last_checked_at=now(),operating_system=CASE WHEN $3='online' THEN $5 ELSE operating_system END,uptime_seconds=CASE WHEN $3='online' THEN $6 ELSE uptime_seconds END,host_fingerprint=$7,updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING `+serverColumns, id, authFrom(r.Context()).WorkspaceID, status, lastError, inventory.OperatingSystem, inventory.UptimeSeconds, fingerprint))
	}
	if err == nil {
		out.LatestSnapshot = &healthSnapshotResponse{Status: status, LatencyMS: result.LatencyMS, CPUPercent: inventory.CPUPercent, MemoryPercent: inventory.MemoryPercent, DiskPercent: inventory.DiskPercent, Services: services, Details: details, Error: lastError}
		err = tx.QueryRow(r.Context(), `INSERT INTO server_health_snapshots(id,server_id,status,latency_ms,cpu_percent,memory_percent,disk_percent,services,details,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10) RETURNING checked_at`, uuid.New(), id, status, result.LatencyMS, inventory.CPUPercent, inventory.MemoryPercent, inventory.DiskPercent, string(servicesJSON), string(detailsJSON), lastError).Scan(&out.LatestSnapshot.CapturedAt)
	}
	if err == nil {
		err = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "servers", "Server health checked", id, target.Host, map[string]any{"status": status, "latency_ms": result.LatencyMS, "auth_method": target.AuthMethod})
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
	s.writeJSON(w, 200, out)
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
	err := s.db.QueryRow(ctx, `SELECT status,latency_ms,cpu_percent,memory_percent,disk_percent,services,details,error,checked_at FROM server_health_snapshots WHERE server_id=$1 ORDER BY checked_at DESC LIMIT 1`, serverID).Scan(&snapshot.Status, &snapshot.LatencyMS, &snapshot.CPUPercent, &snapshot.MemoryPercent, &snapshot.DiskPercent, &snapshot.Services, &snapshot.Details, &snapshot.Error, &snapshot.CapturedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &snapshot, nil
}

func encryptServerCredential(encodedKey, plaintext string) ([]byte, error) {
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

// encryptPrivateKey remains for callers using the legacy helper name.
func encryptPrivateKey(encodedKey, plaintext string) ([]byte, error) {
	return encryptServerCredential(encodedKey, plaintext)
}

func decryptServerCredential(encodedKey string, ciphertext []byte) (string, error) {
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil || len(key) != 32 {
		return "", errors.New("SERVER_KEY_ENCRYPTION_KEY must be base64-encoded 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(ciphertext) < gcm.NonceSize() {
		return "", errors.New("invalid server credential ciphertext")
	}
	plaintext, err := gcm.Open(nil, ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("invalid server credential ciphertext")
	}
	return string(plaintext), nil
}

type sshConnectionTarget struct {
	Host, SSHUser, AuthMethod, HostFingerprint string
	Port                                       int
}

type sshConnectionResult struct {
	Status              string `json:"status"`
	LatencyMS           int    `json:"latency_ms"`
	AuthMethod          string `json:"auth_method"`
	FingerprintVerified bool   `json:"fingerprint_verified"`
	HostFingerprint     string `json:"host_fingerprint"`
	Error               string `json:"error,omitempty"`
}

func offlineSSHResult(target sshConnectionTarget, message string) sshConnectionResult {
	return sshConnectionResult{Status: "offline", AuthMethod: target.AuthMethod, HostFingerprint: target.HostFingerprint, Error: sanitizeSSHError(message)}
}

func testSSHConnection(ctx context.Context, target sshConnectionTarget, secret string) sshConnectionResult {
	client, result, err := dialAuthenticatedSSH(ctx, target, secret)
	if err == nil {
		_ = client.Close()
	}
	return result
}

func dialAuthenticatedSSH(ctx context.Context, target sshConnectionTarget, secret string) (*ssh.Client, sshConnectionResult, error) {
	started := time.Now()
	result := offlineSSHResult(target, "SSH connection failed")
	var auth ssh.AuthMethod
	if target.AuthMethod == authMethodPassword {
		auth = ssh.Password(secret)
	} else {
		signer, err := ssh.ParsePrivateKey([]byte(secret))
		if err != nil {
			result.Error = "invalid SSH private key"
			return nil, result, err
		}
		auth = ssh.PublicKeys(signer)
	}
	observed := ""
	connectTimeout := normalizedSSHTimeout(0)
	if deadline, ok := ctx.Deadline(); ok {
		if remaining := time.Until(deadline); remaining > 0 {
			connectTimeout = remaining
		}
	}
	config := &ssh.ClientConfig{
		User:    target.SSHUser,
		Auth:    []ssh.AuthMethod{auth},
		Timeout: connectTimeout,
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			observed = ssh.FingerprintSHA256(key)
			if target.HostFingerprint != "" && observed != target.HostFingerprint {
				return errors.New("SSH host fingerprint mismatch")
			}
			return nil
		},
	}
	conn, err := dialSSHWithRetry(ctx, net.JoinHostPort(target.Host, strconv.Itoa(target.Port)), 3)
	if err != nil {
		if isTimeoutError(ctx, err) {
			result.Error = "TCP connection timed out before SSH handshake"
		} else {
			result.Error = sanitizeSSHError(err.Error())
		}
		result.LatencyMS = int(time.Since(started).Milliseconds())
		return nil, result, err
	}
	deadline := time.Now().Add(connectTimeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	_ = conn.SetDeadline(deadline)
	clientConn, channels, requests, err := ssh.NewClientConn(conn, net.JoinHostPort(target.Host, strconv.Itoa(target.Port)), config)
	result.LatencyMS = int(time.Since(started).Milliseconds())
	if observed != "" {
		result.HostFingerprint = observed
	}
	if err != nil {
		_ = conn.Close()
		if isTimeoutError(ctx, err) {
			result.Error = "SSH handshake timed out"
		} else {
			result.Error = sanitizeSSHError(err.Error())
		}
		return nil, result, err
	}
	client := ssh.NewClient(clientConn, channels, requests)
	_ = conn.SetDeadline(time.Time{})
	result.Status = "online"
	result.Error = ""
	result.FingerprintVerified = target.HostFingerprint != "" && observed == target.HostFingerprint
	return client, result, nil
}

const maxHealthOutputBytes = 256 * 1024
const maxHardwareValueLength = 255

const healthInventoryCommand = `sh -c '
os=""
if [ -r /etc/os-release ]; then
  while IFS="=" read -r key value; do
    if [ "$key" = "PRETTY_NAME" ]; then os="$value"; break; fi
  done < /etc/os-release
  os=${os#\"}; os=${os%\"}
fi
if [ -z "$os" ]; then os=$(uname -srm 2>/dev/null || uname -a); fi
printf "operating_system=%s\n" "$os"
host=$(hostname 2>/dev/null || true); if [ -z "$host" ]; then host=$(uname -n 2>/dev/null || true); fi
printf "hostname=%s\n" "$host"
printf "architecture=%s\n" "$(uname -m 2>/dev/null || true)"
printf "kernel=%s\n" "$(uname -r 2>/dev/null || true)"
cpu_model=""
if [ -r /proc/cpuinfo ]; then
  cpu_model=$(grep -m 1 "^model name[[:space:]]*:" /proc/cpuinfo 2>/dev/null | cut -d: -f2-)
  if [ -z "$cpu_model" ]; then cpu_model=$(grep -m 1 -E "^(Processor|processor|Hardware)[[:space:]]*:" /proc/cpuinfo 2>/dev/null | cut -d: -f2-); fi
fi
if [ -z "$cpu_model" ]; then cpu_model=$(uname -p 2>/dev/null || true); fi
if [ -z "$cpu_model" ] || [ "$cpu_model" = "unknown" ]; then cpu_model=$(uname -m 2>/dev/null || true); fi
cpu_model=${cpu_model#"${cpu_model%%[![:space:]]*}"}
printf "cpu_model=%s\n" "$cpu_model"
cpu_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)
case "$cpu_cores" in ""|0|*[!0-9]*) if [ -r /proc/cpuinfo ]; then cpu_cores=$(grep -c "^processor[[:space:]]*:" /proc/cpuinfo 2>/dev/null || true); fi;; esac
printf "cpu_cores=%s\n" "$cpu_cores"
if [ -r /proc/uptime ]; then read -r uptime rest < /proc/uptime; else uptime=0; fi
printf "uptime_seconds=%s\n" "${uptime%%.*}"
if [ -r /proc/stat ]; then read -r cpu a b c d e f g h rest < /proc/stat; printf "cpu1=%s %s %s %s %s %s %s %s\n" "$a" "$b" "$c" "$d" "$e" "$f" "$g" "$h"; sleep 0.25; read -r cpu a b c d e f g h rest < /proc/stat; printf "cpu2=%s %s %s %s %s %s %s %s\n" "$a" "$b" "$c" "$d" "$e" "$f" "$g" "$h"; fi
if [ -r /proc/meminfo ]; then
  while read -r key value unit; do case "$key" in MemTotal:) printf "memory_total_kb=%s\n" "$value";; MemAvailable:) printf "memory_available_kb=%s\n" "$value";; esac; done < /proc/meminfo
fi
set -- $(df -Pk / 2>/dev/null | tail -n 1); printf "disk_total_kb=%s\n" "$2"; printf "disk_percent=%s\n" "$5"
if command -v systemd-detect-virt >/dev/null 2>&1; then printf "virtualization=%s\n" "$(systemd-detect-virt 2>/dev/null || true)"; fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl --failed --no-legend --no-pager --plain 2>/dev/null | while read -r unit load active sub rest; do [ -n "$unit" ] && printf "service=%s|failed\n" "$unit"; done
  for unit in ssh sshd; do state=$(systemctl is-active "$unit" 2>/dev/null || true); [ "$state" != "unknown" ] && [ -n "$state" ] && printf "service=%s|%s\n" "$unit" "$state"; done
fi
'`

type healthInventory struct {
	OperatingSystem  string
	Hostname         string
	Architecture     string
	Kernel           string
	CPUModel         string
	CPUCores         int
	MemoryTotalBytes int64
	DiskTotalBytes   int64
	Virtualization   string
	UptimeSeconds    int64
	CPUPercent       float64
	MemoryPercent    float64
	DiskPercent      float64
	Services         []serviceHealthResponse
}

type limitedHealthBuffer struct {
	mu       sync.Mutex
	buffer   bytes.Buffer
	exceeded bool
}

func (b *limitedHealthBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	remaining := maxHealthOutputBytes - b.buffer.Len()
	if remaining <= 0 {
		b.exceeded = true
		return len(p), nil
	}
	if len(p) > remaining {
		b.exceeded = true
		_, _ = b.buffer.Write(p[:remaining])
		return len(p), nil
	}
	return b.buffer.Write(p)
}

func (b *limitedHealthBuffer) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.Len()
}

func (b *limitedHealthBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}

func collectHealthInventory(ctx context.Context, client *ssh.Client) (healthInventory, error) {
	session, err := client.NewSession()
	if err != nil {
		return healthInventory{}, err
	}
	defer session.Close()
	var output limitedHealthBuffer
	session.Stdout = &output
	session.Stderr = &output
	done := make(chan error, 1)
	go func() { done <- session.Run(healthInventoryCommand) }()
	select {
	case err = <-done:
	case <-ctx.Done():
		_ = session.Close()
		<-done
		return healthInventory{}, errors.New("SSH health command timed out")
	}
	if output.exceeded {
		return healthInventory{}, errors.New("SSH health output limit exceeded")
	}
	if err != nil {
		return healthInventory{}, fmt.Errorf("SSH health command failed: %w", err)
	}
	return parseHealthInventory(output.String())
}

func parseHealthInventory(output string) (healthInventory, error) {
	values := map[string]string{}
	services := []serviceHealthResponse{}
	for _, line := range strings.Split(output, "\n") {
		key, value, found := strings.Cut(strings.TrimSpace(line), "=")
		if !found {
			continue
		}
		if key == "service" {
			name, status, valid := strings.Cut(value, "|")
			if valid && name != "" && status != "" {
				services = append(services, serviceHealthResponse{Name: name, Status: status})
			}
			continue
		}
		values[key] = value
	}
	uptime, err := strconv.ParseInt(values["uptime_seconds"], 10, 64)
	if err != nil || uptime < 0 {
		return healthInventory{}, errors.New("invalid uptime in SSH health output")
	}
	operatingSystem := sanitizeHardwareValue(values["operating_system"], "")
	if operatingSystem == "" {
		return healthInventory{}, errors.New("missing operating system in SSH health output")
	}
	cpuCores, err := strconv.Atoi(strings.TrimSpace(values["cpu_cores"]))
	if err != nil || cpuCores <= 0 {
		return healthInventory{}, errors.New("invalid CPU core count in SSH health output")
	}
	cpu, err := cpuPercent(values["cpu1"], values["cpu2"])
	if err != nil {
		return healthInventory{}, err
	}
	memoryTotalBytes, err := kilobytesToBytes(values["memory_total_kb"])
	if err != nil {
		return healthInventory{}, errors.New("invalid memory total in SSH health output")
	}
	total := float64(memoryTotalBytes / 1024)
	available, err := strconv.ParseFloat(values["memory_available_kb"], 64)
	if err != nil {
		return healthInventory{}, errors.New("invalid memory available in SSH health output")
	}
	disk, err := strconv.ParseFloat(strings.TrimSuffix(values["disk_percent"], "%"), 64)
	if err != nil {
		return healthInventory{}, errors.New("invalid disk usage in SSH health output")
	}
	diskTotalBytes, err := kilobytesToBytes(values["disk_total_kb"])
	if err != nil {
		return healthInventory{}, errors.New("invalid disk total in SSH health output")
	}
	return healthInventory{
		OperatingSystem:  operatingSystem,
		Hostname:         sanitizeHardwareValue(values["hostname"], "unknown"),
		Architecture:     sanitizeHardwareValue(values["architecture"], "unknown"),
		Kernel:           sanitizeHardwareValue(values["kernel"], "unknown"),
		CPUModel:         sanitizeHardwareValue(values["cpu_model"], "unknown"),
		CPUCores:         cpuCores,
		MemoryTotalBytes: memoryTotalBytes,
		DiskTotalBytes:   diskTotalBytes,
		Virtualization:   sanitizeHardwareValue(values["virtualization"], ""),
		UptimeSeconds:    uptime,
		CPUPercent:       roundedPercent(cpu),
		MemoryPercent:    roundedPercent((total - available) / total * 100),
		DiskPercent:      roundedPercent(disk),
		Services:         services,
	}, nil
}

func kilobytesToBytes(value string) (int64, error) {
	kilobytes, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || kilobytes <= 0 || kilobytes > math.MaxInt64/1024 {
		return 0, errors.New("invalid kilobyte value")
	}
	return kilobytes * 1024, nil
}

func sanitizeHardwareValue(value, fallback string) string {
	value = strings.TrimSpace(strings.ToValidUTF8(value, ""))
	runes := []rune(value)
	if len(runes) > maxHardwareValueLength {
		value = string(runes[:maxHardwareValueLength])
	}
	if value == "" {
		return fallback
	}
	return value
}

func healthInventoryDetails(status, lastError string, inventory healthInventory) map[string]any {
	if status != "online" {
		return map[string]any{"error": lastError}
	}
	return map[string]any{
		"hostname":           inventory.Hostname,
		"architecture":       inventory.Architecture,
		"kernel":             inventory.Kernel,
		"cpu_model":          inventory.CPUModel,
		"cpu_cores":          inventory.CPUCores,
		"memory_total_bytes": inventory.MemoryTotalBytes,
		"disk_total_bytes":   inventory.DiskTotalBytes,
		"virtualization":     inventory.Virtualization,
		"collector":          "linux_procfs",
	}
}

func cpuPercent(first, second string) (float64, error) {
	parse := func(value string) ([]float64, error) {
		fields := strings.Fields(value)
		if len(fields) < 4 {
			return nil, errors.New("invalid CPU sample in SSH health output")
		}
		out := make([]float64, len(fields))
		for i, field := range fields {
			var err error
			out[i], err = strconv.ParseFloat(field, 64)
			if err != nil {
				return nil, errors.New("invalid CPU sample in SSH health output")
			}
		}
		return out, nil
	}
	a, err := parse(first)
	if err != nil {
		return 0, err
	}
	b, err := parse(second)
	if err != nil || len(a) != len(b) {
		return 0, errors.New("invalid CPU sample in SSH health output")
	}
	var totalDelta float64
	for i := range a {
		totalDelta += b[i] - a[i]
	}
	idleDelta := b[3] - a[3]
	if len(a) > 4 {
		idleDelta += b[4] - a[4]
	}
	if totalDelta <= 0 {
		return 0, errors.New("invalid CPU delta in SSH health output")
	}
	return (totalDelta - idleDelta) / totalDelta * 100, nil
}

func roundedPercent(value float64) float64 {
	value = math.Max(0, math.Min(100, value))
	return math.Round(value*10) / 10
}

func normalizedSSHTimeout(timeout time.Duration) time.Duration {
	if timeout <= 0 {
		return defaultSSHConnectTimeout
	}
	return timeout
}

func dialSSHWithRetry(ctx context.Context, address string, attempts int) (net.Conn, error) {
	if attempts < 1 {
		attempts = 1
	}
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		attemptTimeout := 15 * time.Second
		if deadline, ok := ctx.Deadline(); ok {
			remaining := time.Until(deadline)
			left := time.Duration(attempts - attempt)
			if share := remaining / left; share < attemptTimeout {
				attemptTimeout = share
			}
		}
		attemptCtx, cancel := context.WithTimeout(ctx, attemptTimeout)
		conn, err := (&net.Dialer{}).DialContext(attemptCtx, "tcp", address)
		cancel()
		if err == nil {
			return conn, nil
		}
		lastErr = err
		if attempt+1 < attempts {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Second):
			}
		}
	}
	return nil, lastErr
}

func isTimeoutError(ctx context.Context, err error) bool {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

func sanitizeSSHError(message string) string {
	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "fingerprint mismatch"):
		return "SSH host fingerprint mismatch"
	case strings.Contains(lower, "unable to authenticate") || strings.Contains(lower, "no auth"):
		return "SSH authentication failed"
	case strings.Contains(lower, "context canceled") || strings.Contains(lower, "operation was canceled"):
		return "SSH connection canceled"
	case strings.Contains(lower, "timeout") || strings.Contains(lower, "deadline exceeded"):
		return "SSH connection timed out"
	}
	message = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return ' '
		}
		return r
	}, message)
	if len(message) > 300 {
		message = message[:300]
	}
	if strings.TrimSpace(message) == "" {
		return "SSH connection failed"
	}
	return message
}
