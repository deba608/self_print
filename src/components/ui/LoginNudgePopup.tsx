"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const STORAGE_KEY = "sp_login_nudge_dismissed";

export default function LoginNudgePopup() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "1") return;
    createClient().auth.getUser().then(({ data }) => {
      if (!data.user) {
        setVisible(true);
      }
    });
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  };

  const handleGoogle = () => {
    createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  if (!visible) return null;

  return (
    <div className="nudge-overlay" role="dialog" aria-modal="true" aria-label="Sign in">
      <div className="nudge-popup">
        <button className="nudge-close" onClick={dismiss} aria-label="Dismiss">
          <X size={16} />
        </button>
        <div className="nudge-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.61z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.36 0-4.36-1.6-5.08-3.75H.9v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.92 10.67A5.4 5.4 0 0 1 3.64 9c0-.58.1-1.15.28-1.67V5H.9a9 9 0 0 0 0 8l3.02-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .9 5l3.02 2.33C4.64 5.18 6.64 3.58 9 3.58z" />
          </svg>
        </div>
        <h2 className="nudge-title">Sign in before you print</h2>
        <p className="nudge-sub">Track orders & get updates — 5 seconds with Google.</p>
        <button type="button" className="nudge-google-btn" onClick={handleGoogle}>
          <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.61z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.36 0-4.36-1.6-5.08-3.75H.9v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.92 10.67A5.4 5.4 0 0 1 3.64 9c0-.58.1-1.15.28-1.67V5H.9a9 9 0 0 0 0 8l3.02-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .9 5l3.02 2.33C4.64 5.18 6.64 3.58 9 3.58z" />
          </svg>
          Continue with Google
        </button>
        <button type="button" className="nudge-skip" onClick={dismiss}>
          Continue as guest
        </button>
      </div>
    </div>
  );
}
