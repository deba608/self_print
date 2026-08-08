"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, Mail, Phone, KeyRound, ArrowRight } from "lucide-react";
import { AuthShell, AuthInput, AuthError, AuthSubmit, AuthDivider, GoogleAuthButton } from "@/components/ui/Auth";
import { createClient } from "@/lib/supabase/client";

export default function UserLoginPage() {
  const router = useRouter();
  const [loginMode, setLoginMode] = useState<"otp" | "password">("otp");

  // Email / Password mode state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // OTP mode state
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
      setError("Please enter a valid 10-digit mobile number");
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
          ? `[Dev Mode] Verification code: ${data.devCode}`
          : "OTP sent! Please check your mobile messages."
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
      setError("Please enter the 6-digit OTP code");
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
      setError("Please enter email and password");
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

  return (
    <AuthShell title="Welcome Back" subtitle="Log in to track your print orders">
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px", borderBottom: "1px solid var(--border-color, #e5e7eb)", paddingBottom: "10px" }}>
        <button
          type="button"
          onClick={() => { setLoginMode("otp"); setError(""); setNotice(""); }}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: "8px",
            border: "none",
            fontWeight: 600,
            cursor: "pointer",
            background: loginMode === "otp" ? "var(--primary-color, #2563eb)" : "transparent",
            color: loginMode === "otp" ? "#ffffff" : "var(--text-secondary, #6b7280)",
          }}
        >
          Mobile OTP
        </button>
        <button
          type="button"
          onClick={() => { setLoginMode("password"); setError(""); setNotice(""); }}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: "8px",
            border: "none",
            fontWeight: 600,
            cursor: "pointer",
            background: loginMode === "password" ? "var(--primary-color, #2563eb)" : "transparent",
            color: loginMode === "password" ? "#ffffff" : "var(--text-secondary, #6b7280)",
          }}
        >
          Email & Password
        </button>
      </div>

      {loginMode === "otp" ? (
        <form className="login-form" onSubmit={otpSent ? handleVerifyOtp : handleSendOtp}>
          <AuthInput
            id="phone"
            label="Mobile Number"
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
              label="6-Digit Verification Code"
              icon={KeyRound}
              type="text"
              value={otpCode}
              onChange={setOtpCode}
              placeholder="Enter 6-digit code"
              disabled={loading}
              autoFocus
              labelAction={
                <button
                  type="button"
                  onClick={() => setOtpSent(false)}
                  style={{ background: "none", border: "none", color: "var(--primary-color, #2563eb)", fontSize: "0.85rem", cursor: "pointer" }}
                >
                  Change phone
                </button>
              }
            />
          )}

          {notice && <p style={{ color: "#059669", fontSize: "0.875rem", margin: "4px 0 12px 0", fontWeight: 500 }}>{notice}</p>}
          <AuthError>{error}</AuthError>

          {!otpSent ? (
            <AuthSubmit loading={loading} loadingLabel="Sending OTP..." label="Send OTP via SMS" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <AuthSubmit loading={loading} loadingLabel="Verifying..." label="Verify OTP & Log In" />
              <button
                type="button"
                disabled={cooldown > 0 || loading}
                onClick={handleSendOtp}
                style={{
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  background: "transparent",
                  fontWeight: 500,
                  cursor: cooldown > 0 ? "not-allowed" : "pointer",
                  color: cooldown > 0 ? "#9ca3af" : "#374151",
                }}
              >
                {cooldown > 0 ? `Resend OTP in ${cooldown}s` : "Resend OTP SMS"}
              </button>
            </div>
          )}

          <AuthDivider />
          <GoogleAuthButton onClick={handleGoogleLogin} disabled={loading} />
          <p className="login-footer">
            Need an account? <Link href="/register">Sign up</Link>
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
            placeholder="Enter email"
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
            placeholder="Enter password"
            autoComplete="current-password"
            disabled={loading}
            labelAction={
              <Link href="/forgot-password" className="input-label-link">
                Forgot password?
              </Link>
            }
          />
          <AuthError>{error}</AuthError>
          <AuthSubmit loading={loading} loadingLabel="Signing in..." label="Log in" />
          <AuthDivider />
          <GoogleAuthButton onClick={handleGoogleLogin} disabled={loading} />
          <p className="login-footer">
            Need an account? <Link href="/register">Sign up</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
