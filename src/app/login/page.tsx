"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, Mail, Phone, KeyRound, CheckCircle2, Timer } from "lucide-react";
import { AuthShell, AuthInput, AuthError, AuthSubmit, AuthDivider, GoogleAuthButton } from "@/components/ui/Auth";
import { createClient } from "@/lib/supabase/client";

export default function UserLoginPage() {
  const router = useRouter();
  const [loginMode, setLoginMode] = useState<"otp" | "password">("otp");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [phone, setPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (cooldown > 0) {
      timer = setTimeout(() => setCooldown((prev) => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleGoogleLogin = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!phone || phone.replace(/\D/g, "").length < 10) {
      setError("Enter a valid 10-digit mobile number");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, purpose: "login" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send OTP");
        if (data.cooldownRemaining) setCooldown(data.cooldownRemaining);
        setLoading(false);
        return;
      }
      setOtpSent(true);
      setCooldown(60);
      setNotice(
        data.devCode
          ? `[Dev] Code: ${data.devCode}`
          : "Code sent — check your SMS."
      );
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.length !== 6) {
      setError("Enter the 6-digit code");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/user/login-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid OTP code");
        setLoading(false);
        return;
      }
      router.push("/my-jobs");
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Enter your email and password");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/user/login", {
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
      const supabase = createClient();
      await supabase.auth.signInWithPassword({ email, password });
      router.push("/my-jobs");
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  const switchMode = (mode: "otp" | "password") => {
    setLoginMode(mode);
    setError("");
    setNotice("");
  };

  return (
    <AuthShell title="Welcome back" subtitle="Log in to track your print orders">
      <div className="auth-mode-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={loginMode === "otp"}
          className={`auth-mode-tab${loginMode === "otp" ? " active" : ""}`}
          onClick={() => switchMode("otp")}
        >
          Mobile OTP
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={loginMode === "password"}
          className={`auth-mode-tab${loginMode === "password" ? " active" : ""}`}
          onClick={() => switchMode("password")}
        >
          Email &amp; Password
        </button>
      </div>

      {loginMode === "otp" ? (
        <form className="login-form" onSubmit={otpSent ? handleVerifyOtp : handleSendOtp}>
          <AuthInput
            id="phone"
            label="Mobile number"
            icon={Phone}
            type="tel"
            value={phone}
            onChange={setPhone}
            placeholder="e.g. 9876543210"
            disabled={loading || otpSent}
            autoFocus
          />

          {otpSent && (
            <AuthInput
              id="otpCode"
              label="Verification code"
              icon={KeyRound}
              type="text"
              inputMode="numeric"
              value={otpCode}
              onChange={setOtpCode}
              placeholder="6-digit code"
              disabled={loading}
              autoFocus
              labelAction={
                <button
                  type="button"
                  className="auth-change-link"
                  onClick={() => { setOtpSent(false); setNotice(""); setError(""); }}
                >
                  Change number
                </button>
              }
            />
          )}

          {notice && (
            <div className="auth-otp-notice" role="status">
              <CheckCircle2 size={15} aria-hidden="true" />
              <span>{notice}</span>
            </div>
          )}

          <AuthError>{error}</AuthError>

          {!otpSent ? (
            <AuthSubmit loading={loading} loadingLabel="Sending…" label="Send OTP" />
          ) : (
            <div className="auth-otp-actions">
              <AuthSubmit loading={loading} loadingLabel="Verifying…" label="Verify &amp; Log in" />
              <button
                type="button"
                className="auth-resend-btn"
                disabled={cooldown > 0 || loading}
                onClick={handleSendOtp}
              >
                {cooldown > 0 ? (
                  <><Timer size={14} aria-hidden="true" /> Resend in {cooldown}s</>
                ) : (
                  "Resend OTP"
                )}
              </button>
            </div>
          )}

          <AuthDivider />
          <GoogleAuthButton onClick={handleGoogleLogin} disabled={loading} />
          <p className="login-footer">
            No account? <Link href="/register">Sign up</Link>
          </p>
        </form>
      ) : (
        <form className="login-form" onSubmit={handlePasswordSubmit}>
          <AuthInput
            id="email"
            label="Email"
            icon={Mail}
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@email.com"
            autoComplete="username"
            disabled={loading}
            autoFocus
          />
          <AuthInput
            id="password"
            label="Password"
            icon={Lock}
            password
            value={password}
            onChange={setPassword}
            placeholder="Your password"
            autoComplete="current-password"
            disabled={loading}
            labelAction={
              <Link href="/forgot-password" className="input-label-link">
                Forgot password?
              </Link>
            }
          />
          <AuthError>{error}</AuthError>
          <AuthSubmit loading={loading} loadingLabel="Signing in…" label="Log in" />
          <AuthDivider />
          <GoogleAuthButton onClick={handleGoogleLogin} disabled={loading} />
          <p className="login-footer">
            No account? <Link href="/register">Sign up</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
