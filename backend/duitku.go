package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type platformDuitkuSettings struct {
	MerchantCode        string `json:"merchant_code"`
	Environment         string `json:"environment"`
	Enabled             bool   `json:"enabled"`
	CallbackURL         string `json:"callback_url"`
	ReturnURL           string `json:"return_url"`
	ExpiryPeriodMinutes int    `json:"expiry_period_minutes"`
	HasAPIKey           bool   `json:"has_api_key"`
	UpdatedAt           string `json:"updated_at,omitempty"`
}

type updateDuitkuInput struct {
	MerchantCode        string `json:"merchant_code"`
	APIKey              string `json:"api_key,omitempty"`
	Environment         string `json:"environment"`
	Enabled             bool   `json:"enabled"`
	CallbackURL         string `json:"callback_url"`
	ReturnURL           string `json:"return_url"`
	ExpiryPeriodMinutes int    `json:"expiry_period_minutes"`
}

type duitkuItemDetail struct {
	Name     string `json:"name"`
	Price    int64  `json:"price"`
	Quantity int    `json:"quantity"`
}

type duitkuCustomerDetail struct {
	FirstName   string `json:"firstName"`
	LastName    string `json:"lastName"`
	Email       string `json:"email"`
	PhoneNumber string `json:"phoneNumber,omitempty"`
}

type createDuitkuInvoicePayload struct {
	PaymentAmount   int64                `json:"paymentAmount"`
	MerchantOrderID string               `json:"merchantOrderId"`
	ProductDetails  string               `json:"productDetails"`
	Email           string               `json:"email"`
	CustomerVaName  string               `json:"customerVaName"`
	ItemDetails     []duitkuItemDetail   `json:"itemDetails"`
	CustomerDetail  duitkuCustomerDetail `json:"customerDetail"`
	CallbackURL     string               `json:"callbackUrl"`
	ReturnURL       string               `json:"returnUrl"`
	ExpiryPeriod    int                  `json:"expiryPeriod"`
}

type createDuitkuInvoiceResponse struct {
	MerchantCode  string `json:"merchantCode"`
	Reference     string `json:"reference"`
	PaymentURL    string `json:"paymentUrl"`
	StatusCode    string `json:"statusCode"`
	StatusMessage string `json:"statusMessage"`
}

func (s *server) loadDuitkuSettings(ctx context.Context) (platformDuitkuSettings, string, error) {
	if s == nil || s.db == nil {
		return platformDuitkuSettings{
			Environment:         "sandbox",
			ExpiryPeriodMinutes: 60,
			CallbackURL:         "/api/v1/billing/duitku/callback",
			ReturnURL:           "/checkout/result",
		}, "", errors.New("database unavailable")
	}
	var out platformDuitkuSettings
	var ciphertext []byte
	var updated time.Time
	err := s.db.QueryRow(ctx, `
SELECT merchant_code, merchant_key_ciphertext, environment, enabled, callback_url, return_url, expiry_period_minutes, updated_at
FROM platform_duitku_settings
WHERE id = 'default'`).Scan(&out.MerchantCode, &ciphertext, &out.Environment, &out.Enabled, &out.CallbackURL, &out.ReturnURL, &out.ExpiryPeriodMinutes, &updated)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return platformDuitkuSettings{
				Environment:         "sandbox",
				ExpiryPeriodMinutes: 60,
				CallbackURL:         s.cfg.frontendOrigin + "/api/v1/billing/duitku/callback",
				ReturnURL:           s.cfg.frontendOrigin + "/checkout/result",
			}, "", nil
		}
		return out, "", err
	}

	out.HasAPIKey = len(ciphertext) > 0
	if !updated.IsZero() {
		out.UpdatedAt = updated.Format(time.RFC3339)
	}
	if out.CallbackURL == "" {
		out.CallbackURL = s.cfg.frontendOrigin + "/api/v1/billing/duitku/callback"
	}
	if out.ReturnURL == "" {
		out.ReturnURL = s.cfg.frontendOrigin + "/checkout/result"
	}

	var apiKey string
	if len(ciphertext) > 0 {
		apiKey, _ = decryptServerCredential(s.cfg.serverKeyEncryptionKey, ciphertext)
	}

	return out, apiKey, nil
}

func (s *server) getAdminDuitku(w http.ResponseWriter, r *http.Request) {
	settings, _, err := s.loadDuitkuSettings(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, settings)
}

func (s *server) setAdminDuitku(w http.ResponseWriter, r *http.Request) {
	var in updateDuitkuInput
	if err := decodeJSON(r, &in); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid request payload")
		return
	}

	in.MerchantCode = strings.TrimSpace(in.MerchantCode)
	in.APIKey = strings.TrimSpace(in.APIKey)
	in.Environment = strings.ToLower(strings.TrimSpace(in.Environment))
	if in.Environment != "production" {
		in.Environment = "sandbox"
	}
	in.CallbackURL = strings.TrimSpace(in.CallbackURL)
	in.ReturnURL = strings.TrimSpace(in.ReturnURL)
	if in.ExpiryPeriodMinutes <= 0 {
		in.ExpiryPeriodMinutes = 60
	}

	var ciphertext []byte
	if in.APIKey != "" {
		var err error
		ciphertext, err = encryptServerCredential(s.cfg.serverKeyEncryptionKey, in.APIKey)
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
INSERT INTO platform_duitku_settings (id, merchant_code, merchant_key_ciphertext, environment, enabled, callback_url, return_url, expiry_period_minutes, updated_at)
VALUES ('default', $1, $2, $3, $4, $5, $6, $7, now())
ON CONFLICT (id) DO UPDATE SET
  merchant_code = EXCLUDED.merchant_code,
  merchant_key_ciphertext = EXCLUDED.merchant_key_ciphertext,
  environment = EXCLUDED.environment,
  enabled = EXCLUDED.enabled,
  callback_url = EXCLUDED.callback_url,
  return_url = EXCLUDED.return_url,
  expiry_period_minutes = EXCLUDED.expiry_period_minutes,
  updated_at = now()`, in.MerchantCode, ciphertext, in.Environment, in.Enabled, in.CallbackURL, in.ReturnURL, in.ExpiryPeriodMinutes)
	} else {
		_, err = tx.Exec(r.Context(), `
INSERT INTO platform_duitku_settings (id, merchant_code, environment, enabled, callback_url, return_url, expiry_period_minutes, updated_at)
VALUES ('default', $1, $2, $3, $4, $5, $6, now())
ON CONFLICT (id) DO UPDATE SET
  merchant_code = EXCLUDED.merchant_code,
  environment = EXCLUDED.environment,
  enabled = EXCLUDED.enabled,
  callback_url = EXCLUDED.callback_url,
  return_url = EXCLUDED.return_url,
  expiry_period_minutes = EXCLUDED.expiry_period_minutes,
  updated_at = now()`, in.MerchantCode, in.Environment, in.Enabled, in.CallbackURL, in.ReturnURL, in.ExpiryPeriodMinutes)
	}

	if err != nil {
		s.dbError(w, r, err)
		return
	}

	_ = insertAudit(r.Context(), tx, authFrom(r.Context()).UserID, "billing", "Updated Duitku platform settings", uuid.Nil, in.MerchantCode, nil)

	if err = tx.Commit(r.Context()); err != nil {
		s.dbError(w, r, err)
		return
	}

	s.getAdminDuitku(w, r)
}

func (s *server) getPublicBillingConfig(w http.ResponseWriter, r *http.Request) {
	settings, _, err := s.loadDuitkuSettings(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{
		"duitku_enabled":     settings.Enabled,
		"duitku_environment": settings.Environment,
		"merchant_code":      settings.MerchantCode,
	})
}

type checkoutInput struct {
	PlanID        string `json:"plan_id"`
	BillingPeriod string `json:"billing_period"`
}

func (s *server) createCheckoutOrder(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r.Context())
	if a.WorkspaceRole != "owner" {
		s.writeError(w, r, http.StatusForbidden, "only workspace owners can initiate checkout")
		return
	}

	var in checkoutInput
	if err := decodeJSON(r, &in); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid checkout request")
		return
	}

	planUUID, err := uuid.Parse(strings.TrimSpace(in.PlanID))
	if err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid plan id")
		return
	}

	period := strings.ToLower(strings.TrimSpace(in.BillingPeriod))
	if period != "annual" {
		period = "monthly"
	}

	settings, apiKey, err := s.loadDuitkuSettings(r.Context())
	if err != nil || !settings.Enabled || settings.MerchantCode == "" || apiKey == "" {
		s.writeError(w, r, http.StatusBadRequest, "Duitku payment gateway is not enabled or configured")
		return
	}

	var plan planResponse
	var planFeatures []byte
	err = s.db.QueryRow(r.Context(), planSelect+` WHERE p.plan_id=$1 AND p.status='published' ORDER BY p.revision DESC LIMIT 1`, planUUID).
		Scan(&plan.ID, &plan.RevisionID, &plan.Revision, &plan.Name, &plan.Slug, &plan.Description, &plan.PriceCents, &plan.AnnualPriceCents, &plan.Status, &plan.MaxWorkspaces, &plan.MaxServers, &plan.MonthlyTokens, &plan.InputTokens, &plan.OutputTokens, &plan.OverLimit, &plan.DefaultModelID, &plan.FallbackModelID, &plan.AllowedModelIDs, &planFeatures, &plan.Visibility)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.writeError(w, r, http.StatusNotFound, "selected subscription plan is not published or found")
			return
		}
		s.dbError(w, r, err)
		return
	}

	var amountIDR int64
	if period == "annual" {
		amountIDR = int64(plan.AnnualPriceCents) * 12
	} else {
		amountIDR = int64(plan.PriceCents)
	}
	if amountIDR <= 0 {
		amountIDR = 10000 // Minimum default if 0
	}

	var userFullName, userEmail string
	_ = s.db.QueryRow(r.Context(), `SELECT full_name, email FROM users WHERE id=$1`, a.UserID).Scan(&userFullName, &userEmail)
	if userEmail == "" {
		userEmail = "user@opsai.local"
	}
	if userFullName == "" {
		userFullName = "Workspace Owner"
	}

	orderID := uuid.New()
	merchantOrderID := fmt.Sprintf("OPS-%d-%s", time.Now().Unix(), orderID.String()[:8])

	productDetails := fmt.Sprintf("OpsAI %s Plan (%s)", plan.Name, strings.Title(period))
	callbackURL := settings.CallbackURL
	if callbackURL == "" {
		callbackURL = s.cfg.frontendOrigin + "/api/v1/billing/duitku/callback"
	}
	returnURL := settings.ReturnURL
	if returnURL == "" {
		returnURL = fmt.Sprintf("%s/checkout/result?merchantOrderId=%s", s.cfg.frontendOrigin, merchantOrderID)
	} else if !strings.Contains(returnURL, "merchantOrderId") {
		if strings.Contains(returnURL, "?") {
			returnURL = fmt.Sprintf("%s&merchantOrderId=%s", returnURL, merchantOrderID)
		} else {
			returnURL = fmt.Sprintf("%s?merchantOrderId=%s", returnURL, merchantOrderID)
		}
	}

	// Prepare Duitku Request
	timestamp := fmt.Sprintf("%d", time.Now().UnixMilli())
	stringToSign := settings.MerchantCode + timestamp
	mac := hmac.New(sha256.New, []byte(apiKey))
	mac.Write([]byte(stringToSign))
	signature := hex.EncodeToString(mac.Sum(nil))

	duitkuReq := createDuitkuInvoicePayload{
		PaymentAmount:   amountIDR,
		MerchantOrderID: merchantOrderID,
		ProductDetails:  productDetails,
		Email:           userEmail,
		CustomerVaName:  userFullName,
		ItemDetails: []duitkuItemDetail{
			{Name: productDetails, Price: amountIDR, Quantity: 1},
		},
		CustomerDetail: duitkuCustomerDetail{
			FirstName: userFullName,
			LastName:  "OpsAI",
			Email:     userEmail,
		},
		CallbackURL:  callbackURL,
		ReturnURL:    returnURL,
		ExpiryPeriod: settings.ExpiryPeriodMinutes,
	}

	jsonBytes, _ := json.Marshal(duitkuReq)
	endpoint := "https://api-sandbox.duitku.com/api/merchant/createInvoice"
	if settings.Environment == "production" {
		endpoint = "https://api-prod.duitku.com/api/merchant/createInvoice"
	}

	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader(jsonBytes))
	if err != nil {
		s.writeError(w, r, http.StatusInternalServerError, "failed to create payment request")
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-duitku-signature", signature)
	httpReq.Header.Set("x-duitku-timestamp", timestamp)
	httpReq.Header.Set("x-duitku-merchantcode", settings.MerchantCode)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		s.writeError(w, r, http.StatusBadGateway, fmt.Sprintf("failed to reach Duitku: %v", err))
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var duitkuResp createDuitkuInvoiceResponse
	if err := json.Unmarshal(respBody, &duitkuResp); err != nil || duitkuResp.StatusCode != "00" {
		log.Printf("duitku createInvoice error: code=%s msg=%s body=%s", duitkuResp.StatusCode, duitkuResp.StatusMessage, string(respBody))
		s.writeError(w, r, http.StatusBadRequest, fmt.Sprintf("Duitku error: %s (%s)", duitkuResp.StatusMessage, duitkuResp.StatusCode))
		return
	}

	_, err = s.db.Exec(r.Context(), `
INSERT INTO workspace_orders (id, workspace_id, user_id, plan_revision_id, merchant_order_id, duitku_reference, billing_period, amount_idr, status, payment_url, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, now(), now())`, orderID, a.WorkspaceID, a.UserID, plan.RevisionID, merchantOrderID, duitkuResp.Reference, period, amountIDR, duitkuResp.PaymentURL)
	if err != nil {
		s.dbError(w, r, err)
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]any{
		"order_id":          orderID,
		"merchant_order_id": merchantOrderID,
		"reference":         duitkuResp.Reference,
		"payment_url":       duitkuResp.PaymentURL,
		"amount_idr":        amountIDR,
		"environment":       settings.Environment,
		"plan_name":         plan.Name,
		"billing_period":    period,
	})
}

func (s *server) handleDuitkuCallback(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		s.writeError(w, r, http.StatusBadRequest, "invalid form data")
		return
	}

	merchantCode := r.FormValue("merchantCode")
	amount := r.FormValue("amount")
	merchantOrderID := r.FormValue("merchantOrderId")
	signature := r.FormValue("signature")
	resultCode := r.FormValue("resultCode") // "00" = Success, "01" = Failed
	reference := r.FormValue("reference")
	paymentCode := r.FormValue("paymentCode")

	settings, apiKey, err := s.loadDuitkuSettings(r.Context())
	if err != nil || apiKey == "" {
		s.writeError(w, r, http.StatusInternalServerError, "merchant settings unavailable")
		return
	}

	if merchantCode != settings.MerchantCode {
		s.writeError(w, r, http.StatusForbidden, "merchant code mismatch")
		return
	}

	// Validate HMAC-SHA256 signature: HMAC_SHA256(merchantCode + amount + merchantOrderId, apiKey)
	stringToSign := merchantCode + amount + merchantOrderID
	mac := hmac.New(sha256.New, []byte(apiKey))
	mac.Write([]byte(stringToSign))
	calculatedSignature := hex.EncodeToString(mac.Sum(nil))

	if !strings.EqualFold(signature, calculatedSignature) {
		log.Printf("Duitku callback bad signature for %s: got=%s want=%s", merchantOrderID, signature, calculatedSignature)
		s.writeError(w, r, http.StatusBadRequest, "bad signature")
		return
	}

	rawPayload, _ := json.Marshal(r.Form)

	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.dbError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())

	var orderID, workspaceID, planRevisionID uuid.UUID
	var currentStatus string
	err = tx.QueryRow(r.Context(), `
SELECT id, workspace_id, plan_revision_id, status
FROM workspace_orders
WHERE merchant_order_id = $1`, merchantOrderID).Scan(&orderID, &workspaceID, &planRevisionID, &currentStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.writeError(w, r, http.StatusNotFound, "order not found")
			return
		}
		s.dbError(w, r, err)
		return
	}

	if resultCode == "00" {
		// Payment Success
		_, err = tx.Exec(r.Context(), `
UPDATE workspace_orders
SET status = 'paid', payment_method = $2, duitku_reference = COALESCE(NULLIF($3,''), duitku_reference),
    paid_at = now(), raw_callback_payload = $4, updated_at = now()
WHERE id = $1`, orderID, paymentCode, reference, rawPayload)
		if err != nil {
			s.dbError(w, r, err)
			return
		}

		// Activate Plan for Workspace
		var monthlyTokens int64
		var defaultModelID uuid.UUID
		err = tx.QueryRow(r.Context(), `
SELECT monthly_tokens, default_model_id
FROM subscription_plan_revisions
WHERE id = $1`, planRevisionID).Scan(&monthlyTokens, &defaultModelID)
		if err == nil {
			_, err = tx.Exec(r.Context(), `
INSERT INTO workspace_subscriptions (workspace_id, plan_revision_id, default_model_id, monthly_token_limit, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (workspace_id) DO UPDATE SET
  plan_revision_id = EXCLUDED.plan_revision_id,
  default_model_id = EXCLUDED.default_model_id,
  monthly_token_limit = EXCLUDED.monthly_token_limit,
  updated_at = now()`, workspaceID, planRevisionID, defaultModelID, monthlyTokens)
		}

		_ = insertAudit(r.Context(), tx, uuid.Nil, "billing", fmt.Sprintf("Payment verified and plan activated for order %s", merchantOrderID), workspaceID, merchantOrderID, map[string]any{"amount": amount, "method": paymentCode})
	} else {
		// Payment Failed or Expired
		_, _ = tx.Exec(r.Context(), `
UPDATE workspace_orders
SET status = 'failed', payment_method = $2, raw_callback_payload = $3, updated_at = now()
WHERE id = $1`, orderID, paymentCode, rawPayload)
	}

	if err = tx.Commit(r.Context()); err != nil {
		s.dbError(w, r, err)
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]string{"status": "OK"})
}

func (s *server) getOrderStatus(w http.ResponseWriter, r *http.Request) {
	merchantOrderID := strings.TrimSpace(r.URL.Query().Get("merchant_order_id"))
	if merchantOrderID == "" {
		s.writeError(w, r, http.StatusBadRequest, "merchant_order_id is required")
		return
	}

	var orderID, workspaceID, planRevisionID uuid.UUID
	var reference, billingPeriod, status, paymentMethod, paymentURL string
	var amountIDR int64
	var planName string
	var createdAt time.Time
	var paidAt *time.Time

	err := s.db.QueryRow(r.Context(), `
SELECT o.id, o.workspace_id, o.plan_revision_id, o.duitku_reference, o.billing_period, o.amount_idr, o.status, o.payment_method, o.payment_url, p.name, o.created_at, o.paid_at
FROM workspace_orders o
JOIN subscription_plan_revisions p ON p.id = o.plan_revision_id
WHERE o.merchant_order_id = $1`, merchantOrderID).
		Scan(&orderID, &workspaceID, &planRevisionID, &reference, &billingPeriod, &amountIDR, &status, &paymentMethod, &paymentURL, &planName, &createdAt, &paidAt)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.writeError(w, r, http.StatusNotFound, "order not found")
			return
		}
		s.dbError(w, r, err)
		return
	}

	res := map[string]any{
		"order_id":          orderID,
		"merchant_order_id": merchantOrderID,
		"reference":         reference,
		"plan_name":         planName,
		"billing_period":    billingPeriod,
		"amount_idr":        amountIDR,
		"status":            status,
		"payment_method":    paymentMethod,
		"payment_url":       paymentURL,
		"created_at":        createdAt.Format(time.RFC3339),
	}
	if paidAt != nil {
		res["paid_at"] = paidAt.Format(time.RFC3339)
	}

	s.writeJSON(w, http.StatusOK, res)
}
