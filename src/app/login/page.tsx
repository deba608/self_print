"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Printer, Lock, Mail, Eye, EyeOff, ArrowRight, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter email and password");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || "Invalid credentials");
        setLoading(false);
        return;
      }
      router.push("/admin");
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
            <h1>SelfPrint Admin</h1>
          </div>

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
                  placeholder="Enter email"
                  autoComplete="username"
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
                  placeholder="Enter password"
                  autoComplete="current-password"
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
                  Signing in...
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>

            <p className="login-footer">
              <Link href="/forgot-password?from=admin">Forgot password?</Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
