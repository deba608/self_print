"use client";

import { useState } from "react";
import { ArrowLeft, User2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  open: boolean;
  /** Called when the user completes the guest form. */
  onGuestContinue: (name: string, phone: string) => void;
}

type Step = "choice" | "guest-form";

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.61z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.36 0-4.36-1.6-5.08-3.75H.9v2.33A9 9 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.92 10.67A5.4 5.4 0 0 1 3.64 9c0-.58.1-1.15.28-1.67V5H.9a9 9 0 0 0 0 8l3.02-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .9 5l3.02 2.33C4.64 5.18 6.64 3.58 9 3.58z" />
  </svg>
);

export default function LoginNudgePopup({ open, onGuestContinue }: Props) {
  const [step, setStep] = useState<Step>("choice");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [nameError, setNameError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleGoogle = () => {
    try {
      createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
    } catch (err) {
      console.error("Auth sign in error:", err);
    }
  };

  const handleGuestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let valid = true;

    if (!name.trim()) {
      setNameError("Name is required");
      valid = false;
    } else {
      setNameError("");
    }

    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length !== 10) {
      setPhoneError("Enter a valid 10-digit mobile number");
      valid = false;
    } else {
      setPhoneError("");
    }

    if (!valid) return;

    setSubmitting(true);
    try {
      // Persist in localStorage for the device session
      localStorage.setItem(
        "selfprint:guestProfile",
        JSON.stringify({ name: name.trim(), phone: cleanPhone })
      );
      // Best-effort server-side registration (non-blocking)
      fetch("/api/user/guest-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: cleanPhone }),
      }).catch(() => {});
    } catch {
      // localStorage may be blocked in private mode — not fatal
    }
    setSubmitting(false);
    onGuestContinue(name.trim(), cleanPhone);
  };

  if (!open) return null;

  /* ── Step 2: guest name + phone form ── */
  if (step === "guest-form") {
    return (
      <div className="nudge-overlay" role="dialog" aria-modal="true" aria-label="Guest details">
        <div className="nudge-popup">
          <button
            type="button"
            className="nudge-back"
            onClick={() => setStep("choice")}
            aria-label="Back"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="nudge-icon" aria-hidden="true">
            <User2 size={24} color="var(--accent)" />
          </div>

          <h2 className="nudge-title">Continue as Guest</h2>
          <p className="nudge-sub">
            Enter your name &amp; mobile so we can contact you about your print.
          </p>

          <form className="nudge-guest-form" onSubmit={handleGuestSubmit} noValidate>
            <div className="nudge-field">
              <label htmlFor="nudge-name">Your Name *</label>
              <input
                id="nudge-name"
                type="text"
                placeholder="e.g. Rahul Sharma"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                autoComplete="name"
                maxLength={80}
              />
              {nameError && <span className="nudge-field-error">{nameError}</span>}
            </div>

            <div className="nudge-field">
              <label htmlFor="nudge-phone">Mobile Number *</label>
              <div className="nudge-phone-row">
                <span className="nudge-phone-prefix">+91</span>
                <input
                  id="nudge-phone"
                  type="tel"
                  placeholder="10-digit number"
                  value={phone}
                  onChange={(e) =>
                    setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                  }
                  autoComplete="tel-national"
                  inputMode="numeric"
                  maxLength={10}
                />
              </div>
              {phoneError && <span className="nudge-field-error">{phoneError}</span>}
            </div>

            <button
              type="submit"
              className="nudge-google-btn nudge-submit-btn"
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Continue →"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ── Step 1: choice ── */
  return (
    <div className="nudge-overlay" role="dialog" aria-modal="true" aria-label="Sign in or continue">
      <div className="nudge-popup">
        <div className="nudge-icon" aria-hidden="true">
          <GoogleIcon />
        </div>

        <h2 className="nudge-title">Sign in or Continue</h2>
        <p className="nudge-sub">
          Create an account to track all your orders, or continue as a guest.
        </p>

        <button type="button" className="nudge-google-btn" onClick={handleGoogle}>
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="nudge-divider"><span>or</span></div>

        <button
          type="button"
          className="nudge-guest-btn"
          onClick={() => setStep("guest-form")}
        >
          Continue as Guest
        </button>
      </div>
    </div>
  );
}
