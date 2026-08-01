"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, Mail } from "lucide-react";
import { AuthShell, AuthInput, AuthError, AuthSubmit } from "@/components/ui/Auth";

/**
 * Delivery rider sign-in form shown at /delivery when no staff session
 * exists. Posts to the same /api/admin/login endpoint as the admin login
 * (one staff_profiles table, one credential check) — only the branding and
 * the page that renders after success differ.
 */
export default function DeliveryLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      router.refresh();
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <AuthShell title="SelfPrint Delivery" subtitle="Rider sign in">
      <form className="login-form" onSubmit={handleSubmit}>
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
        />
        <AuthError>{error}</AuthError>
        <AuthSubmit loading={loading} loadingLabel="Signing in..." label="Log in" />
        <p className="login-footer">
          <Link href="/forgot-password?from=delivery">Forgot password?</Link>
        </p>
      </form>
    </AuthShell>
  );
}
