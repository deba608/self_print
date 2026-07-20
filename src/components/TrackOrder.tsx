"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Printer, Search, Store, X, CreditCard, PackageCheck, UploadCloud } from "lucide-react";

type TrackData = {
  status: string;
  paidAt: string | null;
  queuePosition: number;
  pricePaise: number;
  createdAt: string;
  fileCount: number;
};

const TOKEN_LEN = 6;
const LAST_TOKEN_KEY = "selfprint:lastToken";

// Payment and print-progress now advance independently (a shop may release
// and print before the customer pays at the counter), so each of the 4 steps
// — Submitted, Paid, Printing, Ready — is tracked as its own done/not-done
// flag rather than a single linear cursor.
function timelineFor(job: TrackData): { done: boolean[]; failed: boolean } {
  if (!["pending_payment", "paid", "approved", "printing", "printed"].includes(job.status)) {
    return { done: [true, Boolean(job.paidAt), false, false], failed: true }; // failed / cancelled / expired
  }
  const printingOrBeyond = job.status === "approved" || job.status === "printing" || job.status === "printed";
  return {
    done: [true, Boolean(job.paidAt), printingOrBeyond, job.status === "printed"],
    failed: false,
  };
}

export default function TrackOrder({ initialToken }: { initialToken?: string }) {
  const [digits, setDigits] = useState<string[]>(() => {
    const t = (initialToken ?? "").replace(/\D/g, "").slice(0, TOKEN_LEN);
    return Array.from({ length: TOKEN_LEN }, (_, i) => t[i] ?? "");
  });
  const [job, setJob] = useState<TrackData | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [activeToken, setActiveToken] = useState("");
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const lookup = useCallback(async (token: string) => {
    setChecking(true);
    setError("");
    try {
      const res = await fetch(`/api/jobs/${token}/status`, { cache: "no-store" });
      if (!res.ok) {
        setJob(null);
        setActiveToken("");
        setError(res.status === 404
          ? "No order found with this token. It may have expired or been cleaned up."
          : "Could not check right now. Try again.");
        return;
      }
      const body = (await res.json()) as TrackData;
      setJob(body);
      setActiveToken(token);
      try { localStorage.setItem(LAST_TOKEN_KEY, token); } catch { /* private mode */ }
    } catch {
      setError("Network problem — check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }, []);

  // Auto-submit when all six digits are present (typed, pasted, or from URL).
  const token = digits.join("");
  useEffect(() => {
    if (token.length === TOKEN_LEN && /^\d{6}$/.test(token) && token !== activeToken && !checking) {
      lookup(token);
    }
  }, [token, activeToken, checking, lookup]);

  // Poll a loaded job every 5s so the timeline moves while the customer watches.
  useEffect(() => {
    if (!activeToken || !job) return;
    if (job.status === "printed" || timelineFor(job).failed) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${activeToken}/status`, { cache: "no-store" });
        if (res.ok) setJob(await res.json());
      } catch { /* transient — next tick retries */ }
    }, 5000);
    return () => clearInterval(iv);
  }, [activeToken, job]);

  function setDigit(i: number, value: string) {
    const v = value.replace(/\D/g, "");
    // Paste of full token into any box fills everything.
    if (v.length > 1) {
      const t = v.slice(0, TOKEN_LEN);
      setDigits(Array.from({ length: TOKEN_LEN }, (_, k) => t[k] ?? ""));
      inputsRef.current[Math.min(t.length, TOKEN_LEN - 1)]?.focus();
      return;
    }
    setDigits((prev) => prev.map((d, k) => (k === i ? v : d)));
    if (v && i < TOKEN_LEN - 1) inputsRef.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) inputsRef.current[i - 1]?.focus();
  }

  function reset() {
    setDigits(Array.from({ length: TOKEN_LEN }, () => ""));
    setJob(null);
    setActiveToken("");
    setError("");
    inputsRef.current[0]?.focus();
  }

  const tl = job ? timelineFor(job) : null;
  const activeIdx = tl ? tl.done.findIndex((d) => !d) : -1;
  const steps = [
    { label: "Submitted", sub: "Order received", icon: <UploadCloud size={18} /> },
    { label: "Paid", sub: job?.paidAt ? "Payment confirmed" : "Pay at the counter", icon: <CreditCard size={18} /> },
    { label: "Printing", sub: "Your pages are printing", icon: <Printer size={18} /> },
    { label: "Ready", sub: "Collect at the counter", icon: <PackageCheck size={18} /> },
  ];

  return (
    <div className="track-order">
      {!job && (
        <div className="track-entry fade-in">
          <p className="track-hint">Enter the 6-digit token from your order</p>
          <div className="token-inputs" role="group" aria-label="Order token">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputsRef.current[i] = el; }}
                className="token-digit"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={TOKEN_LEN}
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                aria-label={`Digit ${i + 1}`}
              />
            ))}
          </div>
          {checking && (
            <p className="track-checking"><Loader2 size={16} className="spin" /> Checking…</p>
          )}
          {error && <div className="error-msg" role="alert">{error}</div>}
        </div>
      )}

      {job && tl && (
        <div className="track-result fade-in-up" aria-live="polite">
          <div className="result-meta">
            <div className="result-meta-item">
              <span className="result-meta-label">Token</span>
              <span className="result-meta-value token-value">{activeToken}</span>
            </div>
            <div className="result-meta-divider" aria-hidden="true" />
            <div className="result-meta-item">
              <span className="result-meta-label">Queue</span>
              <span className="result-meta-value">#{job.queuePosition}</span>
            </div>
            <div className="result-meta-divider" aria-hidden="true" />
            <div className="result-meta-item">
              <span className="result-meta-label">Amount</span>
              <span className="result-meta-value">₹{(job.pricePaise / 100).toFixed(2)}</span>
            </div>
          </div>

          {tl.failed ? (
            <div className="track-failed" role="alert">
              <X size={22} aria-hidden="true" />
              <div>
                <strong>{job.status === "cancelled" ? "Order cancelled" : "Something went wrong"}</strong>
                <p>Please ask the shop staff for help with token {activeToken}.</p>
              </div>
            </div>
          ) : (
            <ol className="track-timeline">
              {steps.map((s, i) => {
                const state = tl.done[i] ? "done" : i === activeIdx ? "active" : "todo";
                return (
                  <li key={s.label} className={`track-step ${state}`}>
                    <span className="track-step-dot" aria-hidden="true">
                      {state === "done" ? <Check size={16} strokeWidth={3} /> : s.icon}
                    </span>
                    <span className="track-step-text">
                      <span className="track-step-label">{s.label}</span>
                      {state === "active" && <span className="track-step-sub">{s.sub}</span>}
                      {state === "done" && i === steps.length - 1 && <span className="track-step-sub">{s.sub}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {job.status === "printed" && (
            <p className="track-collect"><Store size={15} aria-hidden="true" /> Your print is ready — show this token at the counter.</p>
          )}

          <button type="button" className="btn-secondary track-again" onClick={reset}>
            <Search size={16} aria-hidden="true" /> Check another order
          </button>
        </div>
      )}
    </div>
  );
}
