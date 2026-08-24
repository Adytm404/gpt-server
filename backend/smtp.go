package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type platformSMTPSettings struct {
	Host                     string    `json:"host"`
	Port                     int       `json:"port"`
	Username                 string    `json:"username"`
	FromEmail                string    `json:"from_email"`
	FromName                 string    `json:"from_name"`
	Encryption               string    `json:"encryption"`
	Enabled                  bool      `json:"enabled"`
	RequireEmailVerification bool      `json:"require_email_verification"`
	HasPassword              bool      `json:"has_password"`
	UpdatedAt                string    `json:"updated_at,omitempty"`
}

type updateSMTPInput struct {
	Host                     string `json:"host"`
	Port                     int    `json:"port"`
	Username                 string `json:"username"`
	Password                 string `json:"password,omitempty"`
	FromEmail                string `json:"from_email"`
	FromName                 string `json:"from_name"`
	Encryption               string `json:"encryption"`
	Enabled                  bool   `json:"enabled"`
	RequireEmailVerification bool   `json:"require_email_verification"`
}

type testSMTPInput struct {
	RecipientEmail string `json:"recipient_email"`
}

func (s *server) loadSMTPSettings(ctx context.Context) (platformSMTPSettings, string, error) {
	var out platformSMTPSettings
	var ciphertext []byte
	var updated time.Time
	err := s.db.QueryRow(ctx, `
SELECT host, port, username, password_ciphertext, from_email, from_name, encryption, enabled, require_email_verification, updated_at
FROM platform_smtp_settings
WHERE id = 'default'`).Scan(&out.Host, &out.Port, &out.Username, &ciphertext, &out.FromEmail, &out.FromName, &out.Encryption, &out.Enabled, &out.RequireEmailVerification, &updated)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return platformSMTPSettings{Port: 587, Encryption: "starttls", FromName: "OpsAI"}, "", nil
		}
		return out, "", err
	}

	out.HasPassword = len(ciphertext) > 0
	if !updated.IsZero() {
		out.UpdatedAt = updated.Format(time.RFC3339)
	}

	var password string
	if len(ciphertext) > 0 {
		password, _ = decryptServerCredential(s.cfg.serverKeyEncryptionKey, ciphertext)
	}

	return out, password, nil
}

func (s *server) getAdminSMTP(w http.ResponseWriter, r *http.Request) {
	settings, _, err := s.loadSMTPSettings(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, settings)
}

func (s *server) setAdminSMTP(w http.ResponseWriter, r *http.Request) {
	var in updateSMTPInput
	if err := decodeJSON(r, &in); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid request payload")
		return
	}

	in.Host = strings.TrimSpace(in.Host)
	in.Username = strings.TrimSpace(in.Username)
	in.Password = strings.TrimSpace(in.Password)
	in.FromEmail = strings.TrimSpace(in.FromEmail)
	in.FromName = strings.TrimSpace(in.FromName)
	in.Encryption = strings.ToLower(strings.TrimSpace(in.Encryption))

	if in.Port <= 0 || in.Port > 65535 {
		in.Port = 587
	}
	if in.Encryption != "tls" && in.Encryption != "starttls" && in.Encryption != "none" {
		in.Encryption = "starttls"
	}
	if in.FromName == "" {
		in.FromName = "OpsAI"
	}

	var ciphertext []byte
	if in.Password != "" {
		var err error
		ciphertext, err = encryptServerCredential(s.cfg.serverKeyEncryptionKey, in.Password)
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
INSERT INTO platform_smtp_settings (id, host, port, username, password_ciphertext, from_email, from_name, encryption, enabled, require_email_verification, updated_at)
VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9, now())
ON CONFLICT (id) DO UPDATE SET
  host = EXCLUDED.host,
  port = EXCLUDED.port,
  username = EXCLUDED.username,
  password_ciphertext = EXCLUDED.password_ciphertext,
  from_email = EXCLUDED.from_email,
  from_name = EXCLUDED.from_name,
  encryption = EXCLUDED.encryption,
  enabled = EXCLUDED.enabled,
  require_email_verification = EXCLUDED.require_email_verification,
  updated_at = now()`, in.Host, in.Port, in.Username, ciphertext, in.FromEmail, in.FromName, in.Encryption, in.Enabled, in.RequireEmailVerification)
	} else {
		_, err = tx.Exec(r.Context(), `
INSERT INTO platform_smtp_settings (id, host, port, username, from_email, from_name, encryption, enabled, require_email_verification, updated_at)
VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, now())
ON CONFLICT (id) DO UPDATE SET
  host = EXCLUDED.host,
  port = EXCLUDED.port,
  username = EXCLUDED.username,
  from_email = EXCLUDED.from_email,
  from_name = EXCLUDED.from_name,
  encryption = EXCLUDED.encryption,
  enabled = EXCLUDED.enabled,
  require_email_verification = EXCLUDED.require_email_verification,
  updated_at = now()`, in.Host, in.Port, in.Username, in.FromEmail, in.FromName, in.Encryption, in.Enabled, in.RequireEmailVerification)
	}

	if err != nil {
		s.dbError(w, r, err)
		return
	}

	_ = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "smtp", "Updated SMTP platform settings", uuid.Nil, in.Host, nil)

	if err = tx.Commit(r.Context()); err != nil {
		s.dbError(w, r, err)
		return
	}

	s.getAdminSMTP(w, r)
}

func (s *server) testAdminSMTP(w http.ResponseWriter, r *http.Request) {
	var in testSMTPInput
	_ = decodeJSON(r, &in)

	recipient := strings.TrimSpace(in.RecipientEmail)
	if recipient == "" {
		a := authFrom(r.Context())
		var adminEmail string
		_ = s.db.QueryRow(r.Context(), `SELECT email FROM users WHERE id = $1`, a.UserID).Scan(&adminEmail)
		recipient = adminEmail
	}
	if recipient == "" || !validEmail(recipient) {
		s.writeError(w, r, http.StatusBadRequest, "valid recipient email required")
		return
	}

	settings, password, err := s.loadSMTPSettings(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}

	if settings.Host == "" {
		s.writeError(w, r, http.StatusBadRequest, "SMTP host is not configured")
		return
	}

	subject := "OpsAI - Test Email Connection"
	body := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; line-height: 1.5; color: #17171b; padding: 20px;">
  <h2 style="color: #7657ff;">OpsAI SMTP Test</h2>
  <p>This is a test email sent from your OpsAI platform instance to verify SMTP configuration.</p>
  <p><strong>Time:</strong> %s</p>
  <p><strong>Host:</strong> %s:%d</p>
  <hr style="border: none; border-top: 1px solid #e7e7e3; margin: 20px 0;" />
  <small style="color: #72727c;">OpsAI Infrastructure Control Plane</small>
</body>
</html>`, time.Now().UTC().Format(time.RFC1123), settings.Host, settings.Port)

	sendErr := sendEmailDirect(settings, password, recipient, subject, body)
	if sendErr != nil {
		s.writeError(w, r, http.StatusBadGateway, fmt.Sprintf("SMTP test failed: %v", sendErr))
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]any{"success": true, "recipient": recipient, "message": "Test email sent successfully"})
}

func sendEmailDirect(settings platformSMTPSettings, password, to, subject, htmlBody string) error {
	addr := net.JoinHostPort(settings.Host, strconv.Itoa(settings.Port))
	from := settings.FromEmail
	if from == "" {
		from = settings.Username
	}
	if from == "" {
		from = "no-reply@opsai.local"
	}

	fromHeader := fmt.Sprintf("%s <%s>", settings.FromName, from)
	headers := make(map[string]string)
	headers["From"] = fromHeader
	headers["To"] = to
	headers["Subject"] = subject
	headers["MIME-Version"] = "1.0"
	headers["Content-Type"] = "text/html; charset=UTF-8"
	headers["Date"] = time.Now().Format(time.RFC1123Z)

	var msgBuilder strings.Builder
	for k, v := range headers {
		msgBuilder.WriteString(fmt.Sprintf("%s: %s\r\n", k, v))
	}
	msgBuilder.WriteString("\r\n")
	msgBuilder.WriteString(htmlBody)
	messageBytes := []byte(msgBuilder.String())

	var auth smtp.Auth
	if settings.Username != "" {
		auth = smtp.PlainAuth("", settings.Username, password, settings.Host)
	}

	if settings.Encryption == "tls" {
		tlsConfig := &tls.Config{
			ServerName: settings.Host,
		}
		conn, err := tls.Dial("tcp", addr, tlsConfig)
		if err != nil {
			return fmt.Errorf("tls dial failed: %w", err)
		}
		defer conn.Close()

		c, err := smtp.NewClient(conn, settings.Host)
		if err != nil {
			return fmt.Errorf("smtp client creation failed: %w", err)
		}
		defer c.Close()

		if auth != nil {
			if ok, _ := c.Extension("AUTH"); ok {
				if err = c.Auth(auth); err != nil {
					return fmt.Errorf("smtp auth failed: %w", err)
				}
			}
		}

		if err = c.Mail(from); err != nil {
			return fmt.Errorf("smtp mail command failed: %w", err)
		}
		if err = c.Rcpt(to); err != nil {
			return fmt.Errorf("smtp rcpt command failed: %w", err)
		}
		w, err := c.Data()
		if err != nil {
			return fmt.Errorf("smtp data command failed: %w", err)
		}
		_, err = w.Write(messageBytes)
		if err != nil {
			return fmt.Errorf("smtp write body failed: %w", err)
		}
		err = w.Close()
		if err != nil {
			return fmt.Errorf("smtp close data failed: %w", err)
		}
		return c.Quit()
	}

	// For starttls or plain
	c, err := smtp.Dial(addr)
	if err != nil {
		return fmt.Errorf("smtp dial failed: %w", err)
	}
	defer c.Close()

	if settings.Encryption == "starttls" {
		tlsConfig := &tls.Config{
			ServerName: settings.Host,
		}
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err = c.StartTLS(tlsConfig); err != nil {
				return fmt.Errorf("starttls failed: %w", err)
			}
		}
	}

	if auth != nil {
		if ok, _ := c.Extension("AUTH"); ok {
			if err = c.Auth(auth); err != nil {
				return fmt.Errorf("smtp auth failed: %w", err)
			}
		}
	}

	if err = c.Mail(from); err != nil {
		return fmt.Errorf("smtp mail command failed: %w", err)
	}
	if err = c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt command failed: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data command failed: %w", err)
	}
	_, err = w.Write(messageBytes)
	if err != nil {
		return fmt.Errorf("smtp write body failed: %w", err)
	}
	err = w.Close()
	if err != nil {
		return fmt.Errorf("smtp close data failed: %w", err)
	}
	return c.Quit()
}

func (s *server) createAndSendVerificationEmail(ctx context.Context, userID uuid.UUID, recipientEmail, recipientName string) error {
	settings, password, err := s.loadSMTPSettings(ctx)
	if err != nil || !settings.Enabled {
		return nil
	}

	rawTokenBytes := make([]byte, 32)
	if _, err := rand.Read(rawTokenBytes); err != nil {
		return err
	}
	rawToken := hex.EncodeToString(rawTokenBytes)
	hash := sha256.Sum256([]byte(rawToken))

	tokenID := uuid.New()
	expiresAt := time.Now().Add(24 * time.Hour)

	_, err = s.db.Exec(ctx, `
INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
VALUES ($1, $2, $3, $4)`, tokenID, userID, hash[:], expiresAt)
	if err != nil {
		return err
	}

	verifyURL := fmt.Sprintf("%s/verify-email?token=%s", s.cfg.frontendOrigin, rawToken)
	subject := "Verify your email address - OpsAI"
	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; line-height: 1.6; color: #17171b; max-width: 540px; margin: 0 auto; padding: 30px 20px;">
  <div style="margin-bottom: 24px;">
    <h1 style="font-size: 24px; color: #17171b; margin: 0 0 8px;">Welcome to OpsAI, %s</h1>
    <p style="color: #72727c; font-size: 14px; margin: 0;">Please verify your email address to activate your workspace account.</p>
  </div>
  <div style="padding: 24px; background: #f8f8f6; border: 1px solid #e7e7e3; border-radius: 12px; margin: 24px 0; text-align: center;">
    <a href="%s" style="display: inline-block; padding: 12px 28px; background: #7657ff; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">Verify Email Address</a>
  </div>
  <p style="font-size: 12px; color: #72727c;">Or copy and paste this link in your browser:<br /><a href="%s" style="color: #7657ff;">%s</a></p>
  <p style="font-size: 12px; color: #72727c; margin-top: 20px;">This link will expire in 24 hours.</p>
  <hr style="border: none; border-top: 1px solid #e7e7e3; margin: 24px 0;" />
  <small style="color: #aaaab0; font-size: 11px;">OpsAI Infrastructure Control Plane</small>
</body>
</html>`, recipientName, verifyURL, verifyURL, verifyURL)

	go func() {
		if err := sendEmailDirect(settings, password, recipientEmail, subject, htmlBody); err != nil {
			log.Printf("failed to send verification email to %s: %v", recipientEmail, err)
		}
	}()

	return nil
}

func (s *server) createAndSendPasswordResetEmail(ctx context.Context, userID uuid.UUID, recipientEmail, recipientName string) error {
	settings, password, err := s.loadSMTPSettings(ctx)
	if err != nil || !settings.Enabled {
		return nil
	}

	rawTokenBytes := make([]byte, 32)
	if _, err := rand.Read(rawTokenBytes); err != nil {
		return err
	}
	rawToken := hex.EncodeToString(rawTokenBytes)
	hash := sha256.Sum256([]byte(rawToken))

	tokenID := uuid.New()
	expiresAt := time.Now().Add(1 * time.Hour)

	_, err = s.db.Exec(ctx, `
INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
VALUES ($1, $2, $3, $4)`, tokenID, userID, hash[:], expiresAt)
	if err != nil {
		return err
	}

	resetURL := fmt.Sprintf("%s/reset-password?token=%s", s.cfg.frontendOrigin, rawToken)
	subject := "Reset your OpsAI password"
	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; line-height: 1.6; color: #17171b; max-width: 540px; margin: 0 auto; padding: 30px 20px;">
  <div style="margin-bottom: 24px;">
    <h1 style="font-size: 24px; color: #17171b; margin: 0 0 8px;">Password Reset Request</h1>
    <p style="color: #72727c; font-size: 14px; margin: 0;">Hello %s, we received a request to reset your password for OpsAI.</p>
  </div>
  <div style="padding: 24px; background: #f8f8f6; border: 1px solid #e7e7e3; border-radius: 12px; margin: 24px 0; text-align: center;">
    <a href="%s" style="display: inline-block; padding: 12px 28px; background: #7657ff; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">Reset Password</a>
  </div>
  <p style="font-size: 12px; color: #72727c;">Or copy and paste this link in your browser:<br /><a href="%s" style="color: #7657ff;">%s</a></p>
  <p style="font-size: 12px; color: #72727c; margin-top: 20px;">This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #e7e7e3; margin: 24px 0;" />
  <small style="color: #aaaab0; font-size: 11px;">OpsAI Infrastructure Control Plane</small>
</body>
</html>`, recipientName, resetURL, resetURL, resetURL)

	go func() {
		if err := sendEmailDirect(settings, password, recipientEmail, subject, htmlBody); err != nil {
			log.Printf("failed to send password reset email to %s: %v", recipientEmail, err)
		}
	}()

	return nil
}

func (s *server) sendServerDownAlarm(ctx context.Context, serverName, serverHost string, serverPort int, failureReason string, recipients []string) {
	settings, password, err := s.loadSMTPSettings(ctx)
	if err != nil || !settings.Enabled || len(recipients) == 0 {
		return
	}

	subject := fmt.Sprintf("[ALARM] Server Down: %s (%s:%d)", serverName, serverHost, serverPort)
	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; line-height: 1.6; color: #17171b; max-width: 560px; margin: 0 auto; padding: 30px 20px;">
  <div style="background: #fff5f5; border: 1px solid #fed7d7; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
    <h2 style="color: #e53e3e; margin: 0 0 8px; font-size: 18px;">🔴 Server Unreachable (Down Alarm)</h2>
    <p style="margin: 0; font-size: 14px; color: #742a2a;">The target server has failed continuous reachability checks (TCP SSH port ping) for over 5 minutes.</p>
  </div>
  <table style="width: 100%%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
    <tr style="border-bottom: 1px solid #e7e7e3;">
      <td style="padding: 8px 0; color: #72727c; width: 140px;">Server Name</td>
      <td style="padding: 8px 0; font-weight: 600;">%s</td>
    </tr>
    <tr style="border-bottom: 1px solid #e7e7e3;">
      <td style="padding: 8px 0; color: #72727c;">Host / Port</td>
      <td style="padding: 8px 0;">%s:%d</td>
    </tr>
    <tr style="border-bottom: 1px solid #e7e7e3;">
      <td style="padding: 8px 0; color: #72727c;">Detected Time</td>
      <td style="padding: 8px 0;">%s</td>
    </tr>
    <tr style="border-bottom: 1px solid #e7e7e3;">
      <td style="padding: 8px 0; color: #72727c;">Failure Detail</td>
      <td style="padding: 8px 0; color: #e53e3e;">%s</td>
    </tr>
  </table>
  <p style="font-size: 12px; color: #72727c;">Check your network routing, firewall rules, or target VPS power status in the OpsAI console.</p>
  <hr style="border: none; border-top: 1px solid #e7e7e3; margin: 20px 0;" />
  <small style="color: #aaaab0; font-size: 11px;">OpsAI Automated Infrastructure Monitoring</small>
</body>
</html>`, serverName, serverHost, serverPort, time.Now().UTC().Format(time.RFC1123), failureReason)

	for _, recipient := range recipients {
		recipient = strings.TrimSpace(recipient)
		if recipient != "" && validEmail(recipient) {
			to := recipient
			go func() {
				_ = sendEmailDirect(settings, password, to, subject, htmlBody)
			}()
		}
	}
}

func (s *server) sendServerRestoredAlarm(ctx context.Context, serverName, serverHost string, serverPort int, recipients []string) {
	settings, password, err := s.loadSMTPSettings(ctx)
	if err != nil || !settings.Enabled || len(recipients) == 0 {
		return
	}

	subject := fmt.Sprintf("[RESOLVED] Server Restored: %s (%s:%d) is back online", serverName, serverHost, serverPort)
	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; line-height: 1.6; color: #17171b; max-width: 560px; margin: 0 auto; padding: 30px 20px;">
  <div style="background: #f0fff4; border: 1px solid #c6f6d5; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
    <h2 style="color: #22543d; margin: 0 0 8px; font-size: 18px;">🟢 Server Online (Recovered)</h2>
    <p style="margin: 0; font-size: 14px; color: #276749;">The target server is responding to reachability checks and is back online.</p>
  </div>
  <table style="width: 100%%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
    <tr style="border-bottom: 1px solid #e7e7e3;">
      <td style="padding: 8px 0; color: #72727c; width: 140px;">Server Name</td>
      <td style="padding: 8px 0; font-weight: 600;">%s</td>
    </tr>
    <tr style="border-bottom: 1px solid #e7e7e3;">
      <td style="padding: 8px 0; color: #72727c;">Host / Port</td>
      <td style="padding: 8px 0;">%s:%d</td>
    </tr>
    <tr style="border-bottom: 1px solid #e7e7e3;">
      <td style="padding: 8px 0; color: #72727c;">Restored Time</td>
      <td style="padding: 8px 0;">%s</td>
    </tr>
  </table>
  <hr style="border: none; border-top: 1px solid #e7e7e3; margin: 20px 0;" />
  <small style="color: #aaaab0; font-size: 11px;">OpsAI Automated Infrastructure Monitoring</small>
</body>
</html>`, serverName, serverHost, serverPort, time.Now().UTC().Format(time.RFC1123))

	for _, recipient := range recipients {
		recipient = strings.TrimSpace(recipient)
		if recipient != "" && validEmail(recipient) {
			to := recipient
			go func() {
				_ = sendEmailDirect(settings, password, to, subject, htmlBody)
			}()
		}
	}
}
