import { useEffect, useState } from "react";
import { useParams, useNavigate, NavLink, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  ExternalLink,
  Lock,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { adminApi, listPublicPlans, type Plan } from "../api/admin";
import "../styles/marketing.css";

declare global {
  interface Window {
    checkout?: {
      process: (
        reference: string,
        options: {
          defaultLanguage?: string;
          successEvent?: (result: unknown) => void;
          pendingEvent?: (result: unknown) => void;
          errorEvent?: (result: unknown) => void;
          closeEvent?: (result: unknown) => void;
        }
      ) => void;
    };
  }
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-label="OpsAI">
      <span />
      <span />
      <span />
      <span />
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

export default function CheckoutPage() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const initialPeriod = searchParams.get("period") === "annual" ? "annual" : "monthly";

  const [plan, setPlan] = useState<Plan | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">(initialPeriod);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState("");
  const [duitkuConfig, setDuitkuConfig] = useState<{ duitku_enabled: boolean; duitku_environment: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([listPublicPlans(), adminApi.getPublicBillingConfig()])
      .then(([plans, config]) => {
        if (!mounted) return;
        setDuitkuConfig(config);
        const found = plans.find((p) => p.id === planId || p.slug === planId);
        if (found) {
          setPlan(found);
        } else {
          setError("Selected subscription plan is not found.");
        }
      })
      .catch((caught) => {
        if (mounted) setError(caught instanceof Error ? caught.message : "Unable to load plan");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [planId]);

  // Dynamically load Duitku POP script
  useEffect(() => {
    if (!duitkuConfig?.duitku_enabled) return;
    const scriptUrl =
      duitkuConfig.duitku_environment === "production"
        ? "https://app-prod.duitku.com/lib/js/duitku.js"
        : "https://app-sandbox.duitku.com/lib/js/duitku.js";

    const existing = document.querySelector(`script[src="${scriptUrl}"]`);
    if (!existing) {
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      document.head.appendChild(script);
    }
  }, [duitkuConfig]);

  const handlePay = async () => {
    if (!plan) return;
    setPaying(true);
    setError("");
    setFallbackUrl("");

    try {
      const order = await adminApi.createCheckoutOrder({
        plan_id: plan.id,
        billing_period: billingPeriod,
      });

      if (order.payment_url) {
        setFallbackUrl(order.payment_url);
      }

      // Try invoking Duitku POP
      if (window.checkout && typeof window.checkout.process === "function") {
        window.checkout.process(order.reference, {
          defaultLanguage: "id",
          successEvent: function (result: unknown) {
            navigate(`/checkout/result?merchantOrderId=${encodeURIComponent(order.merchant_order_id)}`);
          },
          pendingEvent: function (result: unknown) {
            navigate(`/checkout/result?merchantOrderId=${encodeURIComponent(order.merchant_order_id)}`);
          },
          errorEvent: function (result: unknown) {
            setError("Payment processing encountered an issue. Please try again or open the direct payment link below.");
          },
          closeEvent: function () {
            // Popup closed by user
            setPaying(false);
          },
        });
      } else {
        // Fallback to direct redirect if POP script is not loaded or popup is blocked
        window.location.href = order.payment_url;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to initiate payment");
      setPaying(false);
    }
  };

  const amount = plan ? (billingPeriod === "annual" ? plan.annualPriceCents * 12 : plan.priceCents) : 0;

  return (
    <div className="landing-page" style={{ minHeight: "100vh", background: "#f8f8f6" }}>
      <nav className="landing-nav" style={{ maxWidth: 1080, margin: "0 auto", padding: "18px 24px" }}>
        <NavLink to="/dashboard/pricing" className="landing-brand" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark />
          <span>OpsAI</span>
        </NavLink>
        <NavLink to="/dashboard/pricing" className="button secondary compact" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ArrowLeft size={13} /> Back to Pricing
        </NavLink>
      </nav>

      <main style={{ maxWidth: 860, margin: "20px auto 80px", padding: "0 20px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 20px" }}>
            <span className="tiny-spinner" /> Loading order details...
          </div>
        ) : error && !plan ? (
          <div style={{ padding: 32, background: "#fff", border: "1px solid var(--line)", borderRadius: 16, textAlign: "center" }}>
            <h2 style={{ fontSize: 20, margin: "0 0 10px" }}>Unable to start checkout</h2>
            <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 20 }}>{error}</p>
            <NavLink to="/pricing" className="button dark">
              Return to Pricing
            </NavLink>
          </div>
        ) : plan ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
            {/* Left side: Order summary */}
            <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 16, padding: "28px 24px" }}>
              <span className="page-eyebrow" style={{ color: "var(--accent)" }}>Order Confirmation</span>
              <h1 style={{ fontSize: 26, margin: "6px 0 12px", color: "#17171b" }}>Subscribe to {plan.name}</h1>
              <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, margin: "0 0 24px" }}>
                {plan.description || "Upgrade your infrastructure limits with verified execution, live terminal logs, and dedicated AI capacity."}
              </p>

              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#f8f8f6", borderRadius: 10, marginBottom: 24, border: "1px solid var(--line)" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#17171b" }}>Billing period:</span>
                <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                  <button
                    type="button"
                    className={`button ${billingPeriod === "monthly" ? "dark compact" : "secondary compact"}`}
                    onClick={() => setBillingPeriod("monthly")}
                    style={{ fontSize: 11 }}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    className={`button ${billingPeriod === "annual" ? "dark compact" : "secondary compact"}`}
                    onClick={() => setBillingPeriod("annual")}
                    style={{ fontSize: 11 }}
                  >
                    Annual (Save)
                  </button>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 18 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  What's included in {plan.name}
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#f0fff4", color: "var(--green)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <Check size={12} />
                    </div>
                    <span>Up to <b>{plan.maxServers} servers</b> connected concurrently</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#f0fff4", color: "var(--green)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <Check size={12} />
                    </div>
                    <span><b>{new Intl.NumberFormat("id-ID").format(plan.monthlyTokens)}</b> monthly AI diagnostic tokens</span>
                  </div>
                  {plan.features.map((f) => (
                    <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#f0fff4", color: "var(--green)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                        <Check size={12} />
                      </div>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right side: Payment summary card */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 16, padding: "24px 20px" }}>
                <h3 style={{ fontSize: 16, margin: "0 0 16px" }}>Payment Details</h3>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8, color: "var(--muted)" }}>
                  <span>Plan</span>
                  <span style={{ fontWeight: 600, color: "#17171b" }}>{plan.name}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 14, color: "var(--muted)" }}>
                  <span>Billing Cycle</span>
                  <span style={{ fontWeight: 600, color: "#17171b" }}>{billingPeriod === "annual" ? "12 Months" : "1 Month"}</span>
                </div>

                <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>Total Due</span>
                    <strong style={{ fontSize: 20, color: "var(--accent)" }}>{formatIDR(amount)}</strong>
                  </div>
                  <small style={{ color: "var(--muted)", fontSize: 10, display: "block", marginTop: 4 }}>
                    Includes all taxes & gateway processing
                  </small>
                </div>

                {error && (
                  <div style={{ padding: "10px 12px", background: "#fff5f5", border: "1px solid #fed7d7", borderRadius: 8, color: "var(--red)", fontSize: 11, marginBottom: 14, lineHeight: 1.4 }}>
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  className="button dark"
                  disabled={paying}
                  onClick={() => void handlePay()}
                  style={{ width: "100%", minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 700 }}
                >
                  <CreditCard size={15} /> {paying ? "Opening Duitku..." : "Pay with Duitku"}
                </button>

                {fallbackUrl && (
                  <div style={{ marginTop: 12, textAlign: "center" }}>
                    <a
                      href={fallbackUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600 }}
                    >
                      Open Payment in New Tab <ExternalLink size={11} />
                    </a>
                  </div>
                )}

                <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)" }}>
                    <ShieldCheck size={13} color="var(--green)" /> QRIS, VA (BCA, Mandiri, BNI, BRI), E-Wallet
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--muted)" }}>
                    <Lock size={13} /> 256-bit Encrypted checkout via Duitku
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
