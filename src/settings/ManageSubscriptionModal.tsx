import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { settingsApi, type WorkspaceSubscriptionDTO } from "../api/settings";
import "../styles/marketing.css";

function formatIDR(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function ManageSubscriptionModal({ close }: { close: () => void }) {
  const navigate = useNavigate();
  const [data, setData] = useState<WorkspaceSubscriptionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await settingsApi.getWorkspaceSubscription();
      setData(res);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load subscription");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCancel = async () => {
    setCancelling(true);
    setError("");
    try {
      await settingsApi.cancelWorkspaceSubscription();
      setCancelSuccess(true);
      void load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to cancel subscription");
    } finally {
      setCancelling(false);
    }
  };

  const usedPercent = data && data.monthly_tokens > 0
    ? Math.min(100, Math.round((data.used_tokens / data.monthly_tokens) * 100))
    : 0;

  return (
    <div className="admin-overlay modal">
      <button className="admin-scrim" onClick={close} />
      <div className="publish-modal" style={{ width: "min(560px, 100%)", borderRadius: 16, background: "#fff" }}>
        <header style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center" }}>
              <CreditCard size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, margin: 0 }}>Manage Subscription</h2>
              <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 11 }}>Review, upgrade, or cancel your workspace plan.</p>
            </div>
          </div>
          <button type="button" onClick={close} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--muted)" }}>
            <X size={18} />
          </button>
        </header>

        <div style={{ padding: "20px 24px", maxHeight: "calc(85vh - 120px)", overflowY: "auto" }}>
          {error && <div className="inline-api-error" role="alert">{error}</div>}

          {loading ? (
            <div style={{ padding: "30px 0", textAlign: "center" }}>
              <span className="tiny-spinner" /> Loading subscription details...
            </div>
          ) : data ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Active Plan Card */}
              <div style={{ padding: 18, background: data.has_active_plan ? "#f8f8f6" : "#fff", border: "1px solid var(--line)", borderRadius: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Current Workspace Tier
                    </span>
                    <h3 style={{ fontSize: 20, margin: "4px 0 2px", color: "#17171b" }}>{data.plan_name}</h3>
                    <small style={{ color: "var(--muted)", fontSize: 11 }}>
                      {data.has_active_plan ? `${formatIDR(data.price_cents)} / month` : "Free starter tier with basic quotas"}
                    </small>
                  </div>
                  <span
                    style={{
                      padding: "4px 9px",
                      borderRadius: 6,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      background: data.has_active_plan ? "#f0fff4" : "var(--soft)",
                      color: data.has_active_plan ? "var(--green)" : "#666",
                      border: `1px solid ${data.has_active_plan ? "#c6f6d5" : "var(--line)"}`,
                    }}
                  >
                    {data.has_active_plan ? "Active Plan" : "Starter"}
                  </span>
                </div>

                {/* Quota Details */}
                <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: "var(--muted)" }}>Monthly AI Token Usage</span>
                      <b>{new Intl.NumberFormat("id-ID").format(data.used_tokens)} / {new Intl.NumberFormat("id-ID").format(data.monthly_tokens)}</b>
                    </div>
                    <div style={{ width: "100%", height: 6, background: "#e7e7e3", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${usedPercent}%`, height: "100%", background: usedPercent > 85 ? "var(--red)" : "var(--accent)", borderRadius: 3 }} />
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: "var(--muted)" }}>Max Concurrent Servers</span>
                    <b>Up to {data.max_servers} servers</b>
                  </div>

                  {data.expires_at && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span style={{ color: "var(--muted)" }}>Renewal / Expiration Date</span>
                      <b style={{ color: "#17171b" }}>{new Date(data.expires_at).toLocaleDateString()}</b>
                    </div>
                  )}
                </div>
              </div>

              {/* Manage Options (Tetap Langganan / Ubah / Batal) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Subscription Options
                </span>

                {/* Option 1: Keep Subscription */}
                <div style={{ padding: "14px 16px", background: "#fff", border: "1px solid var(--line)", borderRadius: 10, display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#f0fff4", color: "var(--green)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <CheckCircle2 size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <b style={{ fontSize: 12, display: "block" }}>Tetap Berlangganan (Keep Subscription)</b>
                    <small style={{ color: "var(--muted)", fontSize: 10 }}>Your plan remains active with continuous server diagnostics and quotas.</small>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--green)", background: "#f0fff4", padding: "3px 8px", borderRadius: 5 }}>
                    Active
                  </span>
                </div>

                {/* Option 2: Change / Upgrade Plan */}
                <div style={{ padding: "14px 16px", background: "#fff", border: "1px solid var(--line)", borderRadius: 10, display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Zap size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <b style={{ fontSize: 12, display: "block" }}>Ubah Paket (Change / Upgrade Plan)</b>
                    <small style={{ color: "var(--muted)", fontSize: 10 }}>Switch to higher server capacity or dedicated AI token tiers.</small>
                  </div>
                  <button
                    type="button"
                    className="button dark compact"
                    onClick={() => {
                      close();
                      navigate("/pricing");
                    }}
                    style={{ fontSize: 11 }}
                  >
                    View Plans <ArrowRight size={12} />
                  </button>
                </div>

                {/* Option 3: Cancel Subscription */}
                {data.has_active_plan && (
                  <div style={{ padding: "14px 16px", background: "#fff", border: "1px solid var(--line)", borderRadius: 10, display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "#fff5f5", color: "var(--red)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <AlertTriangle size={18} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <b style={{ fontSize: 12, display: "block", color: "var(--red)" }}>Batalkan Langganan (Cancel Plan)</b>
                      <small style={{ color: "var(--muted)", fontSize: 10 }}>Reverts workspace back to free tier at the end of the billing period.</small>
                    </div>
                    <button
                      type="button"
                      className="button secondary compact"
                      onClick={() => setShowCancelConfirm(true)}
                      style={{ fontSize: 11, color: "var(--red)", borderColor: "#fed7d7" }}
                    >
                      Cancel Plan
                    </button>
                  </div>
                )}
              </div>

              {/* Confirmation Prompt for Cancellation */}
              {showCancelConfirm && (
                <div style={{ padding: 16, background: "#fff5f5", border: "1px solid #fed7d7", borderRadius: 10 }}>
                  <h4 style={{ margin: "0 0 6px", color: "#9b2c2c", fontSize: 13 }}>Confirm Subscription Cancellation?</h4>
                  <p style={{ color: "#742a2a", fontSize: 11, lineHeight: 1.5, margin: "0 0 14px" }}>
                    Are you sure you want to cancel your {data.plan_name} plan? Premium server concurrency limits and monthly token allocations will be reset.
                  </p>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="button secondary compact"
                      onClick={() => setShowCancelConfirm(false)}
                      disabled={cancelling}
                    >
                      Keep My Plan
                    </button>
                    <button
                      type="button"
                      className="button dark compact"
                      style={{ background: "var(--red)", borderColor: "var(--red)" }}
                      onClick={() => void handleCancel()}
                      disabled={cancelling}
                    >
                      {cancelling ? "Cancelling..." : "Yes, Cancel Plan"}
                    </button>
                  </div>
                </div>
              )}

              {cancelSuccess && (
                <div style={{ padding: 12, background: "#f0fff4", border: "1px solid #c6f6d5", borderRadius: 8, color: "var(--green)", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle2 size={14} /> Subscription cancelled. Workspace has been reset to free tier.
                </div>
              )}
            </div>
          ) : null}
        </div>

        <footer style={{ padding: "14px 24px", borderTop: "1px solid var(--line)", background: "#fafaf8", display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="button secondary" onClick={close}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
