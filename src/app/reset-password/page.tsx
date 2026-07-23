"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, Loader2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthShell, AuthInput, AuthError, AuthSubmit } from "@/components/ui/Auth";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // The Supabase browser client automatically parses the recovery token
    // from the URL fragment (sent via forgot-password's resetPasswordForEmail
    // redirect) and establishes a session on load. We just need to confirm a
    // session actually landed.
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setCheckingSession(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setHasSession(true);
        setCheckingSession(false);
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || !confirmPassword) {
      setError("Please enter and confirm your new password");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message || "Unable to set password");
        setLoading(false);
        return;
      }
      // Staff accounts land on the admin login; RLS lets a staff user see
      // only their own staff_profiles row, so this read doubles as the check.
      const { data: userData } = await supabase.auth.getUser();
      let isStaff = false;
      if (userData.user) {
        const { data: profile } = await supabase
          .from("staff_profiles")
          .select("id")
          .eq("id", userData.user.id)
          .maybeSingle();
        isStaff = !!profile;
      }
      router.push(isStaff ? "/admin" : "/login");
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Reset Your Password" subtitle="Choose a new password for your account">
      {checkingSession ? (
        <div className="login-form" aria-busy="true">
          <Loader2 size={18} className="spin" />
        </div>
      ) : !hasSession ? (
        <div className="login-form">
          <AuthError>This reset link is invalid or has expired. Please request a new one.</AuthError>
          <p className="login-footer">
            <Link href="/forgot-password">Request a new link</Link>
          </p>
        </div>
      ) : (
        <form className="login-form" onSubmit={handleSubmit}>
          <AuthInput
            id="password"
            label="New Password"
            icon={Lock}
            password
            value={password}
            onChange={setPassword}
            placeholder="Enter new password"
            autoComplete="new-password"
            disabled={loading}
            autoFocus
          />
          <p className={`password-hint${password.length >= 6 ? " met" : ""}`}>
            <Check size={14} aria-hidden="true" /> At least 6 characters
          </p>
          <AuthInput
            id="confirmPassword"
            label="Confirm Password"
            icon={Lock}
            password
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Confirm new password"
            autoComplete="new-password"
            disabled={loading}
          />
          <AuthError>{error}</AuthError>
          <AuthSubmit loading={loading} loadingLabel="Setting password..." label="Set Password" />
        </form>
      )}
    </AuthShell>
  );
}
