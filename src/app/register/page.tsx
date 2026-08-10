"use client";

import Link from "next/link";
import { AuthShell, AuthError, GoogleAuthButton } from "@/components/ui/Auth";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

export default function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleSignup = async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (err) {
      setError("Google sign-up failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Create account" subtitle="Sign up to save and track your print orders">
      <div className="login-form">
        <GoogleAuthButton onClick={handleGoogleSignup} disabled={loading} label="Sign up with Google" />
        <AuthError>{error}</AuthError>
        <p className="login-footer">
          Have an account? <Link href="/login">Log in</Link>
        </p>
      </div>
    </AuthShell>
  );
}
