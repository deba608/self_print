"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Mail, MailCheck } from "lucide-react";
import { AuthShell, AuthInput, AuthError, AuthNotice, AuthSubmit } from "@/components/ui/Auth";

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
    <AuthShell title="Reset Password" subtitle="We'll email you a reset link">
      {sent ? (
        <div className="login-form">
          <AuthNotice icon={MailCheck}>
            If an account exists for that email, a reset link has been sent.
          </AuthNotice>
          <p className="login-footer">
            <Link href={loginHref}>Back to log in</Link>
          </p>
        </div>
      ) : (
        <form className="login-form" onSubmit={handleSubmit}>
          <AuthInput
            id="email"
            label="Email"
            icon={Mail}
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="Enter your account email"
            autoComplete="username"
            disabled={loading}
            autoFocus
          />
          <AuthError>{error}</AuthError>
          <AuthSubmit loading={loading} loadingLabel="Sending..." label="Send Reset Link" />
          <p className="login-footer">
            <Link href={loginHref}>Back to log in</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
