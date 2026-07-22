"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Printer, Mail, ArrowRight, Loader2, MailCheck } from "lucide-react";

function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const loginHref = searchParams.get("from") === "admin" ? "/login" : "/customer-login";
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Please enter your email");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await fetch("/api/customer/forgot-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // Always show the generic success message, regardless of outcome —
      // prevents leaking whether an account exists for this email.
      setSent(true);
      setLoading(false);
    } catch {
      // Even on a network error, don't reveal anything specific — show the
      // same generic message.
      setSent(true);
      setLoading(false);
    }
  };

  return (
    <main className="admin-login-shell">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <Printer size={32} strokeWidth={1.5} />
            </div>
            <h1>Reset Password</h1>
          </div>

          {sent ? (
            <div className="login-form">
              <div className="login-error" style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                <MailCheck size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
                <span>If an account exists for that email, a reset link has been sent.</span>
              </div>
              <p className="login-footer">
                <Link href={loginHref}>Back to log in</Link>
              </p>
            </div>
          ) : (
            <form className="login-form" onSubmit={handleSubmit}>
              <div className="input-group">
                <label htmlFor="email">Email</label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <Mail size={18} strokeWidth={2} />
                  </span>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your account email"
                    autoComplete="username"
                    disabled={loading}
                  />
                </div>
              </div>

              {error && (
                <div className="login-error">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                  </svg>
                  {error}
                </div>
              )}

              <button type="submit" className="login-btn" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <span>Send Reset Link</span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>

              <p className="login-footer">
                <Link href={loginHref}>Back to log in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
