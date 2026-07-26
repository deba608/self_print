"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, Mail } from "lucide-react";
import { AuthShell, AuthInput, AuthError, AuthSubmit, AuthDivider, GoogleAuthButton } from "@/components/ui/Auth";
import { createClient } from "@/lib/supabase/client";

export default function UserLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleLogin = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
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
      // Also sign in with the browser Supabase client so onAuthStateChange
      // fires a SIGNED_IN event — this makes the navbar update instantly
      // without requiring a full page reload.
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
    </AuthShell>
  );
}
