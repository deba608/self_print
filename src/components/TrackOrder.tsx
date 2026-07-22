"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Check, Loader2, Printer, Search, Store, Truck, X, PackageCheck, UploadCloud, Download, MessageCircleWarning } from "lucide-react";
import BillReceipt, { type BillData } from "./BillReceipt";

type TrackData = {
  status: string;
  paidAt: string | null;
  queuePosition: number;
  jobsAhead: number;
  pricePaise: number;
  createdAt: string;
  fileCount: number;
  issueReportedAt: string | null;
  issueResolvedAt: string | null;
  // Optional — the public status endpoint may not include delivery fields
  // yet; absence is treated as a pickup order.
  deliveryMethod?: "pickup" | "delivery" | null;
  deliveryStatus?: "pending" | "out_for_delivery" | "delivered" | null;
};

const TOKEN_LEN = 6;
const LAST_TOKEN_KEY = "selfprint:lastToken";

// Print progress timeline: Uploaded → Approved → Printed, then branching by
// fulfilment — delivery orders continue to Out for delivery → Delivered,
// pickup orders end with Ready for pickup. Payment is decoupled from print
// progress and is shown separately (receipt button), not as a timeline step.
function timelineFor(job: TrackData): { done: boolean[]; failed: boolean } {
  const isDelivery = job.deliveryMethod === "delivery";
  const stepCount = isDelivery ? 5 : 4;
  if (!["pending_payment", "paid", "approved", "printing", "printed"].includes(job.status)) {
    // failed / cancelled / expired
    return { done: [true, ...Array.from({ length: stepCount - 1 }, () => false)], failed: true };
  }
  const approvedOrBeyond = job.status === "approved" || job.status === "printing" || job.status === "printed";
  const printed = job.status === "printed";
  if (isDelivery) {
    const outForDelivery = job.deliveryStatus === "out_for_delivery" || job.deliveryStatus === "delivered";
    return {
      done: [true, approvedOrBeyond, printed, outForDelivery, job.deliveryStatus === "delivered"],
      failed: false,
    };
  }
  return {
    done: [true, approvedOrBeyond, printed, printed],
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
  // Last token we auto-submitted — prevents a failed lookup from re-firing
  // in a loop (the effect would otherwise retry the same 6 digits forever).
  const lastTriedRef = useRef("");
  const [receipt, setReceipt] = useState<BillData | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMsg, setReportMsg] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportError, setReportError] = useState("");
  // "Updated Xs ago" indicator — timestamp of the last successful status
  // fetch, plus a 1s ticker so the label counts up between polls.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lastUpdatedAt) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [lastUpdatedAt]);

  async function submitReport() {
    if (!activeToken) return;
    setReportSending(true);
    setReportError("");
    try {
      const res = await fetch(`/api/jobs/${activeToken}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reportMsg.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReportError(body.error ?? "Could not send the report. Try again.");
        return;
      }
      setJob((j) => (j ? { ...j, issueReportedAt: new Date().toISOString(), issueResolvedAt: null } : j));
      setReportOpen(false);
    } catch {
      setReportError("Network problem — check your connection and try again.");
    } finally {
      setReportSending(false);
    }
  }

  async function loadReceipt() {
    if (!activeToken) return;
    setReceiptLoading(true);
    setReceiptError("");
    try {
      const res = await fetch(`/api/jobs/${activeToken}/receipt`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setReceiptError(body.error ?? "Could not load the receipt.");
        return;
      }
      setReceipt(body as BillData);
    } catch {
      setReceiptError("Network problem — try again.");
    } finally {
      setReceiptLoading(false);
    }
  }

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
      setLastUpdatedAt(Date.now());
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
    if (token.length === TOKEN_LEN && /^\d{6}$/.test(token) && token !== lastTriedRef.current && !checking) {
      lastTriedRef.current = token;
      lookup(token);
    }
    // Editing back below 6 digits re-arms auto-submit for the next full token.
    if (token.length < TOKEN_LEN) lastTriedRef.current = "";
  }, [token, activeToken, checking, lookup]);

  // Poll a loaded job every 5s so the timeline moves while the customer watches.
  useEffect(() => {
    if (!activeToken || !job) return;
    if (job.status === "printed" || timelineFor(job).failed) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${activeToken}/status`, { cache: "no-store" });
        if (res.ok) {
          setJob(await res.json());
          setLastUpdatedAt(Date.now());
        }
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
    lastTriedRef.current = "";
    setDigits(Array.from({ length: TOKEN_LEN }, () => ""));
    setJob(null);
    setActiveToken("");
    setError("");
    setReceipt(null);
    setReceiptError("");
    setReportOpen(false);
    setReportMsg("");
    setReportError("");
    setLastUpdatedAt(null);
    inputsRef.current[0]?.focus();
  }

  const tl = job ? timelineFor(job) : null;
  const activeIdx = tl ? tl.done.findIndex((d) => !d) : -1;
  const isDelivery = job?.deliveryMethod === "delivery";
  const steps = [
    { label: "Uploaded", sub: "Order received", icon: <UploadCloud size={18} /> },
    { label: "Approved", sub: "Released by the shop", icon: <BadgeCheck size={18} /> },
    { label: "Printed", sub: "Your pages are printing", icon: <Printer size={18} /> },
    ...(isDelivery
      ? [
          { label: "Out for delivery", sub: "On its way to you", icon: <Truck size={18} /> },
          { label: "Delivered", sub: "Handed over", icon: <PackageCheck size={18} /> },
        ]
      : [{ label: "Ready for pickup", sub: "Collect at the counter", icon: <Store size={18} /> }]),
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
              {job.status !== "printed" && !tl.failed && (
                <span className="track-eta">~{Math.max(1, job.jobsAhead + 1) * 3} min</span>
              )}
            </div>
            <div className="result-meta-divider" aria-hidden="true" />
            <div className="result-meta-item">
              <span className="result-meta-label">Amount</span>
              <span className="result-meta-value">₹{(job.pricePaise / 100).toFixed(2)}</span>
            </div>
          </div>

          {tl.failed ? (
            <div className="track-failed-wrap">
              <div className="track-failed" role="alert">
                <X size={22} aria-hidden="true" />
                <div>
                  <strong>{job.status === "cancelled" ? "Order cancelled" : "Something went wrong"}</strong>
                  <p>Please ask the shop staff for help with token {activeToken}.</p>
                </div>
              </div>

              {job.issueReportedAt && !job.issueResolvedAt ? (
                <p className="report-sent">
                  <MessageCircleWarning size={15} aria-hidden="true" />
                  Reported to staff — they&apos;ll follow up on token {activeToken}.
                </p>
              ) : job.issueResolvedAt ? (
                <p className="report-sent resolved">
                  <Check size={15} aria-hidden="true" />
                  Staff marked this as resolved.
                </p>
              ) : reportOpen ? (
                <div className="report-form">
                  <textarea
                    className="report-textarea"
                    placeholder="What happened? (optional)"
                    value={reportMsg}
                    onChange={(e) => setReportMsg(e.target.value.slice(0, 500))}
                    rows={3}
                    maxLength={500}
                  />
                  {reportError && <div className="error-msg" role="alert">{reportError}</div>}
                  <div className="report-form-actions">
                    <button type="button" className="btn-secondary" onClick={() => setReportOpen(false)} disabled={reportSending}>
                      Cancel
                    </button>
                    <button type="button" className="btn-primary" onClick={submitReport} disabled={reportSending}>
                      {reportSending ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <MessageCircleWarning size={16} aria-hidden="true" />}
                      Send report
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn-secondary report-issue-btn" onClick={() => setReportOpen(true)}>
                  <MessageCircleWarning size={16} aria-hidden="true" />
                  Report issue
                </button>
              )}
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

          {lastUpdatedAt && !tl.failed && !(job.status === "printed" && (!isDelivery || job.deliveryStatus === "delivered")) && (
            <p className="track-updated" aria-live="off">
              Updated {Math.max(0, Math.round((now - lastUpdatedAt) / 1000))}s ago
            </p>
          )}

          {job.status === "printed" && !isDelivery && (
            <p className="track-collect"><Store size={15} aria-hidden="true" /> Your print is ready — show this token at the counter.</p>
          )}

          {job.paidAt && !receipt && (
            <button type="button" className="btn-secondary track-receipt-btn" onClick={loadReceipt} disabled={receiptLoading}>
              {receiptLoading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
              Download receipt
            </button>
          )}
          {receiptError && <div className="error-msg" role="alert">{receiptError}</div>}
          {receipt && <BillReceipt bill={receipt} />}

          <button type="button" className="btn-secondary track-again" onClick={reset}>
            <Search size={16} aria-hidden="true" /> Check another order
          </button>
        </div>
      )}
    </div>
  );
}
