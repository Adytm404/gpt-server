import { useEffect, useState } from "react";
import { useSearchParams, NavLink, useNavigate } from "react-router-dom";
import { CheckCircle2, AlertTriangle, Mail, ArrowRight, RefreshCw } from "lucide-react";
import { adminApi } from "../api/admin";
import "../styles/marketing.css";

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();

  const [loading, setLoading] = useState(Boolean(token));
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(token ? "" : "No verification token provided");

  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState("");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError("");
    adminApi
      .verifyEmail(token)
      .then((res) => {
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
    <div className="auth-page" style={{ height: "100vh", display: "grid", placeItems: "center", overflow: "hidden" }}>
      <div className="auth-form-wrap" style={{ maxWidth: 440, padding: "32px 24px", background: "#fff", border: "1px solid var(--line)", borderRadius: 16, textAlign: "center", boxShadow: "0 10px 30px #00000008" }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", background: success ? "#f0fff4" : error ? "#fff5f5" : "#f0edff", color: success ? "var(--green)" : error ? "var(--red)" : "var(--accent)", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
          {success ? <CheckCircle2 size={26} /> : error ? <AlertTriangle size={26} /> : <Mail size={26} />}
        </div>

        {loading ? (
          <>
            <h2 style={{ margin: "0 0 8px", fontSize: 22 }}>Verifying your email...</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>Please wait while we validate your activation token.</p>
          </>
        ) : success ? (
          <>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, color: "#17171b" }}>Email Verified!</h2>
            <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 24px" }}>
              Your workspace account is now active and ready for secure operations.
            </p>
            <button className="button dark" style={{ width: "100%" }} onClick={() => navigate("/login")}>
              Sign In to OpsAI <ArrowRight size={14} />
            </button>
          </>
        ) : (
          <>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, color: "#17171b" }}>Verification Failed</h2>
            <p style={{ color: "var(--red)", fontSize: 12, margin: "0 0 20px" }}>{error}</p>

            <form onSubmit={handleResend} style={{ display: "flex", flexDirection: "column", gap: 10, textAlign: "left" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#17171b" }}>Request a new verification link</span>
              <input
                type="email"
                required
                placeholder="Enter your registered email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                style={{ width: "100%", height: 38, border: "1px solid var(--line)", borderRadius: 8, padding: "0 10px", fontSize: 12 }}
              />
              <button type="submit" className="button dark" disabled={resending} style={{ width: "100%", height: 38 }}>
                {resending ? "Sending..." : "Resend Link"}
              </button>
              {resendStatus && <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>{resendStatus}</p>}
            </form>

            <div style={{ marginTop: 20, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <NavLink to="/login" style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>
                Back to Sign In
              </NavLink>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
