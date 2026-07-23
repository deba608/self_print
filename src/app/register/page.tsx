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

  return (
    <AuthShell title="Create Your Account" subtitle="Save orders and track them anytime">
      {confirmationSent ? (
        <div className="login-form">
          <AuthNotice icon={MailCheck}>
            Check your email to confirm your account before logging in.
          </AuthNotice>
          <p className="login-footer">
            <Link href="/login">Back to log in</Link>
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
