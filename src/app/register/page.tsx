"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, Mail, User, Phone, MailCheck, CheckCircle2 } from "lucide-react";
import { AuthShell, AuthInput, AuthError, AuthNotice, AuthSubmit, AuthDivider, GoogleAuthButton } from "@/components/ui/Auth";
import { createClient } from "@/lib/supabase/client";

function passwordStrength(pw: string): { met: boolean; label: string } {
  const met = pw.length >= 8;
  return { met, label: met ? "Strong enough" : "At least 8 characters" };
}

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState("");

  const { met: pwMet, label: pwLabel } = passwordStrength(password);

  const handleGoogleSignup = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }
    if (!pwMet) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!phone.trim()) {
      setError("Phone number is required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/user/register", {
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
      window.location.href = "/login";
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resending) return;
    setResending(true);
    setResendNotice("");
    try {
      await fetch("/api/user/resend-confirmation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      setResendNotice(
        "If this account still needs confirmation, a new email has been sent."
      );
      setResending(false);
    }
  };

  return (
    <AuthShell title="Create account" subtitle="Save orders and track them anytime">
      {confirmationSent ? (
        <div className="login-form">
          <AuthNotice icon={MailCheck}>
            Check your inbox (and spam) for the confirmation email. Already
            registered? Log in or reset your password instead.
          </AuthNotice>
          {resendNotice && <AuthNotice icon={CheckCircle2}>{resendNotice}</AuthNotice>}
          <button
            type="button"
            className="auth-link-button"
            onClick={handleResend}
            disabled={resending}
          >
            {resending ? "Sending…" : "Resend confirmation email"}
          </button>
          <p className="login-footer">
            <Link href="/login">Log in</Link>
            {" · "}
            <Link href="/forgot-password">Reset password</Link>
          </p>
        </div>
      ) : (
        <form className="login-form" onSubmit={handleSubmit}>
          <AuthInput
            id="displayName"
            label="Name"
            icon={User}
            value={displayName}
            onChange={setDisplayName}
            placeholder="Your name"
            autoComplete="name"
            disabled={loading}
            autoFocus
          />
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
          />
          <AuthInput
            id="phone"
            label="Phone"
            icon={Phone}
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={setPhone}
            placeholder="10-digit mobile number"
            autoComplete="tel"
            required
            disabled={loading}
          />
          <div>
            <AuthInput
              id="password"
              label="Password"
              icon={Lock}
              password
              value={password}
              onChange={setPassword}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              disabled={loading}
            />
            {password.length > 0 && (
              <p className={`password-hint${pwMet ? " met" : ""}`}>
                <CheckCircle2 size={13} aria-hidden="true" />
                {pwLabel}
              </p>
            )}
          </div>
          <AuthError>{error}</AuthError>
          <AuthSubmit loading={loading} loadingLabel="Creating account…" label="Create account" />
          <AuthDivider />
          <GoogleAuthButton onClick={handleGoogleSignup} disabled={loading} label="Sign up with Google" />
          <p className="login-footer">
            Have an account? <Link href="/login">Log in</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
