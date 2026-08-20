package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

func testEncryptionKey() string {
	return base64.StdEncoding.EncodeToString(make([]byte, 32))
}

func testPrivateKey(t *testing.T) (string, ssh.Signer) {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	encoded := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	signer, err := ssh.ParsePrivateKey(encoded)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded), signer
}

func validServerInput() serverInput {
	return serverInput{Name: "Production", Host: "127.0.0.1", Port: 22, SSHUser: "deploy", Environment: "production"}
}

func TestValidateServerCreateCredentials(t *testing.T) {
	privateKey, _ := testPrivateKey(t)
	keyInput := validServerInput()
	keyInput.PrivateKey = privateKey
	if err := validateServerCreateInput(keyInput); err != nil {
		t.Fatalf("legacy key input rejected: %v", err)
	}

	passwordInput := validServerInput()
	passwordInput.AuthMethod = authMethodPassword
	passwordInput.Password = "correct horse battery staple"
	if err := validateServerCreateInput(passwordInput); err != nil {
		t.Fatalf("password input rejected: %v", err)
	}

	invalid := []serverInput{
		validServerInput(),
		func() serverInput { in := validServerInput(); in.PrivateKey = "not a key"; return in }(),
		func() serverInput { in := validServerInput(); in.AuthMethod = authMethodPassword; return in }(),
		func() serverInput { in := passwordInput; in.Password = strings.Repeat("x", 4097); return in }(),
		func() serverInput { in := passwordInput; in.PrivateKey = privateKey; return in }(),
		func() serverInput { in := keyInput; in.Password = "secret"; return in }(),
	}
	for _, in := range invalid {
		if err := validateServerCreateInput(in); err == nil {
			t.Errorf("invalid create credentials accepted: method=%q", in.AuthMethod)
		}
	}
}

func TestValidateServerUpdateCredentials(t *testing.T) {
	privateKey, _ := testPrivateKey(t)
	keyUpdate := validServerInput()
	if err := validateServerUpdateInput(keyUpdate, authMethodSSHKey, true, false); err != nil {
		t.Fatalf("blank key did not preserve existing key: %v", err)
	}
	passwordUpdate := validServerInput()
	passwordUpdate.AuthMethod = authMethodPassword
	passwordUpdate.Password = "new secret"
	if err := validateServerUpdateInput(passwordUpdate, authMethodSSHKey, true, false); err != nil {
		t.Fatalf("method switch with password rejected: %v", err)
	}
	passwordUpdate.Password = ""
	if err := validateServerUpdateInput(passwordUpdate, authMethodSSHKey, true, false); err == nil {
		t.Fatal("method switch without new password accepted")
	}
	keyUpdate.PrivateKey = privateKey
	if err := validateServerUpdateInput(keyUpdate, authMethodSSHKey, true, false); err != nil {
		t.Fatalf("replacement key rejected: %v", err)
	}
}

func TestEncryptDecryptServerCredential(t *testing.T) {
	ciphertext, err := encryptServerCredential(testEncryptionKey(), "top secret")
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := decryptServerCredential(testEncryptionKey(), ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != "top secret" {
		t.Fatalf("plaintext = %q", plaintext)
	}
	if _, err := decryptServerCredential(testEncryptionKey(), append([]byte(nil), ciphertext[:5]...)); err == nil {
		t.Fatal("short ciphertext accepted")
	}
}

func TestServerResponseAuthContractOmitsCredentials(t *testing.T) {
	encoded, err := json.Marshal(serverResponse{AuthMethod: authMethodPassword, CredentialConfigured: true})
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	for _, field := range []string{`"auth_method":"password"`, `"credential_configured":true`} {
		if !strings.Contains(text, field) {
			t.Errorf("response missing %s: %s", field, text)
		}
	}
	for _, forbidden := range []string{`"password":`, `"private_key":`, `"ciphertext":`, `"password_ciphertext":`, `"private_key_ciphertext":`} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("response leaks credential field %q: %s", forbidden, text)
		}
	}
}

func TestServerDraftTestRequiresOwnerAndValidCredential(t *testing.T) {
	for _, tc := range []struct {
		role string
		want int
	}{
		{role: "operator", want: http.StatusForbidden},
		{role: "owner", want: http.StatusBadRequest},
	} {
		s := &server{cfg: config{frontendOrigin: "https://app.example.com"}, resolveSession: func(context.Context, string) (sessionAuth, error) {
			return sessionAuth{UserID: uuid.New(), WorkspaceID: uuid.New(), WorkspaceRole: tc.role}, nil
		}}
		req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/test-draft", strings.NewReader(`{"name":"x","host":"127.0.0.1","port":22,"ssh_user":"deploy","environment":"production","private_key":"bad"}`))
		req.Header.Set("Origin", "https://app.example.com")
		req.Header.Set("X-CSRF-Token", "token")
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: "opaque"})
		req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "token"})
		rec := httptest.NewRecorder()
		s.routes().ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Fatalf("role %s status=%d want=%d body=%s", tc.role, rec.Code, tc.want, rec.Body.String())
		}
	}
}

type testSSHServer struct {
	listener   net.Listener
	hostSigner ssh.Signer
	userSigner ssh.Signer
	userKey    string
	password   string
}

func startTestSSHServer(t *testing.T) *testSSHServer {
	t.Helper()
	_, hostSigner := testPrivateKey(t)
	userKey, userSigner := testPrivateKey(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &testSSHServer{listener: listener, hostSigner: hostSigner, userSigner: userSigner, userKey: userKey, password: "ssh-password"}
	config := &ssh.ServerConfig{
		PasswordCallback: func(_ ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			if string(password) == srv.password {
				return nil, nil
			}
			return nil, ssh.ErrNoAuth
		},
		PublicKeyCallback: func(_ ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if string(key.Marshal()) == string(srv.userSigner.PublicKey().Marshal()) {
				return nil, nil
			}
			return nil, ssh.ErrNoAuth
		},
	}
	config.AddHostKey(hostSigner)
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go func(conn net.Conn) {
				defer conn.Close()
				sshConn, channels, requests, handshakeErr := ssh.NewServerConn(conn, config)
				if handshakeErr != nil {
					return
				}
				defer sshConn.Close()
				go ssh.DiscardRequests(requests)
				for channel := range channels {
					_ = channel.Reject(ssh.UnknownChannelType, "unsupported")
				}
			}(conn)
		}
	}()
	t.Cleanup(func() { _ = listener.Close() })
	return srv
}

func (s *testSSHServer) target(method, fingerprint string) sshConnectionTarget {
	host, port, _ := net.SplitHostPort(s.listener.Addr().String())
	portNumber, _ := net.LookupPort("tcp", port)
	return sshConnectionTarget{Host: host, Port: portNumber, SSHUser: "deploy", AuthMethod: method, HostFingerprint: fingerprint}
}

func TestSSHConnectionPasswordAndKey(t *testing.T) {
	srv := startTestSSHServer(t)
	fingerprint := ssh.FingerprintSHA256(srv.hostSigner.PublicKey())

	passwordResult := testSSHConnection(context.Background(), srv.target(authMethodPassword, fingerprint), srv.password)
	if passwordResult.Status != "online" || !passwordResult.FingerprintVerified || passwordResult.HostFingerprint != fingerprint {
		t.Fatalf("password result = %+v", passwordResult)
	}

	keyResult := testSSHConnection(context.Background(), srv.target(authMethodSSHKey, fingerprint), srv.userKey)
	if keyResult.Status != "online" || !keyResult.FingerprintVerified {
		t.Fatalf("key result = %+v", keyResult)
	}
}

func TestSSHConnectionFailuresAndFingerprintDiscovery(t *testing.T) {
	srv := startTestSSHServer(t)
	observed := ssh.FingerprintSHA256(srv.hostSigner.PublicKey())

	discovered := testSSHConnection(context.Background(), srv.target(authMethodPassword, ""), srv.password)
	if discovered.Status != "online" || discovered.FingerprintVerified || discovered.HostFingerprint != observed {
		t.Fatalf("discovery result = %+v", discovered)
	}

	wrongPassword := testSSHConnection(context.Background(), srv.target(authMethodPassword, observed), "wrong")
	if wrongPassword.Status != "offline" || wrongPassword.Error == "" || strings.Contains(wrongPassword.Error, "wrong") {
		t.Fatalf("wrong password result = %+v", wrongPassword)
	}

	mismatch := testSSHConnection(context.Background(), srv.target(authMethodPassword, "SHA256:not-the-host"), srv.password)
	if mismatch.Status != "offline" || mismatch.FingerprintVerified || mismatch.HostFingerprint != observed {
		t.Fatalf("fingerprint mismatch result = %+v", mismatch)
	}
}

func TestSSHConnectionHonorsCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	result := testSSHConnection(ctx, sshConnectionTarget{Host: "192.0.2.1", Port: 22, SSHUser: "x", AuthMethod: authMethodPassword}, "secret")
	if result.Status != "offline" || time.Since(started) > time.Second {
		t.Fatalf("cancelled result=%+v duration=%s", result, time.Since(started))
	}
}

func TestDialSSHRetryHonorsDeadlineAndReportsTCPPhase(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := dialSSHWithRetry(ctx, "192.0.2.1:22", 3)
	if err == nil || time.Since(started) > time.Second {
		t.Fatalf("retry err=%v duration=%s", err, time.Since(started))
	}
	if !isTimeoutError(ctx, err) {
		t.Fatalf("timeout not recognized: %v", err)
	}
	result := testSSHConnection(ctx, sshConnectionTarget{Host: "192.0.2.1", Port: 22, SSHUser: "root", AuthMethod: authMethodPassword}, "secret")
	if result.Error != "TCP connection timed out before SSH handshake" {
		t.Fatalf("error = %q", result.Error)
	}
}
