import { useEffect, useState } from "react";
import { useSearchParams, NavLink, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { adminApi } from "../api/admin";
import "../styles/marketing.css";

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
    // Poll every 3 seconds while pending
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
    <div className="auth-page" style={{ height: "100vh", display: "grid", placeItems: "center", overflow: "hidden", background: "#f8f8f6" }}>
      <div className="auth-form-wrap" style={{ maxWidth: 480, padding: "32px 24px", background: "#fff", border: "1px solid var(--line)", borderRadius: 16, textAlign: "center", boxShadow: "0 10px 30px #00000008" }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: isPaid ? "#f0fff4" : isPending ? "#fefcbf" : "#fff5f5",
            color: isPaid ? "var(--green)" : isPending ? "#b7791f" : "var(--red)",
            display: "grid",
            placeItems: "center",
            margin: "0 auto 16px",
            border: `1px solid ${isPaid ? "#c6f6d5" : isPending ? "#fef08a" : "#fed7d7"}`,
          }}
        >
          {isPaid ? <CheckCircle2 size={28} /> : isPending ? <Clock3 size={28} /> : <AlertTriangle size={28} />}
        </div>

        {loading ? (
          <>
            <h2 style={{ fontSize: 22, margin: "0 0 8px" }}>Checking payment status...</h2>
            <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>Please wait while we verify transaction with Duitku.</p>
          </>
        ) : error && !order ? (
          <>
            <h2 style={{ fontSize: 22, margin: "0 0 8px" }}>Order not found</h2>
            <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 20 }}>{error}</p>
            <NavLink to="/chat" className="button dark">
              Return to Workspace
            </NavLink>
          </>
        ) : order ? (
          <>
            <span className="page-eyebrow" style={{ color: isPaid ? "var(--green)" : isPending ? "#b7791f" : "var(--red)" }}>
              {isPaid ? "Payment Verified" : isPending ? "Awaiting Payment" : "Transaction Failed"}
            </span>
            <h1 style={{ fontSize: 26, margin: "6px 0 10px", color: "#17171b" }}>
              {isPaid ? "Subscription Active!" : isPending ? "Payment in Progress" : "Payment Incomplete"}
            </h1>
            <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5, margin: "0 0 20px" }}>
              {isPaid
                ? `Your workspace has been upgraded to ${order.plan_name}. All server capacity and AI quotas are immediately available.`
                : isPending
                ? "We are awaiting confirmation from your bank or e-wallet provider. This page updates automatically once verified."
                : "The transaction was cancelled or expired. You can try checking out again anytime."}
            </p>

            <div style={{ background: "#f8f8f6", border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px", textAlign: "left", marginBottom: 20, fontSize: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Plan</span>
                <b style={{ color: "#17171b" }}>{order.plan_name}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Total Paid</span>
                <b style={{ color: "var(--accent)" }}>{formatIDR(order.amount_idr)}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--muted)" }}>Order ID</span>
                <code style={{ fontSize: 11 }}>{order.merchant_order_id}</code>
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
                <button className="button dark" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }} onClick={() => navigate("/chat")}>
                  Open Workspace <ArrowRight size={14} />
                </button>
              ) : isPending ? (
                <>
                  {order.payment_url && (
                    <a
                      href={order.payment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="button dark"
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
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    <RefreshCw size={13} className={refreshing ? "spin" : ""} /> Check Status Now
                  </button>
                </>
              ) : (
                <NavLink to="/pricing" className="button dark" style={{ textDecoration: "none" }}>
                  Choose Another Plan
                </NavLink>
              )}
            </div>
          </>
        ) : null}

        <div style={{ marginTop: 24, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <NavLink to="/chat" style={{ fontSize: 12, color: "var(--muted)" }}>
            Return to OpsAI
          </NavLink>
        </div>
      </div>
    </div>
  );
}
