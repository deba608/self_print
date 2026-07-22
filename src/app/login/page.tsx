"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, Mail } from "lucide-react";
import { AuthShell, AuthInput, AuthError, AuthSubmit } from "@/components/ui/Auth";

export default function LoginPage() {
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
      router.push("/admin");
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <AuthShell title="SelfPrint Admin" subtitle="Staff sign in">
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
        <AuthSubmit loading={loading} loadingLabel="Signing in..." label="Sign In" />
        <p className="login-footer">
          <Link href="/forgot-password?from=admin">Forgot password?</Link>
          {" · "}
          Customer? <Link href="/customer-login">Log in here</Link>
        </p>
      </form>
    </AuthShell>
  );
}
