package main

import (
	"errors"
	"fmt"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	maxChatContent = 4000
	maxPlanSteps   = 8
)

var (
	asciiTokenPattern    = regexp.MustCompile(`^[A-Za-z0-9-][A-Za-z0-9_.@:-]{0,127}$`)
	serviceTokenPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,127}$`)
	findPattern          = regexp.MustCompile(`^\*?[A-Za-z0-9 _.-]+\*?$`)
	summaryIPPattern     = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)
	secretOutputPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(authorization\s*:\s*bearer\s+)[^\s]+`),
		regexp.MustCompile(`(?i)((?:api[_-]?key|password|passwd|secret)\s*[=:]\s*)[^\s]+`),
		regexp.MustCompile(`(?i)postgres(?:ql)?://[^\s]+`),
		regexp.MustCompile(`(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----`),
	}
)

func validateChatContent(content string) error {
	if content != strings.TrimSpace(content) || content == "" || len([]rune(content)) > maxChatContent {
		return errors.New("invalid chat content")
	}
	for _, r := range content {
		if unicode.IsControl(r) {
			return errors.New("invalid chat content")
		}
	}
	return nil
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
	return validateOperationPlanForPolicy(plan, "approval_required")
}

func validateOperationPlanForPolicy(plan operationPlan, policy string) error {
	if strings.TrimSpace(plan.Title) == "" || len(plan.Title) > 200 || strings.TrimSpace(plan.Summary) == "" || len(plan.Summary) > 2000 || (plan.Risk != "low" && plan.Risk != "medium" && !((policy == "unrestricted_approval" || policy == "autonomous_full_access") && plan.Risk == "high")) || len(plan.Steps) == 0 || len(plan.Steps) > maxPlanSteps {
		return errors.New("invalid operation plan")
	}
	for _, step := range plan.Steps {
		if strings.TrimSpace(step.Description) == "" || len(step.Description) > 500 {
			return errors.New("invalid operation step")
		}
		if err := validateCommandForPolicy(policy, step.Executable, step.Args); err != nil {
			return err
		}
	}
	return nil
}

func validateCommandForPolicy(policy, executable string, args []string) error {
	if policy == "unrestricted_approval" || policy == "autonomous_full_access" {
		_, err := serializeOperationCommand(policy, executable, args)
		return err
	}
	return validateReadOnlyCommand(executable, args)
}

func validateReadOnlyCommand(executable string, args []string) error {
	if !asciiTokenPattern.MatchString(executable) || len(args) > 12 {
		return errors.New("command is not permitted")
	}
	if executable == "du" {
		return validateDU(args)
	}
	if executable == "find" {
		return validateFind(args)
	}
	if executable == "ls" {
		if len(args) != 3 || args[0] != "-la" || args[1] != "--" {
			return errors.New("ls arguments are not permitted")
		}
		return validateSafeAbsolutePath(args[2])
	}
	if executable == "stat" {
		if len(args) != 2 || args[0] != "--" {
			return errors.New("stat arguments are not permitted")
		}
		return validateSafeAbsolutePath(args[1])
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

func validateDU(args []string) error {
	var target string
	if len(args) == 3 && args[0] == "-sh" && args[1] == "--" {
		target = args[2]
	} else if len(args) == 4 && args[0] == "-s" && args[1] == "--block-size=1" && args[2] == "--" {
		target = args[3]
	} else {
		return errors.New("du arguments are not permitted")
	}
	return validateSafeAbsolutePath(target)
}

func validateFind(args []string) error {
	if len(args) != 7 || args[1] != "-maxdepth" || args[3] != "-type" || args[4] != "d" || args[5] != "-iname" {
		return errors.New("find arguments are not permitted")
	}
	allowedRoot := false
	for _, root := range []string{"/root", "/home", "/var/backups", "/opt", "/srv", "/backup", "/backups"} {
		allowedRoot = allowedRoot || args[0] == root
	}
	depth, err := strconv.Atoi(args[2])
	pattern := args[6]
	name := strings.ToLower(strings.Trim(pattern, "*"))
	if !allowedRoot || err != nil || depth < 1 || depth > 6 || len(pattern) == 0 || len(pattern) > 100 || !findPattern.MatchString(pattern) || strings.Count(pattern, "*") > 2 || strings.Contains(name, "*") || sensitivePathPart(name) {
		return errors.New("find arguments are not permitted")
	}
	return nil
}

func validateSafeAbsolutePath(value string) error {
	if len(value) == 0 || len(value) > 512 || !strings.HasPrefix(value, "/") || strings.ContainsRune(value, 0) || (len(value) > 1 && strings.HasSuffix(value, "/")) {
		return errors.New("path is not permitted")
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return errors.New("path is not permitted")
		}
	}
	parts := strings.Split(value, "/")
	for _, part := range parts {
		lower := strings.ToLower(part)
		if part == ".." || sensitivePathPart(lower) {
			return errors.New("path is not permitted")
		}
	}
	clean := path.Clean(value)
	allowedRoot := false
	for _, root := range []string{"/root", "/home", "/var/backups", "/opt", "/srv", "/backup", "/backups"} {
		if strings.HasPrefix(clean, root+"/") {
			allowedRoot = true
			break
		}
	}
	if !allowedRoot {
		return errors.New("path is not permitted")
	}
	for _, blocked := range []string{"/proc", "/sys", "/dev", "/run/credentials", "/etc/shadow"} {
		if clean == blocked || strings.HasPrefix(clean, blocked+"/") {
			return errors.New("path is not permitted")
		}
	}
	return nil
}

func sensitivePathPart(lower string) bool {
	return strings.HasPrefix(lower, ".") || strings.HasSuffix(lower, ".pem") || strings.HasSuffix(lower, ".key") || strings.Contains(lower, "secret") || strings.Contains(lower, "credential") || strings.Contains(lower, "password") || strings.Contains(lower, "passwd") || strings.Contains(lower, "api_key") || strings.Contains(lower, "api-key") || strings.Contains(lower, "token")
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
