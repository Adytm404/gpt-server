package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
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
	return serverInput{Name: "Production", Host: "127.0.0.1", Port: 22, SSHUser: "deploy", Environment: "production", HostFingerprint: "SHA256:abcdefghijklmnop"}
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

func TestValidateServerCreateRequiresFingerprint(t *testing.T) {
	privateKey, _ := testPrivateKey(t)
	in := validServerInput()
	in.PrivateKey = privateKey
	in.HostFingerprint = ""
	if err := validateServerCreateInput(in); err == nil {
		t.Fatal("server without fingerprint accepted")
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
	uptime := int64(42)
	encoded, err := json.Marshal(serverResponse{
		AuthMethod:           authMethodPassword,
		CredentialConfigured: true,
		OperatingSystem:      "Ubuntu 24.04 LTS",
		UptimeSeconds:        &uptime,
		LatestSnapshot: &healthSnapshotResponse{
			Services: []serviceHealthResponse{{Name: "ssh", Status: "active"}},
			Details:  map[string]any{"collector": "linux_procfs"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	for _, field := range []string{`"auth_method":"password"`, `"credential_configured":true`, `"operating_system":"Ubuntu 24.04 LTS"`, `"uptime_seconds":42`, `"services":[{"name":"ssh","status":"active"}]`} {
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
	mu         sync.RWMutex
	listener   net.Listener
	hostSigner ssh.Signer
	userSigner ssh.Signer
	userKey    string
	password   string
	execOutput string
	execErr    string
	execDelay  time.Duration
	executed   chan string
}

func startTestSSHServer(t *testing.T) *testSSHServer {
	t.Helper()
	_, hostSigner := testPrivateKey(t)
	userKey, userSigner := testPrivateKey(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &testSSHServer{listener: listener, hostSigner: hostSigner, userSigner: userSigner, userKey: userKey, password: "ssh-password", executed: make(chan string, 1)}
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
					if channel.ChannelType() != "session" {
						_ = channel.Reject(ssh.UnknownChannelType, "unsupported")
						continue
					}
					ch, channelRequests, channelErr := channel.Accept()
					if channelErr != nil {
						continue
					}
					srv.mu.RLock()
					output, commandError, delay := srv.execOutput, srv.execErr, srv.execDelay
					srv.mu.RUnlock()
					go func(output, commandError string, delay time.Duration) {
						for req := range channelRequests {
							var payload struct{ Command string }
							if req.Type != "exec" || ssh.Unmarshal(req.Payload, &payload) != nil {
								req.Reply(false, nil)
								continue
							}
							srv.executed <- payload.Command
							req.Reply(true, nil)
							time.Sleep(delay)
							_, _ = io.Copy(ch, strings.NewReader(output))
							if commandError != "" {
								_, _ = io.Copy(ch.Stderr(), strings.NewReader(commandError))
							}
							status := uint32(0)
							if commandError != "" {
								status = 1
							}
							_ = ch.CloseWrite()
							_, _ = ch.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{status}))
							_ = ch.Close()
							return
						}
					}(output, commandError, delay)
				}
			}(conn)
		}
	}()
	t.Cleanup(func() { _ = listener.Close() })
	return srv
}

func (s *testSSHServer) setExec(output, commandError string, delay time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.execOutput = output
	s.execErr = commandError
	s.execDelay = delay
}

func TestParseHealthInventory(t *testing.T) {
	fixture := `operating_system=Ubuntu 24.04.1 LTS
hostname=api-01.example.internal
architecture=x86_64
kernel=6.8.0-52-generic
cpu_model=Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz
cpu_cores=8
uptime_seconds=98765
cpu1=100 10 40 850 0 0 0 0
cpu2=130 10 50 910 0 0 0 0
memory_total_kb=8000000
memory_available_kb=2000000
disk_total_kb=104857600
disk_percent=73%
virtualization=kvm
service=cron.service|failed
service=ssh|active
`
	got, err := parseHealthInventory(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if got.OperatingSystem != "Ubuntu 24.04.1 LTS" || got.UptimeSeconds != 98765 {
		t.Fatalf("identity = %+v", got)
	}
	if got.Hostname != "api-01.example.internal" || got.Architecture != "x86_64" || got.Kernel != "6.8.0-52-generic" || got.CPUModel != "Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz" || got.CPUCores != 8 || got.Virtualization != "kvm" {
		t.Fatalf("hardware = %+v", got)
	}
	if got.MemoryTotalBytes != 8192000000 || got.DiskTotalBytes != 107374182400 {
		t.Fatalf("capacity = %+v", got)
	}
	if got.CPUPercent != 40 || got.MemoryPercent != 75 || got.DiskPercent != 73 {
		t.Fatalf("metrics = cpu %.2f memory %.2f disk %.2f", got.CPUPercent, got.MemoryPercent, got.DiskPercent)
	}
	if len(got.Services) != 2 || got.Services[0].Name != "cron.service" || got.Services[0].Status != "failed" {
		t.Fatalf("services = %+v", got.Services)
	}
}

func TestParseHealthInventoryRejectsMalformedAndClampsPercentages(t *testing.T) {
	if _, err := parseHealthInventory("operating_system=Linux\nuptime_seconds=nope\n"); err == nil {
		t.Fatal("malformed uptime accepted")
	}
	valid := "operating_system=Linux\nhostname=node\narchitecture=aarch64\nkernel=6.1\ncpu_model=Neoverse-N1\ncpu_cores=4\nuptime_seconds=1\ncpu1=1 0 0 9\ncpu2=101 0 0 9\nmemory_total_kb=10\nmemory_available_kb=-5\ndisk_total_kb=20\ndisk_percent=120\n"
	got, err := parseHealthInventory(valid)
	if err != nil {
		t.Fatal(err)
	}
	if got.CPUPercent != 100 || got.MemoryPercent != 100 || got.DiskPercent != 100 {
		t.Fatalf("percentages not clamped: %+v", got)
	}
	for _, tc := range []struct{ old, replacement string }{
		{"cpu_cores=4", "cpu_cores=0"},
		{"cpu_cores=4", "cpu_cores=nope"},
		{"memory_total_kb=10", "memory_total_kb=0"},
		{"disk_total_kb=20", "disk_total_kb=0"},
	} {
		malformed := strings.Replace(valid, tc.old, tc.replacement, 1)
		if _, err := parseHealthInventory(malformed); err == nil {
			t.Errorf("malformed specification accepted: %s", tc.replacement)
		}
	}
}

func TestParseHealthInventorySanitizesHardwareStrings(t *testing.T) {
	fixture := "operating_system=Linux\nhostname=  node-01  \narchitecture=x86_64\nkernel=6.8\ncpu_model=" + strings.Repeat("x", maxHardwareValueLength+20) + "\ncpu_cores=2\nuptime_seconds=1\ncpu1=1 0 0 9\ncpu2=2 0 0 18\nmemory_total_kb=10\nmemory_available_kb=5\ndisk_total_kb=20\ndisk_percent=50\nvirtualization=none\n"
	got, err := parseHealthInventory(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if got.Hostname != "node-01" || len(got.CPUModel) != maxHardwareValueLength || got.Virtualization != "none" {
		t.Fatalf("sanitized hardware = %+v", got)
	}
}

func TestCollectHealthInventoryUsesFixedCommand(t *testing.T) {
	srv := startTestSSHServer(t)
	srv.setExec("operating_system=Debian GNU/Linux 12\nhostname=debian\narchitecture=x86_64\nkernel=6.1.0\ncpu_model=AMD EPYC\ncpu_cores=4\nuptime_seconds=12\ncpu1=1 0 1 8\ncpu2=2 0 2 16\nmemory_total_kb=100\nmemory_available_kb=40\ndisk_total_kb=1000\ndisk_percent=20\nservice=ssh|active\n", "", 0)
	client, _, err := dialAuthenticatedSSH(context.Background(), srv.target(authMethodPassword, ssh.FingerprintSHA256(srv.hostSigner.PublicKey())), srv.password)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	got, err := collectHealthInventory(context.Background(), client)
	if err != nil {
		t.Fatal(err)
	}
	if got.OperatingSystem != "Debian GNU/Linux 12" {
		t.Fatalf("inventory = %+v", got)
	}
	select {
	case command := <-srv.executed:
		if command != healthInventoryCommand {
			t.Fatalf("command changed: %q", command)
		}
	case <-time.After(time.Second):
		t.Fatal("health command not executed")
	}
}

func TestHealthInventoryCommandCollectsHardwareWithoutInterpolation(t *testing.T) {
	for _, required := range []string{"hostname", "uname -m", "uname -r", "/proc/cpuinfo", "model name", "processor", "Hardware", "getconf _NPROCESSORS_ONLN", "/proc/meminfo", "df -Pk /", "systemd-detect-virt"} {
		if !strings.Contains(healthInventoryCommand, required) {
			t.Errorf("health command missing %q", required)
		}
	}
}

func TestHealthInventoryDetails(t *testing.T) {
	inventory := healthInventory{Hostname: "node-01", Architecture: "x86_64", Kernel: "6.8", CPUModel: "AMD EPYC", CPUCores: 16, MemoryTotalBytes: 32 * 1024 * 1024 * 1024, DiskTotalBytes: 500 * 1024 * 1024 * 1024, Virtualization: "kvm"}
	details := healthInventoryDetails("online", "", inventory)
	want := map[string]any{"hostname": "node-01", "architecture": "x86_64", "kernel": "6.8", "cpu_model": "AMD EPYC", "cpu_cores": 16, "memory_total_bytes": int64(32 * 1024 * 1024 * 1024), "disk_total_bytes": int64(500 * 1024 * 1024 * 1024), "virtualization": "kvm", "collector": "linux_procfs"}
	if !reflect.DeepEqual(details, want) {
		t.Fatalf("details = %#v, want %#v", details, want)
	}
	failed := healthInventoryDetails("offline", "connection failed", inventory)
	if !reflect.DeepEqual(failed, map[string]any{"error": "connection failed"}) {
		t.Fatalf("failed details = %#v", failed)
	}
}

func TestCollectHealthInventoryHonorsContext(t *testing.T) {
	srv := startTestSSHServer(t)
	srv.setExec("", "", time.Second)
	client, _, err := dialAuthenticatedSSH(context.Background(), srv.target(authMethodPassword, ""), srv.password)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	started := time.Now()
	if _, err := collectHealthInventory(ctx, client); err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("timeout error = %v", err)
	}
	if time.Since(started) > time.Second {
		t.Fatalf("collector did not stop promptly: %s", time.Since(started))
	}
}

func TestHealthOutputBufferLimitsOutput(t *testing.T) {
	var output limitedHealthBuffer
	written, err := output.Write([]byte(strings.Repeat("x", maxHealthOutputBytes+1)))
	if err != nil || written != maxHealthOutputBytes+1 || !output.exceeded || output.Len() != maxHealthOutputBytes {
		t.Fatalf("buffer written=%d len=%d exceeded=%v err=%v", written, output.Len(), output.exceeded, err)
	}
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
