package main

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	maxChatContent = 4000
	maxPlanSteps   = 8
)

var (
	serverIntentPattern  = regexp.MustCompile(`(?i)\b(server|service|layanan|systemd|systemctl|journal|logs?|uptime|cpu|memory|memori|ram|disk|filesystem|process|proses|docker|container|hostname|kernel|load|health|status|failed|running)\b`)
	actionIntentPattern  = regexp.MustCompile(`(?i)\b(check|show|inspect|explain|diagnose|list|view|monitor|troubleshoot|why|what|is|are|get|cek|periksa|lihat|jelaskan|tampilkan|diagnosa|diagnosis|pantau|mengapa|kenapa)\b`)
	deniedPromptPattern  = regexp.MustCompile(`(?i)(ignore (all |any |the )?(previous|prior|system|developer) instructions?|abaikan (semua )?(instruksi|perintah)|system prompt|reveal .{0,30}(secret|instruction)|bocorkan .{0,30}(rahasia|kunci|instruksi)|api[ _-]?key|private[ _-]?key|kunci (api|privat|rahasia)|password|kata sandi|credential|kredensial|environment (variables?|dump)|\benv dump\b|https?://|\b(logs?|journal|curl|wget|netcat|\bnc\b|nmap|port scan|network scan|ssh to|connect to|another (host|server))\b|creative writ|write (a )?(poem|story|essay)|tulis(kan)? (sebuah )?(puisi|cerita|esai)|general trivia|stock price|investment|cryptocurrency|credit card)`)
	hostLikePattern      = regexp.MustCompile(`(?i)(\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[a-z0-9-]+\.(?:com|net|org|io|dev|local|internal|cloud)\b)`)
	asciiTokenPattern    = regexp.MustCompile(`^[A-Za-z0-9-][A-Za-z0-9_.@:-]{0,127}$`)
	serviceTokenPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,127}$`)
	summaryIPPattern     = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)
	secretOutputPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(authorization\s*:\s*bearer\s+)[^\s]+`),
		regexp.MustCompile(`(?i)((?:api[_-]?key|password|passwd|secret)\s*[=:]\s*)[^\s]+`),
		regexp.MustCompile(`(?i)postgres(?:ql)?://[^\s]+`),
		regexp.MustCompile(`(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----`),
	}
)

func preferredResponseLanguage(prompt string) string {
	indonesian := regexp.MustCompile(`(?i)\b(lihat|cek|periksa|penyimpanan|ruang|kenapa|mengapa|tampilkan|server|layanan|memori|proses|kesehatan|gagal|berjalan)\b`)
	english := regexp.MustCompile(`(?i)\b(check|show|inspect|why|storage|space|memory|health|failed|running|please|the)\b`)
	if indonesian.MatchString(prompt) && !english.MatchString(prompt) {
		return "Bahasa Indonesia"
	}
	return "English"
}

func validateChatPrompt(content string) error {
	if err := validateChatContent(content); err != nil {
		return err
	}
	if deniedPromptPattern.MatchString(content) || hostLikePattern.MatchString(content) {
		return errors.New("request is outside permitted server management scope")
	}
	if !serverIntentPattern.MatchString(content) || !actionIntentPattern.MatchString(content) {
		return errors.New("request is outside permitted server management scope")
	}
	return nil
}

func validateChatContent(content string) error {
	if content != strings.TrimSpace(content) || content == "" || len([]rune(content)) > maxChatContent || strings.ContainsAny(content, "\x00\r") {
		return errors.New("invalid chat content")
	}
	return nil
}

func localChatResponse(content string) (string, bool) {
	if validateChatContent(content) != nil {
		return "", false
	}
	normalized := strings.ToLower(strings.TrimSpace(content))
	normalized = strings.Trim(normalized, "!.,? ")
	switch normalized {
	case "halo", "hai", "hello", "hi", "hey", "halo opsai", "hai opsai", "help", "bantuan", "bantu saya", "apa yang bisa kamu lakukan", "what can you do", "test", "testing", "testing chat", "tes", "tes chat":
		return "Halo! Saya siap membantu memeriksa kesehatan, resource, service, container, dan status server yang dipilih. Jelaskan pemeriksaan server yang ingin dilakukan.", true
	default:
		return "", false
	}
}

type planStep struct {
	Description string   `json:"description"`
	Executable  string   `json:"executable"`
	Args        []string `json:"args"`
}

type operationPlan struct {
	Title   string     `json:"title"`
	Summary string     `json:"summary"`
	Risk    string     `json:"risk"`
	Steps   []planStep `json:"steps"`
}

func validateOperationPlan(plan operationPlan) error {
	if strings.TrimSpace(plan.Title) == "" || len(plan.Title) > 200 || strings.TrimSpace(plan.Summary) == "" || len(plan.Summary) > 2000 || (plan.Risk != "low" && plan.Risk != "medium") || len(plan.Steps) == 0 || len(plan.Steps) > maxPlanSteps {
		return errors.New("invalid operation plan")
	}
	for _, step := range plan.Steps {
		if strings.TrimSpace(step.Description) == "" || len(step.Description) > 500 {
			return errors.New("invalid operation step")
		}
		if err := validateReadOnlyCommand(step.Executable, step.Args); err != nil {
			return err
		}
	}
	return nil
}

func validateReadOnlyCommand(executable string, args []string) error {
	if !asciiTokenPattern.MatchString(executable) || len(args) > 12 {
		return errors.New("command is not permitted")
	}
	for _, arg := range args {
		if len(arg) == 0 || len(arg) > 128 || (executable != "ps" && !asciiTokenPattern.MatchString(arg)) || strings.ContainsAny(arg, ";|&><`$*?!\\\n\r\t") {
			return errors.New("command argument is not permitted")
		}
	}
	switch executable {
	case "uptime", "hostname":
		if len(args) != 0 {
			return errors.New("command arguments are not permitted")
		}
	case "free":
		if len(args) > 1 || len(args) == 1 && args[0] != "-m" && args[0] != "-h" {
			return errors.New("free arguments are not permitted")
		}
	case "df":
		if !oneOfArgSets(args, nil, []string{"-h"}, []string{"-P"}, []string{"-h", "-P"}, []string{"-P", "-h"}) {
			return errors.New("df arguments are not permitted")
		}
	case "uname":
		if len(args) != 1 || (args[0] != "-a" && args[0] != "-r" && args[0] != "-m") {
			return errors.New("uname arguments are not permitted")
		}
	case "ps":
		if !oneOfArgSets(args, []string{"-eo", "pid,comm,pcpu,pmem"}) {
			return errors.New("ps arguments are not permitted")
		}
	case "systemctl":
		if err := validateSystemctl(args); err != nil {
			return err
		}
	case "docker":
		if err := validateDocker(args); err != nil {
			return err
		}
	default:
		return errors.New("executable is not permitted")
	}
	return nil
}

func oneOfArgSets(got []string, allowed ...[]string) bool {
	for _, set := range allowed {
		if len(got) != len(set) {
			continue
		}
		match := true
		for i := range got {
			match = match && got[i] == set[i]
		}
		if match {
			return true
		}
	}
	return false
}

func validateSystemctl(args []string) error {
	if oneOfArgSets(args, []string{"list-units", "--failed"}, []string{"--failed"}) {
		return nil
	}
	if len(args) != 2 || (args[0] != "is-active" && args[0] != "is-failed") || !serviceTokenPattern.MatchString(args[1]) || strings.HasPrefix(args[1], "-") || strings.Contains(args[1], "..") {
		return errors.New("systemctl arguments are not permitted")
	}
	return nil
}

func validateDocker(args []string) error {
	if oneOfArgSets(args, []string{"ps"}, []string{"ps", "-a"}) {
		return nil
	}
	return errors.New("docker arguments are not permitted")
}

func redactOperationalOutput(value string) string {
	for i, pattern := range secretOutputPatterns {
		if i == 2 || i == 3 {
			value = pattern.ReplaceAllString(value, "[REDACTED]")
		} else {
			value = pattern.ReplaceAllString(value, `${1}[REDACTED]`)
		}
	}
	return value
}

func redactSummaryOutput(value string) string {
	return summaryIPPattern.ReplaceAllString(redactOperationalOutput(value), "[REDACTED_IP]")
}

func shellQuoteCommand(executable string, args []string) (string, error) {
	if err := validateReadOnlyCommand(executable, args); err != nil {
		return "", err
	}
	parts := []string{shellQuote(executable)}
	for _, arg := range args {
		parts = append(parts, shellQuote(arg))
	}
	return strings.Join(parts, " "), nil
}

func shellQuote(value string) string { return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'" }

type planningLimiter struct {
	mu      sync.Mutex
	clients map[string]*loginWindow
	limit   int
	window  time.Duration
}

func newPlanningLimiter(limit int, window time.Duration) *planningLimiter {
	return &planningLimiter{clients: map[string]*loginWindow{}, limit: limit, window: window}
}

func (l *planningLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	w := l.clients[key]
	if w == nil || now.Sub(w.started) >= l.window {
		l.clients[key] = &loginWindow{started: now, count: 1}
		return true
	}
	w.count++
	return w.count <= l.limit
}

func planningRateKey(user, workspace fmt.Stringer) string {
	return user.String() + ":" + workspace.String()
}
