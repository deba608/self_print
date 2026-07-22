"use client";

import { useState } from "react";
import Link from "next/link";
import { Printer, Lock, Mail, User, Phone, Eye, EyeOff, ArrowRight, Loader2, MailCheck } from "lucide-react";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter email and password");
      return;
    }
    if (!phone.trim()) {
      setError("Phone number is required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/customer/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName, phone }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || "Unable to create account");
        setLoading(false);
        return;
      }
      if (body.needsEmailConfirmation) {
        setConfirmationSent(true);
        setLoading(false);
        return;
      }
      window.location.href = "/customer-login";
    } catch {
      setError("Connection error. Please try again.");
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
            <h1>Create Your Account</h1>
          </div>

          {confirmationSent ? (
            <div className="login-form">
              <div className="login-error" style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
                <MailCheck size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
                <span>Check your email to confirm your account before logging in.</span>
              </div>
              <p className="login-footer">
                <Link href="/customer-login">Back to log in</Link>
              </p>
            </div>
          ) : (
            <form className="login-form" onSubmit={handleSubmit}>
              <div className="input-group">
                <label htmlFor="displayName">Name</label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <User size={18} strokeWidth={2} />
                  </span>
                  <input
                    id="displayName"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    disabled={loading}
                  />
                </div>
              </div>

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
                    placeholder="Enter email"
                    autoComplete="username"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="phone">Phone</label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <Phone size={18} strokeWidth={2} />
                  </span>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Enter phone number"
                    autoComplete="tel"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="input-group">
                <label htmlFor="password">Password</label>
                <div className="input-wrapper">
                  <span className="input-icon">
                    <Lock size={18} strokeWidth={2} />
                  </span>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a password"
                    autoComplete="new-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
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
                    Creating account...
                  </>
                ) : (
                  <>
                    <span>Create Account</span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>

              <p className="login-footer">
                Already have an account? <Link href="/customer-login">Log in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
