import { useEffect, useState } from "react";
import { useSearchParams, NavLink, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { adminApi } from "../api/admin";
import "../styles/marketing.css";

function BrandMark() {
  return (
    <div className="brand-mark" style={{ width: 28, height: 28, borderRadius: 8, background: "#17171b", display: "grid", placeItems: "center" }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    </div>
  );
}

function formatIDR(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function PaymentResultPage() {
  const [searchParams] = useSearchParams();
  const merchantOrderId = searchParams.get("merchantOrderId") || "";
  const navigate = useNavigate();

  const [order, setOrder] = useState<{
    order_id: string;
    merchant_order_id: string;
    reference: string;
    plan_name: string;
    billing_period: string;
    amount_idr: number;
    status: "pending" | "paid" | "expired" | "failed";
    payment_method?: string;
    payment_url: string;
    created_at: string;
    paid_at?: string;
  } | null>(null);

  const [loading, setLoading] = useState(Boolean(merchantOrderId));
  const [error, setError] = useState(merchantOrderId ? "" : "No order ID specified.");
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = async () => {
    if (!merchantOrderId) return;
    setError("");
    try {
      const res = await adminApi.getOrderStatus(merchantOrderId);
      setOrder(res);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load order status");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => {
      if (order?.status === "pending") {
        void fetchStatus();
      }
    }, 3500);
    return () => clearInterval(interval);
  }, [merchantOrderId, order?.status]);

  const isPaid = order?.status === "paid";
  const isPending = order?.status === "pending";

  return (
    <div className="auth-page">
      <NavLink to="/" className="auth-brand">
        <BrandMark />
        <span>OpsAI</span>
      </NavLink>

      <main className="auth-form-panel">
        <div className="auth-form-wrap">
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 48,
              height: 48,
              borderRadius: 12,
              background: isPaid ? "#f0fff4" : isPending ? "#fefcbf" : "#fff5f5",
              color: isPaid ? "var(--green)" : isPending ? "#b7791f" : "var(--red)",
              marginBottom: 18,
              border: `1px solid ${isPaid ? "#c6f6d5" : isPending ? "#fef08a" : "#fed7d7"}`,
            }}
          >
            {isPaid ? <CheckCircle2 size={26} /> : isPending ? <Clock3 size={26} /> : <AlertTriangle size={26} />}
          </div>

          {loading ? (
            <>
              <span className="page-eyebrow">Transaction processing</span>
              <h1 style={{ fontSize: 30, margin: "6px 0 10px" }}>Checking status...</h1>
              <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
                Please wait while we verify the transaction record with Duitku payment gateway.
              </p>
            </>
          ) : error && !order ? (
            <>
              <span className="page-eyebrow" style={{ color: "var(--red)" }}>Order not found</span>
              <h1 style={{ fontSize: 30, margin: "6px 0 10px" }}>Unable to find order</h1>
              <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 20 }}>{error}</p>
              <NavLink to="/chat" className="button dark auth-submit" style={{ textDecoration: "none" }}>
                Return to Workspace
              </NavLink>
            </>
          ) : order ? (
            <>
              <span className="page-eyebrow" style={{ color: isPaid ? "var(--green)" : isPending ? "#b7791f" : "var(--red)" }}>
                {isPaid ? "Payment Verified" : isPending ? "Awaiting Payment" : "Transaction Incomplete"}
              </span>
              <h1 style={{ fontSize: 30, margin: "6px 0 10px", color: "#17171b" }}>
                {isPaid ? "Subscription Active!" : isPending ? "Payment in Progress" : "Payment Failed"}
              </h1>
              <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5, margin: "0 0 20px" }}>
                {isPaid
                  ? `Your workspace has been upgraded to ${order.plan_name}. All server capacity and AI quotas are now active.`
                  : isPending
                  ? "We are awaiting notification from your bank or e-wallet. This page updates automatically once verified."
                  : "The transaction was cancelled or expired. You can initiate a new checkout anytime."}
              </p>

              <div
                style={{
                  background: "#fff",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  padding: "16px 18px",
                  textAlign: "left",
                  marginBottom: 22,
                  fontSize: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Subscription Plan</span>
                  <b style={{ color: "#17171b" }}>{order.plan_name}</b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Billing Cycle</span>
                  <span style={{ textTransform: "capitalize", color: "#17171b", fontWeight: 600 }}>{order.billing_period}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--muted)" }}>Total Amount</span>
                  <b style={{ color: "var(--accent)", fontSize: 14 }}>{formatIDR(order.amount_idr)}</b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                  <span style={{ color: "var(--muted)" }}>Order Reference</span>
                  <code style={{ fontSize: 11, background: "#f8f8f6", padding: "2px 6px", borderRadius: 4 }}>
                    {order.merchant_order_id}
                  </code>
                </div>
                {order.payment_method && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--muted)" }}>Payment Method</span>
                    <b>{order.payment_method}</b>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {isPaid ? (
                  <button
                    className="button dark auth-submit"
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                    onClick={() => navigate("/chat")}
                  >
                    Open Workspace <ArrowRight size={14} />
                  </button>
                ) : isPending ? (
                  <>
                    {order.payment_url && (
                      <a
                        href={order.payment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="button dark auth-submit"
                        style={{ textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                      >
                        Complete Payment on Duitku <ExternalLink size={14} />
                      </a>
                    )}
                    <button
                      type="button"
                      className="button secondary"
                      disabled={refreshing}
                      onClick={() => {
                        setRefreshing(true);
                        void fetchStatus();
                      }}
                      style={{ minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12 }}
                    >
                      <RefreshCw size={13} className={refreshing ? "spin" : ""} /> {refreshing ? "Checking..." : "Check Status Now"}
                    </button>
                  </>
                ) : (
                  <NavLink to="/pricing" className="button dark auth-submit" style={{ textDecoration: "none" }}>
                    Choose Another Plan
                  </NavLink>
                )}
              </div>
            </>
          ) : null}

          <p className="auth-switch" style={{ marginTop: 24 }}>
            <NavLink to="/chat">Return to Workspace</NavLink>
          </p>
          <div className="auth-trust" style={{ marginTop: 24 }}>
            <ShieldCheck size={12} /> Encrypted session / Duitku POP Verified
          </div>
        </div>
      </main>

      <aside className="auth-visual">
        <div className="auth-grid" />
        <div className="auth-visual-copy">
          <span>PAYMENT GATEWAY / DUITKU POP</span>
          <h2>Automated provisioning.<br />Zero manual delay.</h2>
          <p>Upon cryptographic callback verification, your workspace server concurrency, custom AI model routing, and monthly token limits are unlocked instantly.</p>
        </div>
        <div className="auth-operation">
          <header>
            <span><i /> TRANSACTION LIFECYCLE</span>
            <b>{isPaid ? "COMPLETED" : "IN PROGRESS"}</b>
          </header>
          <div>
            <i><Check size={12} /></i>
            <span><b>Invoice created</b><small>{order?.merchant_order_id || "Duitku order registered"}</small></span>
          </div>
          <div className={isPaid ? "" : "running"}>
            <i>{isPaid ? <Check size={12} /> : <span />}</i>
            <span><b>{isPaid ? "Payment authorized" : "Awaiting payment settlement"}</b><small>QRIS / Virtual Account / E-Wallet webhook</small></span>
          </div>
          <div>
            <i style={{ background: isPaid ? "#253a32" : "#26262b", color: isPaid ? "#70c8ab" : "#666" }}>
              {isPaid ? <Check size={12} /> : <Zap size={12} />}
            </i>
            <span><b>{isPaid ? "Workspace limits active" : "Auto-activation on confirmation"}</b><small>Continuous server health monitoring</small></span>
          </div>
          <footer><ShieldCheck size={11} /> REAL-TIME WEBHOOK VERIFICATION</footer>
        </div>
        <div className="auth-visual-foot">
          <span>DUITKU POP GATEWAY</span>
          <span>OPS / 2026</span>
        </div>
      </aside>
    </div>
  );
}
