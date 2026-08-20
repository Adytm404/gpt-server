package main

import (
	"errors"
	"net"
	"net/url"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

var safeToken = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._@/+:-]*$`)
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type serverInput struct {
	Name            string `json:"name"`
	Host            string `json:"host"`
	Port            int    `json:"port"`
	SSHUser         string `json:"ssh_user"`
	Environment     string `json:"environment"`
	Region          string `json:"region"`
	HostFingerprint string `json:"host_fingerprint"`
	PrivateKey      string `json:"private_key,omitempty"`
}
type modelInput struct {
	Name          string `json:"name"`
	Provider      string `json:"provider"`
	ModelID       string `json:"model_id"`
	BaseURL       string `json:"base_url"`
	ContextWindow int    `json:"context_window"`
	APIKey        string `json:"api_key,omitempty"`
	CredentialRef string `json:"credential_ref,omitempty"`
}
type planRevisionInput struct {
	Name             string      `json:"name"`
	Slug             string      `json:"slug"`
	Description      string      `json:"description"`
	PriceCents       int         `json:"price_cents"`
	AnnualPriceCents int         `json:"annual_price_cents"`
	MaxWorkspaces    int         `json:"max_workspaces"`
	MaxServers       int         `json:"max_servers"`
	MonthlyTokens    int64       `json:"monthly_tokens"`
	InputTokens      int         `json:"input_tokens"`
	OutputTokens     int         `json:"output_tokens"`
	OverLimit        string      `json:"over_limit"`
	DefaultModelID   uuid.UUID   `json:"default_model_id"`
	FallbackModelID  uuid.UUID   `json:"fallback_model_id"`
	AllowedModelIDs  []uuid.UUID `json:"allowed_model_ids"`
	Features         []string    `json:"features"`
	Visibility       string      `json:"visibility"`
}

func validateServerInput(in serverInput) error {
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 200 || strings.TrimSpace(in.Host) == "" || len(in.Host) > 253 || in.Port < 1 || in.Port > 65535 || !safeToken.MatchString(in.SSHUser) || len(in.SSHUser) > 64 {
		return errors.New("invalid server fields")
	}
	if net.ParseIP(in.Host) == nil && !validHostname(in.Host) {
		return errors.New("invalid host")
	}
	if in.Environment != "production" && in.Environment != "staging" && in.Environment != "development" {
		return errors.New("invalid environment")
	}
	if len(in.Region) > 100 {
		return errors.New("invalid region")
	}
	if in.HostFingerprint != "" && (!strings.HasPrefix(in.HostFingerprint, "SHA256:") || len(in.HostFingerprint) < 16 || len(in.HostFingerprint) > 128 || !safeToken.MatchString(in.HostFingerprint)) {
		return errors.New("invalid host fingerprint")
	}
	return nil
}

func validHostname(host string) bool {
	if strings.HasSuffix(host, ".") {
		host = strings.TrimSuffix(host, ".")
	}
	if len(host) == 0 {
		return false
	}
	for _, part := range strings.Split(host, ".") {
		if len(part) == 0 || len(part) > 63 || strings.HasPrefix(part, "-") || strings.HasSuffix(part, "-") {
			return false
		}
		for _, c := range part {
			if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '-' {
				return false
			}
		}
	}
	return true
}

func validateModelInput(in modelInput) error {
	if in.APIKey != "" || strings.TrimSpace(in.Name) == "" || len(in.Name) > 200 || strings.TrimSpace(in.Provider) == "" || len(in.Provider) > 100 || !safeToken.MatchString(in.ModelID) || len(in.ModelID) > 200 || in.ContextWindow < 1 || in.ContextWindow > 100000000 || len(in.CredentialRef) > 500 {
		return errors.New("invalid model fields")
	}
	baseURL := strings.TrimSpace(in.BaseURL)
	parsed, err := url.Parse(baseURL)
	if err != nil || baseURL == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || !parsed.IsAbs() || parsed.Host == "" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || strings.Contains(baseURL, "#") {
		return errors.New("invalid model base URL")
	}
	return nil
}

func validatePlanInput(in planRevisionInput) error {
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 200 || !slugPattern.MatchString(in.Slug) || len(in.Slug) > 100 || len(in.Description) > 5000 || in.PriceCents < 0 || in.AnnualPriceCents < 0 || in.MaxWorkspaces < 0 || in.MaxServers < 0 || in.MonthlyTokens < 0 || in.InputTokens < 0 || in.OutputTokens < 0 {
		return errors.New("invalid plan fields")
	}
	if in.OverLimit != "block_requests" && in.OverLimit != "allow_with_warning" {
		return errors.New("invalid over_limit")
	}
	if in.Visibility != "public" && in.Visibility != "private" {
		return errors.New("invalid visibility")
	}
	allowed := make(map[uuid.UUID]bool, len(in.AllowedModelIDs))
	for _, id := range in.AllowedModelIDs {
		if id == uuid.Nil {
			return errors.New("invalid model ID")
		}
		allowed[id] = true
	}
	if len(allowed) == 0 || !allowed[in.DefaultModelID] || !allowed[in.FallbackModelID] {
		return errors.New("default and fallback models must be allowed")
	}
	if len(in.Features) > 100 {
		return errors.New("too many features")
	}
	for _, feature := range in.Features {
		if strings.TrimSpace(feature) == "" || len(feature) > 500 {
			return errors.New("invalid feature")
		}
	}
	return nil
}
