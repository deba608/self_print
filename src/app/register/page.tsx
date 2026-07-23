"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, Mail, User, Phone, MailCheck } from "lucide-react";
import { AuthShell, AuthInput, AuthError, AuthNotice, AuthSubmit } from "@/components/ui/Auth";

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
      // The message is intentionally generic: Supabase does not reveal
      // whether the address exists or is already confirmed.
      setResendNotice(
        "If this account still needs confirmation, a new email has been requested."
      );
      setResending(false);
    }
  };

  return (
    <AuthShell title="Create Your Account" subtitle="Save orders and track them anytime">
      {confirmationSent ? (
        <div className="login-form">
          <AuthNotice icon={MailCheck}>
            If this is a new account, check your inbox and spam folder for the
            confirmation email. If you already registered, log in or reset
            your password instead.
          </AuthNotice>
          {resendNotice && <AuthNotice icon={MailCheck}>{resendNotice}</AuthNotice>}
          <button
            type="button"
            className="auth-link-button"
            onClick={handleResend}
            disabled={resending}
          >
            {resending ? "Requesting email..." : "Resend confirmation email"}
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
            placeholder="Enter email"
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
            placeholder="Enter phone number"
            autoComplete="tel"
            required
            disabled={loading}
          />
          <AuthInput
            id="password"
            label="Password"
            icon={Lock}
            password
            value={password}
            onChange={setPassword}
            placeholder="Create a password"
            autoComplete="new-password"
            disabled={loading}
          />
          <AuthError>{error}</AuthError>
          <AuthSubmit loading={loading} loadingLabel="Creating account..." label="Create Account" />
          <p className="login-footer">
            Already have an account? <Link href="/login">Log in</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
