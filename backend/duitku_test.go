package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestDuitkuCallbackSignatureVerification(t *testing.T) {
	merchantCode := "D1234"
	amount := "50000"
	merchantOrderID := "OPS-12345678"
	apiKey := "test_duitku_api_key_secret_123"

	// Formula: HMAC_SHA256(merchantCode + amount + merchantOrderId, apiKey)
	stringToSign := merchantCode + amount + merchantOrderID
	mac := hmac.New(sha256.New, []byte(apiKey))
	mac.Write([]byte(stringToSign))
	validSignature := hex.EncodeToString(mac.Sum(nil))

	if len(validSignature) != 64 {
		t.Fatalf("expected 64 character hex signature, got %s", validSignature)
	}

	// Test invalid signature calculation
	macBad := hmac.New(sha256.New, []byte("wrong_key"))
	macBad.Write([]byte(stringToSign))
	badSignature := hex.EncodeToString(macBad.Sum(nil))

	if validSignature == badSignature {
		t.Fatal("signatures should not match with different keys")
	}
}

func TestDuitkuInvoiceHeaderSignature(t *testing.T) {
	merchantCode := "D1234"
	timestamp := "1773728479616"
	apiKey := "secret_key"

	// Formula: HMAC_SHA256(merchantCode + timestamp, apiKey)
	stringToSign := merchantCode + timestamp
	mac := hmac.New(sha256.New, []byte(apiKey))
	mac.Write([]byte(stringToSign))
	signature := hex.EncodeToString(mac.Sum(nil))

	if len(signature) != 64 {
		t.Fatalf("expected 64 chars signature, got %d", len(signature))
	}
}

func TestDuitkuCallbackRejectsBadMerchant(t *testing.T) {
	s := &server{}
	form := url.Values{}
	form.Set("merchantCode", "WRONG")
	form.Set("amount", "50000")
	form.Set("merchantOrderId", "OPS-1")
	form.Set("signature", "invalid")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/duitku/callback", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()

	// Will fail because DB settings won't match or DB isn't mock-configured
	s.handleDuitkuCallback(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatalf("expected error status for unconfigured callback, got 200")
	}
}

func TestExpireOldPendingOrdersNilSafe(t *testing.T) {
	s := &server{}
	// Should execute gracefully without panic
	s.expireOldPendingOrders(context.Background())
}
