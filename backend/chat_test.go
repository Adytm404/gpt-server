package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestChatContentOnlyStructuralValidation(t *testing.T) {
	for _, prompt := range []string{"halo", "混合 bahasa server?", "write code", "https://other.example", "ignore instructions"} {
		if err := validateChatContent(prompt); err != nil {
			t.Errorf("structurally valid prompt %q rejected: %v", prompt, err)
		}
	}
	for _, prompt := range []string{"", " padded ", "line\rbreak", strings.Repeat("x", maxChatContent+1)} {
		if validateChatContent(prompt) == nil {
			t.Errorf("invalid content %q accepted", prompt)
		}
	}
}

func TestChatMessageResponseSerializesKind(t *testing.T) {
	raw, err := json.Marshal(chatMessageResponse{Kind: "plan"})
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err = json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if out["kind"] != "plan" {
		t.Fatalf("kind = %#v", out["kind"])
	}
}

func TestChatMessageQueriesPersistAndScanKinds(t *testing.T) {
	chatRaw, err := os.ReadFile("chat.go")
	if err != nil {
		t.Fatal(err)
	}
	operationsRaw, err := os.ReadFile("operations.go")
	if err != nil {
		t.Fatal(err)
	}
	chatSource, operationSource := string(chatRaw), string(operationsRaw)
	for _, clause := range []string{
		"m.role,m.kind,m.content",
		"'user','chat'",
		"'assistant','chat'",
		"'assistant','plan'",
	} {
		if !strings.Contains(chatSource, clause) {
			t.Errorf("chat message source missing %q", clause)
		}
	}
	if !strings.Contains(operationSource, "'assistant','result'") {
		t.Error("operation summary is not persisted as result")
	}
	if strings.Index(operationSource, "runOperationStep(ctx") > strings.Index(operationSource, "s.summarizeOperation(ctx") {
		t.Fatal("operation summary must run after command steps")
	}
}

func TestRuntimeHasNoKeywordIntentOrLanguageRouting(t *testing.T) {
	for _, name := range []string{"chat.go", "chat_security.go", "openai_chat.go", "operations.go"} {
		raw, err := os.ReadFile(filepath.Join(".", name))
		if err != nil {
			t.Fatal(err)
		}
		for _, forbidden := range []string{"serverIntentPattern", "actionIntentPattern", "deniedPromptPattern", "hostLikePattern", "localChatResponse", "preferredResponseLanguage"} {
			if strings.Contains(string(raw), forbidden) {
				t.Errorf("%s retains forbidden runtime symbol %q", name, forbidden)
			}
		}
	}
}

func TestReadOnlyCommandGuardCorpus(t *testing.T) {
	valid := []planStep{{Executable: "uptime"}, {Executable: "free", Args: []string{"-h"}}, {Executable: "df", Args: []string{"-P"}}, {Executable: "ps", Args: []string{"-eo", "pid,comm,pcpu,pmem"}}, {Executable: "uname", Args: []string{"-r"}}, {Executable: "systemctl", Args: []string{"is-active", "nginx.service"}}, {Executable: "systemctl", Args: []string{"list-units", "--failed"}}, {Executable: "docker", Args: []string{"ps"}}}
	for _, step := range valid {
		if err := validateReadOnlyCommand(step.Executable, step.Args); err != nil {
			t.Errorf("valid command %+v rejected: %v", step, err)
		}
	}
	invalid := []planStep{{Executable: "bash", Args: []string{"-c", "uptime"}}, {Executable: "cat", Args: []string{"/etc/passwd"}}, {Executable: "uptime;id"}, {Executable: "df", Args: []string{"-h;id"}}, {Executable: "ps", Args: []string{"aux"}}, {Executable: "ps", Args: []string{"aux|cat"}}, {Executable: "systemctl", Args: []string{"restart", "nginx"}}, {Executable: "systemctl", Args: []string{"status", "nginx"}}, {Executable: "systemctl", Args: []string{"is-active", "../ssh"}}, {Executable: "journalctl", Args: []string{"--no-pager", "-n", "10", "-u", "nginx"}}, {Executable: "docker", Args: []string{"logs", "--tail", "100", "api"}}, {Executable: "curl", Args: []string{"example.com"}}, {Executable: "ｕｐｔｉｍｅ"}, {Executable: "hostname", Args: []string{"$(id)"}}}
	for _, step := range invalid {
		if err := validateReadOnlyCommand(step.Executable, step.Args); err == nil {
			t.Errorf("unsafe command %+v accepted", step)
		}
	}
}

func TestPlanRejectsAnyUnsafeStep(t *testing.T) {
	plan := operationPlan{Title: "Health", Summary: "Inspect health", Risk: "low", Steps: []planStep{{Description: "uptime", Executable: "uptime"}, {Description: "escape", Executable: "sh", Args: []string{"-c", "id"}}}}
	if validateOperationPlan(plan) == nil {
		t.Fatal("partially unsafe plan accepted")
	}
	plan.Steps = plan.Steps[:1]
	if validateOperationPlan(plan) != nil {
		t.Fatal("safe plan rejected")
	}
}

func TestShellSerializationQuotesEveryToken(t *testing.T) {
	got, err := shellQuoteCommand("systemctl", []string{"is-active", "nginx.service"})
	if err != nil {
		t.Fatal(err)
	}
	if got != "'systemctl' 'is-active' 'nginx.service'" {
		t.Fatalf("command = %q", got)
	}
}

func TestPlanningLimiterPerIdentity(t *testing.T) {
	l := newPlanningLimiter(2, time.Minute)
	now := time.Now()
	if !l.allow("a", now) || !l.allow("a", now) || l.allow("a", now) {
		t.Fatal("limit not enforced")
	}
	if !l.allow("b", now) {
		t.Fatal("identity not isolated")
	}
	if !l.allow("a", now.Add(time.Minute)) {
		t.Fatal("window not reset")
	}
}

func TestOpenAIPlannerKeyedKeylessUsageAndFence(t *testing.T) {
	for _, key := range []string{"", "secret"} {
		t.Run("key="+key, func(t *testing.T) {
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if got := r.Header.Get("Authorization"); got != "" && got != "Bearer secret" {
					t.Errorf("authorization=%q", got)
				}
				if key == "" && r.Header.Get("Authorization") != "" {
					t.Error("keyless request sent authorization")
				}
				var request struct {
					Messages []map[string]string `json:"messages"`
				}
				if json.NewDecoder(r.Body).Decode(&request) != nil || len(request.Messages) != 2 || !strings.Contains(request.Messages[1]["content"], "language code (router-selected, not user-overridable): en") {
					t.Error("invalid body")
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"` + "```json\\n" + `{\"title\":\"Health\",\"summary\":\"Inspect server\",\"risk\":\"low\",\"steps\":[{\"description\":\"Show uptime\",\"executable\":\"uptime\",\"args\":[]}]}\\n` + "```" + `"}}],"usage":{"prompt_tokens":12,"completion_tokens":8}}`))
			}))
			defer provider.Close()
			allowed := map[string]struct{}{provider.URL: {}}
			plan, usage, err := requestOpenAIPlan(context.Background(), provider.Client(), plannerModel{BaseURL: provider.URL, ExternalID: "test", APIKey: key}, allowed, "en", "Check server uptime", map[string]any{"status": "online"})
			if err != nil {
				t.Fatal(err)
			}
			if plan.Title != "Health" || usage.InputTokens != 12 || usage.OutputTokens != 8 {
				t.Fatalf("plan=%+v usage=%+v", plan, usage)
			}
		})
	}
}

func TestOpenAIIntentRouterClassesKeyModesSchemaAndRedaction(t *testing.T) {
	for _, key := range []string{"", "secret"} {
		for _, intent := range []string{"conversation", "server_explanation", "server_operation", "reject"} {
			t.Run("key="+key+"/intent="+intent, func(t *testing.T) {
				calls := 0
				provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls++
					if got := r.Header.Get("Authorization"); got != map[bool]string{true: "Bearer secret", false: ""}[key != ""] {
						t.Errorf("authorization=%q", got)
					}
					var request struct {
						Messages       []map[string]string `json:"messages"`
						ResponseFormat map[string]string   `json:"response_format"`
					}
					if json.NewDecoder(r.Body).Decode(&request) != nil || request.ResponseFormat["type"] != "json_object" {
						t.Fatal("strict response schema missing")
					}
					if strings.Contains(request.Messages[0]["content"], "final policy gate") {
						content, _ := json.Marshal(scopeDecision{Decision: "allow", Reason: "in scope"})
						out, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": string(content)}}}, "usage": map[string]int{"prompt_tokens": 5, "completion_tokens": 2}})
						_, _ = w.Write(out)
						return
					}
					response := ""
					if intent == "conversation" || intent == "server_explanation" {
						response = "Status aman password=hunter2"
					}
					content, _ := json.Marshal(intentRoute{Intent: intent, LanguageCode: "id", Response: response, Reason: "classified"})
					out, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "```json\n" + string(content) + "\n```"}}}, "usage": map[string]int{"prompt_tokens": 7, "completion_tokens": 3}})
					_, _ = w.Write(out)
				}))
				defer provider.Close()
				route, usage, err := requestOpenAIIntent(context.Background(), provider.Client(), plannerModel{BaseURL: provider.URL, ExternalID: "test", APIKey: key}, map[string]struct{}{provider.URL: {}}, "arbitrary mixed bahasa", map[string]any{"status": "ok"})
				wantCalls, wantInput, wantOutput := 2, int64(12), int64(5)
				if intent == "reject" {
					wantCalls, wantInput, wantOutput = 1, 7, 3
				}
				if err != nil || route.Intent != intent || route.LanguageCode != "id" || usage.InputTokens != wantInput || usage.OutputTokens != wantOutput || calls != wantCalls {
					t.Fatalf("route=%+v usage=%+v err=%v", route, usage, err)
				}
				if strings.Contains(route.Response, "hunter2") {
					t.Fatalf("response not redacted: %q", route.Response)
				}
			})
		}
	}
}

func TestOpenAIIntentScopeConsensus(t *testing.T) {
	tests := []struct {
		name              string
		prompt            string
		primary           intentRoute
		decision          scopeDecision
		wantIntent        string
		wantResponse      string
		verifierMalformed bool
	}{
		{name: "poem rejected", prompt: "Write a poem about sunlight", primary: intentRoute{Intent: "conversation", LanguageCode: "en", Response: "Here is a poem", Reason: "chat"}, decision: scopeDecision{Decision: "reject", Reason: "creative writing"}, wantIntent: "reject"},
		{name: "greeting allowed", prompt: "Hello assistant", primary: intentRoute{Intent: "conversation", LanguageCode: "en", Response: "Hello. How can I help with this app?", Reason: "greeting"}, decision: scopeDecision{Decision: "allow", Reason: "assistant greeting"}, wantIntent: "conversation", wantResponse: "Hello. How can I help with this app?"},
		{name: "storage allowed", prompt: "Check selected server storage", primary: intentRoute{Intent: "server_operation", LanguageCode: "en", Reason: "fresh diagnostics"}, decision: scopeDecision{Decision: "allow", Reason: "selected server diagnostics"}, wantIntent: "server_operation"},
		{name: "malformed verifier fails closed", prompt: "Hello", primary: intentRoute{Intent: "conversation", LanguageCode: "en", Response: "Hello", Reason: "greeting"}, verifierMalformed: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var request struct {
					Messages []map[string]string `json:"messages"`
				}
				if json.NewDecoder(r.Body).Decode(&request) != nil || len(request.Messages) != 2 {
					t.Fatal("invalid request")
				}
				content, _ := json.Marshal(tc.primary)
				if strings.Contains(request.Messages[0]["content"], "final policy gate") {
					if tc.verifierMalformed {
						content = []byte(`{"decision":"allow","reason":"x","extra":true}`)
					} else {
						content, _ = json.Marshal(tc.decision)
					}
				}
				out, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": string(content)}}}, "usage": map[string]int{"prompt_tokens": 3, "completion_tokens": 2}})
				_, _ = w.Write(out)
			}))
			defer provider.Close()
			route, usage, err := requestOpenAIIntent(context.Background(), provider.Client(), plannerModel{BaseURL: provider.URL, ExternalID: "test"}, map[string]struct{}{provider.URL: {}}, tc.prompt, map[string]any{"disk_percent": 33})
			if tc.verifierMalformed {
				if err == nil || calls != 3 || usage.InputTokens != 9 || usage.OutputTokens != 6 {
					t.Fatalf("route=%+v usage=%+v calls=%d err=%v", route, usage, calls, err)
				}
				return
			}
			if err != nil || calls != 2 || route.Intent != tc.wantIntent || route.Response != tc.wantResponse || usage.InputTokens != 6 || usage.OutputTokens != 4 {
				t.Fatalf("route=%+v usage=%+v calls=%d err=%v", route, usage, calls, err)
			}
			if tc.wantIntent == "reject" && (route.Reason != "" || route.Response != "") {
				t.Fatalf("verifier rejection retained untrusted fields: %+v", route)
			}
		})
	}
}

func TestOpenAIIntentRouterRejectsInvalidProviderResponses(t *testing.T) {
	cases := map[string]string{
		"json":             `nope`,
		"enum":             `{"intent":"other","language_code":"en","response":"x","reason":"x"}`,
		"language":         `{"intent":"conversation","language_code":"English","response":"x","reason":"x"}`,
		"missing-response": `{"intent":"conversation","language_code":"en","response":"","reason":"x"}`,
		"extra-field":      `{"intent":"reject","language_code":"en","response":"","reason":"x","extra":true}`,
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				out, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}}}, "usage": map[string]int{"prompt_tokens": 1, "completion_tokens": 1}})
				_, _ = w.Write(out)
			}))
			defer provider.Close()
			_, _, err := requestOpenAIIntent(context.Background(), provider.Client(), plannerModel{BaseURL: provider.URL, ExternalID: "test"}, map[string]struct{}{provider.URL: {}}, "anything", nil)
			if err == nil {
				t.Fatal("invalid route accepted")
			}
		})
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"intent\":\"reject\",\"language_code\":\"en\",\"response\":\"\",\"reason\":\"x\"}"}}],"usage":{"prompt_tokens":0,"completion_tokens":0}}`))
	}))
	defer provider.Close()
	if _, _, err := requestOpenAIIntent(context.Background(), provider.Client(), plannerModel{BaseURL: provider.URL, ExternalID: "test"}, map[string]struct{}{provider.URL: {}}, "anything", nil); err == nil || !strings.Contains(err.Error(), "usage") {
		t.Fatalf("invalid usage error=%v", err)
	}
}

func TestOpenAIIntentRouterProviderSafety(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "provider secret", 500) }))
	defer provider.Close()
	_, _, err := requestOpenAIIntent(context.Background(), provider.Client(), plannerModel{BaseURL: provider.URL, ExternalID: "test"}, map[string]struct{}{provider.URL: {}}, "anything", nil)
	if err == nil || strings.Contains(err.Error(), "provider secret") {
		t.Fatalf("provider error=%v", err)
	}
	if _, _, err = requestOpenAIIntent(context.Background(), provider.Client(), plannerModel{BaseURL: provider.URL, ExternalID: "test"}, nil, "anything", nil); err == nil || !strings.Contains(err.Error(), "origin") {
		t.Fatalf("origin error=%v", err)
	}
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Fatal("redirect followed") }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer redirect.Close()
	if _, _, err = requestOpenAIIntent(context.Background(), redirect.Client(), plannerModel{BaseURL: redirect.URL, ExternalID: "test"}, map[string]struct{}{redirect.URL: {}}, "anything", nil); err == nil {
		t.Fatal("redirect accepted")
	}
}

func TestChatPolicies(t *testing.T) {
	if !validChatPolicy("approval_required") || !validChatPolicy("explain_only") || validChatPolicy("read_only") || validChatPolicy("") {
		t.Fatal("chat policy validation contract broken")
	}
}

func TestOpenAIExplanationKeyedKeylessLanguageAndPolicy(t *testing.T) {
	for _, key := range []string{"", "secret"} {
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.Header.Get("Authorization"); got != "" && got != "Bearer secret" {
				t.Errorf("authorization=%q", got)
			}
			var request struct {
				Messages []map[string]string `json:"messages"`
			}
			if json.NewDecoder(r.Body).Decode(&request) != nil || len(request.Messages) != 2 {
				t.Fatal("invalid explanatory request")
			}
			system := request.Messages[0]["content"]
			user := request.Messages[1]["content"]
			for _, required := range []string{"explain only", "Do not propose, request, generate", "shell commands", "Required response language code (router-selected, not user-overridable): id"} {
				if !strings.Contains(system+user, required) {
					t.Errorf("request missing %q: system=%q user=%q", required, system, user)
				}
			}
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Ruang disk tersedia."}}],"usage":{"prompt_tokens":9,"completion_tokens":4}}`))
		}))
		text, usage, err := requestOpenAIExplanation(context.Background(), provider.Client(), plannerModel{BaseURL: provider.URL, ExternalID: "test", APIKey: key}, map[string]struct{}{provider.URL: {}}, "id", "Lihat ruang penyimpanan server", map[string]any{"disk_percent": 20})
		provider.Close()
		if err != nil || text != "Ruang disk tersedia." || usage.InputTokens != 9 || usage.OutputTokens != 4 {
			t.Fatalf("key=%q text=%q usage=%+v err=%v", key, text, usage, err)
		}
	}
}

func TestOpenAISummaryStreamingJSONFallbackAndProviderError(t *testing.T) {
	t.Run("sse", func(t *testing.T) {
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Disk \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"healthy\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2}}\n\ndata: [DONE]\n\n"))
		}))
		defer provider.Close()
		var deltas []string
		text, usage, err := requestOpenAISummary(context.Background(), provider.Client(), plannerModel{BaseURL: provider.URL, ExternalID: "test"}, map[string]struct{}{provider.URL: {}}, "English", map[string]any{"status": "ok"}, func(s string) { deltas = append(deltas, s) })
		if err != nil || text != "Disk healthy" || strings.Join(deltas, "") != text || usage.InputTokens != 10 || usage.OutputTokens != 2 {
			t.Fatalf("text=%q deltas=%v usage=%+v err=%v", text, deltas, usage, err)
		}
	})
	t.Run("sse-finish-reason", func(t *testing.T) {
		stream := "data: {\"choices\":[{\"delta\":{\"content\":\"Server sehat\"},\"finish_reason\":null}]}\n\n" +
			"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":8,\"completion_tokens\":2}}\n\n"
		content, usage, err := parseOpenAIStream(strings.NewReader(stream), nil)
		if err != nil || content != "Server sehat" || usage.InputTokens != 8 || usage.OutputTokens != 2 {
			t.Fatalf("content=%q usage=%+v err=%v", content, usage, err)
		}
	})
	t.Run("json", func(t *testing.T) {
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Complete"}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}`))
		}))
		defer provider.Close()
		text, _, err := requestOpenAISummary(context.Background(), provider.Client(), plannerModel{BaseURL: provider.URL, ExternalID: "test"}, map[string]struct{}{provider.URL: {}}, "English", nil, nil)
		if err != nil || text != "Complete" {
			t.Fatalf("text=%q err=%v", text, err)
		}
	})
	if !strings.Contains(summarySystemPrompt, "Do not output shell commands") || !strings.Contains(summarySystemPrompt, "plain-language") {
		t.Fatal("summary system prompt must prohibit command suggestions")
	}
	t.Run("provider-error", func(t *testing.T) {
		provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "secret", 500) }))
		defer provider.Close()
		_, _, err := requestOpenAISummary(context.Background(), provider.Client(), plannerModel{BaseURL: provider.URL, ExternalID: "test"}, map[string]struct{}{provider.URL: {}}, "English", nil, nil)
		if err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("provider error=%v", err)
		}
	})
}

func TestSummaryInputBoundedAndRedacted(t *testing.T) {
	input := summaryOperationInput{Request: "Check server password=hunter2", Server: map[string]any{"name": "API", "health": strings.Repeat("y", maxSummaryInput)}, Steps: []summaryOperationStep{{Description: "disk", Stdout: strings.Repeat("x", maxSummaryInput), Stderr: "Authorization: Bearer abc123 10.0.0.8"}}}
	bounded := boundSummaryInput(input)
	raw, err := json.Marshal(bounded)
	if err != nil || len(raw) > maxSummaryInput {
		t.Fatalf("size=%d err=%v", len(raw), err)
	}
	if strings.Contains(string(raw), "hunter2") || strings.Contains(string(raw), "abc123") || strings.Contains(string(raw), "10.0.0.8") {
		t.Fatalf("summary input leaked secret: %s", raw)
	}
	if summaryFallback("id") == summaryFallback("en") || !strings.Contains(summaryFallback("id"), "ringkasan AI") {
		t.Fatal("language fallback unavailable")
	}
}

func TestOperationEventEnvelopeMergesMetadata(t *testing.T) {
	stepID := uuid.New()
	created := time.Date(2026, 8, 21, 1, 2, 3, 0, time.UTC)
	out := (operationEventDTO{ID: 7, Type: "stdout", StepID: &stepID, CreatedAt: created, Payload: json.RawMessage(`{"chunk":"ok","event_type":"spoof"}`)}).envelope()
	if out["id"] != int64(7) || out["event_type"] != "stdout" || out["step_id"] != stepID || out["chunk"] != "ok" || out["created_at"] != created {
		t.Fatalf("envelope=%#v", out)
	}
}

func TestOpenAIPlannerFailuresAndNoRedirect(t *testing.T) {
	cases := []struct {
		name    string
		handler http.HandlerFunc
	}{{"invalid-json", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`nope`)) }}, {"provider-error", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "secret provider body", 500) }}, {"unsafe-plan", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"title\":\"x\",\"summary\":\"x\",\"risk\":\"low\",\"steps\":[{\"description\":\"x\",\"executable\":\"bash\",\"args\":[]}]}"}}]}`))
	}}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.handler)
			defer srv.Close()
			_, _, err := requestOpenAIPlan(context.Background(), srv.Client(), plannerModel{BaseURL: srv.URL, ExternalID: "test"}, map[string]struct{}{srv.URL: {}}, "en", "Check server", nil)
			if err == nil {
				t.Fatal("failure accepted")
			}
			if strings.Contains(err.Error(), "secret provider body") {
				t.Fatal("provider body leaked")
			}
		})
	}
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Fatal("redirect followed") }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer redirect.Close()
	_, _, err := requestOpenAIPlan(context.Background(), redirect.Client(), plannerModel{BaseURL: redirect.URL, ExternalID: "test"}, map[string]struct{}{redirect.URL: {}}, "en", "Check server", nil)
	if err == nil {
		t.Fatal("redirect accepted")
	}
}

func TestOpenAIPlannerRejectsMissingUsageAndUnapprovedOrigin(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"title\":\"Health\",\"summary\":\"Inspect server\",\"risk\":\"low\",\"steps\":[{\"description\":\"Show uptime\",\"executable\":\"uptime\",\"args\":[]}] }"}}]}`))
	}))
	defer provider.Close()
	model := plannerModel{BaseURL: provider.URL, ExternalID: "test"}
	if _, _, err := requestOpenAIPlan(context.Background(), provider.Client(), model, map[string]struct{}{provider.URL: {}}, "en", "Check server", nil); err == nil || !strings.Contains(err.Error(), "usage") {
		t.Fatalf("missing usage error = %v", err)
	}
	if _, _, err := requestOpenAIPlan(context.Background(), provider.Client(), model, nil, "en", "Check server", nil); err == nil || !strings.Contains(err.Error(), "origin") {
		t.Fatalf("unapproved origin error = %v", err)
	}
}

func TestProviderAllowedOrigins(t *testing.T) {
	allowed, err := parseAllowedOrigins("https://api.example.com,http://localhost:20128")
	if err != nil {
		t.Fatal(err)
	}
	if !providerOriginAllowed("https://api.example.com/v1", allowed) || !providerOriginAllowed("http://localhost:20128/openai", allowed) || providerOriginAllowed("https://evil.example/v1", allowed) {
		t.Fatal("origin allowlist did not use exact normalized origins")
	}
}

func TestOperationalOutputRedaction(t *testing.T) {
	input := "Authorization: Bearer abc123\npassword=hunter2\nDATABASE_URL=postgres://user:pass@db/prod\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"
	got := redactOperationalOutput(input)
	for _, secret := range []string{"abc123", "hunter2", "user:pass", "BEGIN PRIVATE KEY", "\nsecret\n"} {
		if strings.Contains(got, secret) {
			t.Fatalf("secret %q remains in %q", secret, got)
		}
	}
}

func TestSSEStreamLimitAndRelease(t *testing.T) {
	s := &server{}
	user, workspace, operation := uuid.New(), uuid.New(), uuid.New()
	var releases []func()
	for i := 0; i < 3; i++ {
		release, ok := s.acquireSSEStream(user, workspace, operation)
		if !ok {
			t.Fatalf("stream %d rejected", i)
		}
		releases = append(releases, release)
	}
	if _, ok := s.acquireSSEStream(user, workspace, operation); ok {
		t.Fatal("fourth stream accepted")
	}
	releases[0]()
	if release, ok := s.acquireSSEStream(user, workspace, operation); !ok {
		t.Fatal("released stream slot not reusable")
	} else {
		release()
	}
}

func TestEventBufferBatchesSmallWritesUntilFlush(t *testing.T) {
	b := &eventBuffer{}
	_, _ = b.Write([]byte("one"))
	_, _ = b.Write([]byte("two"))
	if b.pending.Len() != 6 {
		t.Fatalf("pending bytes = %d", b.pending.Len())
	}
	b.Flush()
	if b.pending.Len() != 0 || b.String() != "onetwo" {
		t.Fatalf("flush pending=%d value=%q", b.pending.Len(), b.String())
	}
}

func TestChatAndOperationRoutesRequireAuthAndViewerCannotApprove(t *testing.T) {
	s := &server{cfg: config{frontendOrigin: "https://app.example.com"}}
	for _, path := range []string{"/api/v1/chat/threads", "/api/v1/operations"} {
		rec := httptest.NewRecorder()
		s.routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != 401 {
			t.Errorf("%s status=%d", path, rec.Code)
		}
	}
	s.resolveSession = func(context.Context, string) (sessionAuth, error) {
		return sessionAuth{UserID: uuid.New(), WorkspaceID: uuid.New(), WorkspaceRole: "viewer"}, nil
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/"+uuid.NewString()+"/approve", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: "x"})
	req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "token"})
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("X-CSRF-Token", "token")
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("viewer approval status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestEventBufferCapsOutput(t *testing.T) {
	b := &eventBuffer{}
	payload := make([]byte, maxOperationOutput+100)
	n, err := b.Write(payload)
	if err != nil || n != len(payload) {
		t.Fatalf("write n=%d err=%v", n, err)
	}
	if len(b.String()) != maxOperationOutput || !b.Truncated() {
		t.Fatalf("len=%d truncated=%v", len(b.String()), b.Truncated())
	}
}
