import { useEffect, useState } from "react";
import { useSearchParams, NavLink, useNavigate } from "react-router-dom";
import { CheckCircle2, AlertTriangle, Mail, ArrowRight, ShieldCheck, Check } from "lucide-react";
import { adminApi } from "../api/admin";
import "../styles/marketing.css";

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

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();

  const [loading, setLoading] = useState(Boolean(token));
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(token ? "" : "No verification token provided in the URL.");

  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState("");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError("");
    adminApi
      .verifyEmail(token)
      .then(() => {
        setSuccess(true);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Verification failed");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail.trim()) return;
    setResending(true);
    setResendStatus("");
    try {
      const res = await adminApi.resendVerification(resendEmail.trim());
      setResendStatus(res.message || "Verification link sent. Check your inbox.");
    } catch (caught) {
      setResendStatus(caught instanceof Error ? caught.message : "Unable to send verification link");
    } finally {
      setResending(false);
    }
  };

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
              width: 44,
              height: 44,
              borderRadius: 12,
              background: success ? "#f0fff4" : error ? "#fff5f5" : "var(--accent-soft)",
              color: success ? "var(--green)" : error ? "var(--red)" : "var(--accent)",
              marginBottom: 18,
              border: `1px solid ${success ? "#c6f6d5" : error ? "#fed7d7" : "#7657ff20"}`,
            }}
          >
            {success ? <CheckCircle2 size={24} /> : error ? <AlertTriangle size={24} /> : <Mail size={24} />}
          </div>

          {loading ? (
            <>
              <span className="page-eyebrow">Security validation</span>
              <h1 style={{ fontSize: 32, margin: "8px 0 10px" }}>Verifying email...</h1>
              <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
                Please wait while we validate your activation token against the platform cryptographic store.
              </p>
            </>
          ) : success ? (
            <>
              <span className="page-eyebrow" style={{ color: "var(--green)" }}>Activated</span>
              <h1 style={{ fontSize: 32, margin: "8px 0 10px" }}>Email Verified!</h1>
              <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
                Your account is confirmed! Choose your workspace plan to activate AI root-cause analysis, live terminal streaming, and connected server capacity.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  className="button dark auth-submit"
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                  onClick={() => navigate("/login", { state: { from: "/dashboard/pricing?mode=onboarding" } })}
                >
                  Sign In &amp; Select Plan <ArrowRight size={14} />
                </button>
                <button
                  type="button"
                  className="button secondary"
                  style={{ width: "100%" }}
                  onClick={() => navigate("/login")}
                >
                  Sign In Directly
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="page-eyebrow" style={{ color: "var(--red)" }}>Verification error</span>
              <h1 style={{ fontSize: 32, margin: "8px 0 10px" }}>Activation failed</h1>
              <div
                style={{
                  padding: "12px 14px",
                  background: "#fff5f5",
                  border: "1px solid #fed7d7",
                  borderRadius: 10,
                  color: "#9b2c2c",
                  fontSize: 12,
                  lineHeight: 1.5,
                  marginBottom: 20,
                }}
              >
                {error}
              </div>

              <form onSubmit={handleResend} style={{ display: "flex", flexDirection: "column", gap: 10, textAlign: "left" }}>
                <label className="auth-field">
                  <span>Registered email address</span>
                  <div>
                    <Mail size={15} />
                    <input
                      type="email"
                      required
                      placeholder="you@company.com"
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                    />
                  </div>
                </label>
                <button type="submit" className="button dark" disabled={resending} style={{ minHeight: 40, marginTop: 4 }}>
                  {resending ? "Sending link..." : "Send new activation link"}
                </button>
                {resendStatus && (
                  <div
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "#f0fff4",
                      color: "var(--green)",
                      fontSize: 11,
                      border: "1px solid #c6f6d5",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <CheckCircle2 size={13} /> {resendStatus}
                  </div>
                )}
              </form>

              <p className="auth-switch" style={{ marginTop: 24 }}>
                <NavLink to="/login">Back to Sign In</NavLink>
              </p>
            </>
          )}
          <div className="auth-trust" style={{ marginTop: 28 }}>
            <ShieldCheck size={12} /> Encrypted session / Approval-first operations
          </div>
        </div>
      </main>

      <aside className="auth-visual">
        <div className="auth-grid" />
        <div className="auth-visual-copy">
          <span>PLATFORM SECURITY / ACTIVATION</span>
          <h2>Operate with context.<br />Execute with confidence.</h2>
          <p>One secure workspace for every server, investigation, approval, and live verified terminal output.</p>
        </div>
        <div className="auth-operation">
          <header>
            <span><i /> ACTIVATION STATUS</span>
            <b>{success ? "VERIFIED" : "IDENTITY GATEWAY"}</b>
          </header>
          <div>
            <i><Check size={12} /></i>
            <span><b>Workspace identity</b><small>Cryptographic token verified</small></span>
          </div>
          <div>
            <i><Check size={12} /></i>
            <span><b>SSH Engine ready</b><small>Bounded read-only & safe mutation agents</small></span>
          </div>
          <div className={success ? "" : "running"}>
            <i>{success ? <Check size={12} /> : <span />}</i>
            <span><b>{success ? "Control plane unlocked" : "Verifying credentials"}</b><small>Multi-server live execution dashboard</small></span>
          </div>
          <footer><ShieldCheck size={11} /> HUMAN APPROVAL REMAINS IN THE LOOP</footer>
        </div>
        <div className="auth-visual-foot">
          <span>SESSION ENCRYPTED</span>
          <span>OPS / 2026</span>
        </div>
      </aside>
    </div>
  );
}
