"use client";

import Link from "next/link";
import { AuthShell, AuthError, GoogleAuthButton } from "@/components/ui/Auth";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

export default function UserLoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (err) {
      setError("Google sign-in failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Log in to track your print orders">
      <div className="login-form">
        <GoogleAuthButton onClick={handleGoogleLogin} disabled={loading} />
        <AuthError>{error}</AuthError>
        <p className="login-footer">
          No account? <Link href="/register">Sign up</Link>
        </p>
      </div>
    </AuthShell>
  );
}
